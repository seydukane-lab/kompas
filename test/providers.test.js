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
import { search as searchPackages } from "../src/providers/packages.js";
import { hasAttribute } from "../src/ranking.js";

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

// Amenities przy scalaniu: analogicznie do beach/roomType — reprezentant bez
// wiedzy o amenities dostaje ją z bogatszego źródła, ale własnej (nawet pustej)
// tablicy nie tracimy. Regresja do błędu z 30.07.2026 (filtry Obiekt/Aktywność
// nic nie robiły) — nie może się powtórzyć na etapie scalania duplikatów.
test("amenities dobierane są z bogatszego źródła, gdy reprezentant ich nie zna", () => {
  const out = dedupeOffers([
    offer({ __prio: 1 }), // reprezentant bez amenities
    offer({ __prio: 5, amenities: ["basen", "wifi"] }),
  ]);
  assert.deepEqual(out[0].amenities, ["basen", "wifi"]);
});

test("pusta (ale znana) tablica amenities reprezentanta nie jest nadpisywana", () => {
  const out = dedupeOffers([
    offer({ __prio: 1, amenities: [] }), // sprawdzone: reprezentant nic nie ma
    offer({ __prio: 5, amenities: ["basen"] }),
  ]);
  assert.deepEqual(out[0].amenities, [], "wiedza reprezentanta 'sprawdzone, brak' nie może zniknąć");
});

test("gdy żadne źródło nie zna amenities, wynik zostaje undefined, nie []", () => {
  const out = dedupeOffers([offer({ __prio: 1 }), offer({ __prio: 5 })]);
  assert.equal(out[0].amenities, undefined, "brak danych nie może cicho zamienić się w pustą tablicę");
});

// Seed demo (packages.js) musi też realnie zasilać filtr Obiekt/Aktywność —
// inaczej konsultant bez klucza API do Hotelbeds w ogóle nie zobaczy, że działa.
test("oferty demo z packages.js mają amenities i realną wariancję między hotelami", async () => {
  const oferty = await searchPackages({});
  assert.ok(oferty.length > 10, "za mało ofert demo, żeby cokolwiek zweryfikować");
  assert.ok(oferty.every((o) => Array.isArray(o.amenities)), "każda oferta demo powinna mieć znane amenities");
  const zBasenem = oferty.filter((o) => o.amenities.includes("basen"));
  const zeSpa = oferty.filter((o) => o.amenities.includes("spa"));
  assert.ok(zBasenem.length > 0 && zBasenem.length < oferty.length, "basen musi różnicować ofertę, nie być stały dla wszystkich");
  assert.ok(zeSpa.length > 0 && zeSpa.length < oferty.length, "spa musi różnicować ofertę, nie być stały dla wszystkich");
});

test("demo nigdy nie zgaduje dostępności dla niepełnosprawnych — tej informacji tu po prostu nie ma", async () => {
  const oferty = await searchPackages({});
  assert.ok(
    oferty.every((o) => !o.amenities.includes("niepelnosprawni")),
    "seed demo nie zawiera realnej informacji o dostępności — nie wolno jej zmyślać"
  );
});

// Regresja: cała pula cap===4+"rodzina" kiedyś dostawała identyczną nazwę pokoju
// ("Pokój rodzinny (2 sypialnie)"), więc hasAttribute(..., "pokoje-polaczone")
// wychodziło `false` dla KAŻDEJ oferty demo (roomType zawsze ustawiony -> nigdy
// `undefined`) i filtr „Pokoje połączone" bez klucza Hotelbeds zawsze zwracał
// 0 wyników — martwy klik w panelu, mimo że sam mechanizm filtra działał poprawnie.
test("demo z packages.js daje realne potwierdzenia OBU układów pokoju, nie tylko dzielonego", async () => {
  const oferty = await searchPackages({});
  const dzielone = oferty.filter((o) => hasAttribute(o, "pokoj-dzielony") === true);
  const polaczone = oferty.filter((o) => hasAttribute(o, "pokoje-polaczone") === true);
  assert.ok(dzielone.length > 0, "filtr 'Osobna sypialnia' nie może być martwy w demo");
  assert.ok(polaczone.length > 0, "filtr 'Pokoje połączone' nie może być martwy w demo");
  const oboje = oferty.filter(
    (o) => hasAttribute(o, "pokoj-dzielony") === true && hasAttribute(o, "pokoje-polaczone") === true
  );
  assert.equal(oboje.length, 0, "to dwa różne produkty — żadna oferta nie powinna potwierdzać obu naraz");
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

// ------------------------------------------------------------------
//  Trzy stany źródła: odpowiedziało (z ofertami), odpowiedziało zerem
//  (uczciwe "nic nie ma"), padło (wyjątek/timeout/HTTP 4xx-5xx).
//  Bez tego rozróżnienia awaria dostawcy i realny brak ofert wyglądają
//  dla konsultanta identycznie: count: 0.
// ------------------------------------------------------------------
function atrapa(id, impl) {
  return { meta: { id, label: id }, isEnabled: () => true, search: impl };
}

test("dostawca, który rzuca wyjątkiem, jest oznaczony jako ok:false z powodem", async () => {
  clearSearchCache();
  const padajacy = atrapa("padajacy", async () => {
    const err = new Error("availability HTTP 403");
    err.status = 403;
    throw err;
  });
  const { sources } = await searchAll({ dest: "test-padajacy" }, [padajacy]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].ok, false);
  assert.equal(sources[0].count, 0);
  assert.match(sources[0].reason, /403/);
});

test("dostawca, który uczciwie nie znalazł nic, jest oznaczony jako ok:true", async () => {
  clearSearchCache();
  const pusty = atrapa("pusty", async () => []);
  const { sources } = await searchAll({ dest: "test-pusty" }, [pusty]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].ok, true);
  assert.equal(sources[0].count, 0);
  assert.equal(sources[0].reason, undefined);
});

test("dostawca z ofertami jest oznaczony jako ok:true z niezerowym count", async () => {
  clearSearchCache();
  const zOfertami = atrapa("zofertami", async () => [offer(), offer({ name: "Drugi Hotel" })]);
  const { sources } = await searchAll({ dest: "test-zofertami" }, [zOfertami]);
  assert.equal(sources[0].ok, true);
  assert.equal(sources[0].count, 2);
});

test("awaria jednego źródła nie trafia do cache — kolejne zapytanie próbuje ponownie", async () => {
  clearSearchCache();
  let wywolania = 0;
  const padajacy = atrapa("padajacy2", async () => {
    wywolania++;
    throw new Error("padlo");
  });
  const crit = { dest: "test-nocache" };
  const pierwsze = await searchAll(crit, [padajacy]);
  assert.equal(pierwsze.cached, undefined);
  const drugie = await searchAll(crit, [padajacy]);
  assert.equal(drugie.cached, undefined);
  assert.equal(wywolania, 2, "awaria nie może zostać zamrożona w cache");
});
