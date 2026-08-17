// ============================================================
//  Kontrakt kształtu oferty
//
//  Cały system — ranking, filtry, karty, koszyk, raport doradcy — pracuje
//  na jednym uzgodnionym kształcie oferty. Dostawcy różnią się wszystkim,
//  ale to, co z nich wychodzi, musi wyglądać tak samo. Gdy nowy provider
//  zapomni o polu `country`, nic nie wybuchnie: oferta po prostu przestanie
//  przechodzić przez filtr geograficzny i zniknie z wyników bez śladu.
//
//  Ten plik jest siatką bezpieczeństwa dla każdego przyszłego dostawcy.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { searchAll, clearSearchCache, activeProviders } from "../src/providers/index.js";
import { applyFilters, scoreOffer, sortOffers } from "../src/ranking.js";

const KRYTERIA = { dest: "Egipt", adults: 2, kids: 0, pax: 2 };

let oferty = [];
test.before(async () => {
  clearSearchCache();
  const wynik = await searchAll(KRYTERIA);
  oferty = wynik.offers;
});

test("jest z czego testować", () => {
  assert.ok(activeProviders().length > 0, "żaden dostawca nie jest aktywny");
  assert.ok(oferty.length > 0, "wyszukiwanie nie zwróciło ofert — reszta testów nie miałaby sensu");
});

test("każda oferta ma pola, bez których zniknie z wyników", () => {
  for (const o of oferty) {
    assert.ok(o.id, `oferta bez id: ${o.name}`);
    assert.ok(o.name, `oferta bez nazwy (${o.id})`);
    assert.ok(o.country, `oferta bez kraju (${o.name}) — wypadnie z filtra geograficznego`);
    assert.equal(typeof o.price, "number", `cena nie jest liczbą (${o.name})`);
    assert.ok(o.price > 0, `cena zerowa lub ujemna (${o.name}): ${o.price}`);
  }
});

test("identyfikatory ofert są unikalne", () => {
  const widziane = new Set();
  for (const o of oferty) {
    assert.ok(!widziane.has(o.id), `zduplikowane id: ${o.id} (${o.name})`);
    widziane.add(o.id);
  }
});

test("oceny i opinie mieszczą się w sensownych zakresach", () => {
  for (const o of oferty) {
    if (o.rating != null) {
      assert.ok(o.rating >= 0 && o.rating <= 10, `ocena poza skalą 0-10 (${o.name}): ${o.rating}`);
    }
    if (o.reviews != null) {
      assert.ok(Number.isFinite(o.reviews) && o.reviews >= 0, `liczba opinii bez sensu (${o.name}): ${o.reviews}`);
    }
    if (o.stars != null) {
      assert.ok(o.stars >= 1 && o.stars <= 5, `gwiazdki poza zakresem (${o.name}): ${o.stars}`);
    }
  }
});

test("ANTY-PRZEKOLORYZACJA: brak opinii nie udaje wysokiej oceny", () => {
  for (const o of oferty) {
    if (o.reviews === 0 && o.rating >= 9.5) {
      assert.fail(`${o.name} ma ocenę ${o.rating} przy zerowej liczbie opinii — to jest dokładnie to, czego nie robimy`);
    }
  }
});

test("cena łączna jest spójna z ceną za osobę", () => {
  for (const o of oferty) {
    if (o.priceTotal > 0) {
      // Cena łączna nie może być niższa od ceny za jedną osobę.
      assert.ok(o.priceTotal >= o.price, `${o.name}: razem ${o.priceTotal} < za osobę ${o.price}`);
    }
  }
});

// Suma bez deklaracji, dla ilu osób ją policzono, jest liczbą bez znaczenia:
// dla pary bywa prawdziwa, dla rodziny 2+3 zaniża rachunek ponad dwukrotnie
// (zmierzone 17.08.2026). Dostawca, który podaje `priceTotal`, MUSI podać skład.
test("każda podana cena łączna mówi, dla ilu osób jest policzona", () => {
  const zSuma = oferty.filter((o) => typeof o.priceTotal === "number" && o.priceTotal > 0);
  assert.ok(zSuma.length > 0, "żadna oferta nie ma ceny łącznej — test nie miałby czego pilnować");
  for (const o of zSuma) {
    assert.equal(typeof o.priceTotalPax, "number",
      `${o.name}: podaje priceTotal ${o.priceTotal} zł, ale nie mówi, dla ilu osób`);
    assert.ok(o.priceTotalPax >= 1, `${o.name}: priceTotalPax musi być dodatnie`);
  }
});

test("warianty niosą sumę razem z jej składem, a brak sumy zostaje brakiem", () => {
  const zWariantami = oferty.filter((o) => (o.variants || []).length > 0);
  assert.ok(zWariantami.length > 0, "brak ofert z wariantami — test nie miałby czego pilnować");
  for (const o of zWariantami) {
    for (const v of o.variants) {
      assert.notEqual(v.priceTotal, 0,
        `${o.name}: wariant ma priceTotal 0 — «0 zł za grupę» to nieprawda, brak sumy ma być brakiem`);
      if (typeof v.priceTotal === "number") {
        assert.equal(typeof v.priceTotalPax, "number",
          `${o.name}: wariant podaje sumę bez informacji, dla ilu osób`);
      }
    }
  }
});

test("oferty pakietowe mają komplet danych wyjazdu", () => {
  for (const o of oferty.filter((x) => x.type === "package")) {
    assert.ok(o.departureCity, `pakiet bez miasta wylotu: ${o.name}`);
    assert.ok(o.nights > 0, `pakiet bez liczby nocy: ${o.name}`);
  }
});

test("pola tekstowe nie są puste ani „undefined” w treści", () => {
  for (const o of oferty) {
    for (const pole of ["name", "region", "country", "board"]) {
      const v = o[pole];
      if (v == null) continue;
      assert.equal(typeof v, "string", `${pole} nie jest tekstem (${o.name})`);
      assert.ok(!/undefined|null|NaN/.test(v), `${pole} zawiera śmieci: „${v}" (${o.name})`);
    }
  }
});

test("cały łańcuch filtr → scoring → sortowanie przechodzi bez wyjątku", () => {
  const przefiltrowane = applyFilters(oferty, KRYTERIA);
  const ocenione = przefiltrowane.map((o) => scoreOffer(o, KRYTERIA));
  const posortowane = sortOffers(ocenione, "score");

  assert.ok(posortowane.length > 0, "po przefiltrowaniu nie zostało nic");
  for (const o of posortowane) {
    assert.ok(Number.isFinite(o.score), `score nie jest liczbą (${o.name}): ${o.score}`);
    assert.ok(Number.isFinite(o.valueScore), `valueScore nie jest liczbą (${o.name})`);
    assert.ok(o.valueScore >= 0 && o.valueScore <= 100, `valueScore poza 0-100 (${o.name}): ${o.valueScore}`);
    assert.ok(o.trust >= 0 && o.trust <= 1, `trust poza 0-1 (${o.name}): ${o.trust}`);
  }
  // Sortowanie po trafności: kolejne oferty nie mogą mieć wyższego score.
  for (let i = 1; i < posortowane.length; i++) {
    assert.ok(posortowane[i].score <= posortowane[i - 1].score, "lista nie jest posortowana po trafności");
  }
});

test("filtr budżetu nie przepuszcza niczego ponad limit", () => {
  const limit = 4000;
  const wynik = applyFilters(oferty, { ...KRYTERIA, budget: limit, budgetMode: "person" });
  for (const o of wynik) {
    assert.ok(o.price <= limit, `${o.name} kosztuje ${o.price}, a limit to ${limit}`);
  }
});

test("każdy dostawca zwraca oferty oznaczone swoim źródłem", () => {
  for (const o of oferty) {
    assert.ok(o.source || (o.mergedFrom && o.mergedFrom.length),
      `oferta bez informacji o źródle: ${o.name}`);
  }
});
