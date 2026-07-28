// ============================================================
//  Scalanie ofert z wielu źródeł, cache wyszukiwania i limity czasu
//
//  Dedupe jest cichym miejscem na błędy: gdy ten sam hotel przychodzi
//  z trzech źródeł, łatwo zgubić realne opinie albo pokazać ten sam
//  obiekt trzy razy. Jedno i drugie widać dopiero u klienta.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { dedupeOffers, searchAll, clearSearchCache, providerStatus } from "../src/providers/index.js";
import { withDeadline } from "../src/http.js";

function offer(over = {}) {
  return {
    name: "Blue Lagoon", country: "Egipt", region: "Hurghada",
    price: 3500, rating: 8.4, reviews: 0, stars: 4, source: "demo", __prio: 5,
    ...over,
  };
}

test("ten sam hotel z dwóch źródeł zostaje jedną ofertą", () => {
  const out = dedupeOffers([
    offer({ source: "A", __prio: 1 }),
    offer({ source: "B", __prio: 5 }),
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].mergedFrom.sort(), ["A", "B"]);
});

test("nazwy różniące się wielkością liter i spacjami to ten sam hotel", () => {
  const out = dedupeOffers([
    offer({ name: "Blue  Lagoon", __prio: 1 }),
    offer({ name: "BLUE LAGOON", __prio: 5 }),
  ]);
  assert.equal(out.length, 1);
});

test("ten sam hotel w innym kraju to inny hotel", () => {
  const out = dedupeOffers([offer({ country: "Egipt" }), offer({ country: "Turcja" })]);
  assert.equal(out.length, 2);
});

test("reprezentantem zostaje źródło o wyższym priorytecie", () => {
  const out = dedupeOffers([
    offer({ source: "gorsze", __prio: 9, price: 9999 }),
    offer({ source: "lepsze", __prio: 1, price: 3000 }),
  ]);
  assert.equal(out[0].source, "lepsze");
  assert.equal(out[0].price, 3000);
});

test("realne opinie wygrywają z oszacowanymi", () => {
  const out = dedupeOffers([
    offer({ __prio: 1, reviews: 0, rating: 9.9 }),          // reprezentant bez opinii
    offer({ __prio: 5, reviews: 2400, rating: 8.1, freshDays: 3 }), // źródło z opiniami
  ]);
  assert.equal(out[0].reviews, 2400, "liczba opinii musi przyjść ze źródła, które je ma");
  assert.equal(out[0].rating, 8.1, "razem z oceną, żeby nie zestawić 9,9 z 2400 opiniami");
  assert.equal(out[0].freshDays, 3);
});

test("brakujące fakty o obiekcie dobierane są z bogatszego źródła", () => {
  const out = dedupeOffers([
    offer({ __prio: 1 }), // reprezentant bez szczegółów
    offer({ __prio: 5, beach: 120, roomType: "Standard Room", airport: 8000, yearRenov: 2024, adultsOnly: true }),
  ]);
  assert.equal(out[0].beach, 120);
  assert.equal(out[0].roomType, "Standard Room");
  assert.equal(out[0].airport, 8000);
  assert.equal(out[0].yearRenov, 2024);
  assert.equal(out[0].adultsOnly, true);
});

test("dane reprezentanta nie są nadpisywane przez słabsze źródło", () => {
  const out = dedupeOffers([
    offer({ __prio: 1, beach: 50, roomType: "Suite" }),
    offer({ __prio: 5, beach: 900, roomType: "Standard" }),
  ]);
  assert.equal(out[0].beach, 50);
  assert.equal(out[0].roomType, "Suite");
});

test("link do rezerwacji dobierany jest z dowolnego źródła, które go ma", () => {
  const out = dedupeOffers([
    offer({ __prio: 1, bookingUrl: "" }),
    offer({ __prio: 5, bookingUrl: "https://example.com/oferta" }),
  ]);
  assert.equal(out[0].bookingUrl, "https://example.com/oferta");
});

test("różne terminy tego samego hotelu zostają jako warianty", () => {
  const out = dedupeOffers([
    offer({ __prio: 1, departDate: "2026-08-15", price: 3690, departureCity: "Katowice" }),
    offer({ __prio: 1, departDate: "2026-08-22", price: 3200, departureCity: "Katowice" }),
    offer({ __prio: 1, departDate: "2026-08-29", price: 4100, departureCity: "Warszawa" }),
  ]);
  assert.equal(out.length, 1, "to jeden hotel, nie trzy");
  assert.equal(out[0].variants.length, 3, "ale trzy wyloty do wyboru");
  assert.equal(out[0].variants[0].price, 3200, "warianty od najtańszego");
});

test("oferty bez nazwy nie są scalane ze sobą", () => {
  const out = dedupeOffers([offer({ name: "", country: "" }), offer({ name: "", country: "" })]);
  assert.equal(out.length, 2, "brak nazwy to nie powód, żeby uznać dwa obiekty za ten sam");
});

test("pole techniczne __prio nie wychodzi na zewnątrz", () => {
  const out = dedupeOffers([offer()]);
  assert.ok(!("__prio" in out[0]));
});

test("withDeadline przepuszcza to, co zdąży", async () => {
  const wynik = await withDeadline(Promise.resolve("gotowe"), 1000, "szybkie");
  assert.equal(wynik, "gotowe");
});

test("withDeadline przerywa to, co się nie wyrabia", async () => {
  await assert.rejects(
    withDeadline(new Promise((r) => setTimeout(r, 5000)), 50, "wolne-zrodlo"),
    /wolne-zrodlo.*limit/
  );
});

test("każdy dostawca deklaruje komplet metadanych", () => {
  for (const p of providerStatus()) {
    assert.ok(p.id, "dostawca bez id");
    assert.ok(p.label, `dostawca ${p.id} bez etykiety`);
    assert.equal(typeof p.enabled, "boolean");
  }
});

test("powtórzone wyszukiwanie idzie z cache i jest wyraźnie szybsze", async () => {
  clearSearchCache();
  const crit = { dest: "Egipt", adults: 2, pax: 2 };

  const t0 = Date.now();
  const pierwsze = await searchAll(crit);
  const czasPierwszego = Date.now() - t0;

  const t1 = Date.now();
  const drugie = await searchAll(crit);
  const czasDrugiego = Date.now() - t1;

  assert.ok(drugie.cached, "drugie zapytanie musi być oznaczone jako z cache");
  assert.equal(drugie.offers.length, pierwsze.offers.length);
  // Porównanie czasów jest chwiejne, gdy oba zapytania trwają pojedyncze
  // milisekundy (dostawcy demo odpowiadają natychmiast) — dlatego pilnujemy
  // twardego progu, a nie tego, który przebieg był szybszy o ułamek.
  assert.ok(czasDrugiego < 100, `odczyt z cache trwał ${czasDrugiego} ms`);
  if (czasPierwszego > 50) {
    assert.ok(czasDrugiego <= czasPierwszego, "przy wolnym dostawcy cache musi realnie skracać czas");
  }
});

test("inne kryteria to inne zapytanie, nie cache", async () => {
  clearSearchCache();
  await searchAll({ dest: "Egipt", adults: 2 });
  const inne = await searchAll({ dest: "Grecja", adults: 2 });
  assert.ok(!inne.cached, "zmiana kierunku nie może zwrócić poprzedniego wyniku");
});

test("kolejność pól w kryteriach nie tworzy osobnego wpisu w cache", async () => {
  clearSearchCache();
  await searchAll({ dest: "Egipt", adults: 2, nights: 7 });
  const drugie = await searchAll({ nights: 7, adults: 2, dest: "Egipt" });
  assert.ok(drugie.cached, "te same kryteria zapisane w innej kolejności to to samo pytanie");
});
