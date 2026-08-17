// ============================================================
//  Uśpione źródła: TravelLead i MerlinX
//
//  Oba są w repo i na liście dostawców, ale bez kluczy się nie włączają —
//  i właśnie dlatego nikt nigdy nie sprawdził, co robią z brakującymi danymi.
//  A robiły dokładnie to, czego cały projekt zakazuje: uzupełniały luki
//  wygodnymi domyślnymi wartościami. Hotel bez podanej odległości od plaży
//  dostawał „300 m", hotel bez kategorii „3 gwiazdki", oferta bez informacji
//  o transferze — obietnicę „transfer w cenie", za którą klient płaci osobno.
//
//  To są miny: nic nie robią, dopóki ktoś nie wpisze kluczy do .env, a potem
//  wypalają na karcie oferty jako fakty o hotelu.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { normalize as normalizeTL } from "../src/providers/travellead.js";
import { normalize as normalizeMX } from "../src/providers/merlinx.js";
import { normalize as normalizeHB } from "../src/providers/hotelbeds.js";

// Minimum, przy którym oferta w ogóle powstaje — reszta pól celowo pusta,
// bo to właśnie brak danych jest tu przedmiotem badania.
const SUROWA_TL = { hotelName: "Hotel Bez Danych", price: 2500 };
const SUROWA_MX = { id: "mx1", hotelName: "Hotel Bez Danych", price: 2500 };

test("TravelLead nie zmyśla odległości od plaży, kategorii ani wyżywienia", () => {
  const o = normalizeTL(SUROWA_TL);
  assert.equal(o.beach, null, "brak odległości od plaży pokazywał się na karcie jako „plaża 300 m”");
  assert.equal(o.stars, undefined, "brak kategorii zamieniał się w trzy gwiazdki");
  assert.equal(o.board, undefined, "brak informacji o wyżywieniu zamieniał się w BB (śniadania)");
  assert.equal(o.capUnknown, true, "pojemność zgadywana z gwiazdek — konsultant sadza po niej realną rodzinę");
  assert.equal(o.transferIncluded, undefined, "brak informacji o transferze stawał się obietnicą „transfer w cenie”");
});

test("TravelLead nie wystawia oceny hotelowi, o którym nic nie wie", () => {
  const bezDanych = normalizeTL(SUROWA_TL);
  assert.equal(bezDanych.rating, 0, "ocena wyliczana ze zgadniętych gwiazdek to liczba, której nikt nie wystawił");
  assert.equal(bezDanych.reviews, 0);

  // Gdy kategoria JEST znana, szacunek z gwiazdek zostaje — tak samo jak w Hotelbeds,
  // i tak samo opisany w panelu jako „brak danych o opiniach" (reviews: 0).
  const zKategoria = normalizeTL({ ...SUROWA_TL, stars: "4" });
  assert.equal(zKategoria.stars, 4);
  assert.ok(zKategoria.rating > 0, "przy znanej kategorii szacunek oceny zostaje bez zmian");
});

test("TravelLead przepuszcza dane, które feed REALNIE podał", () => {
  const o = normalizeTL({
    hotelName: "Hotel Z Danymi", price: 3000, stars: "5", beachDistance: 120,
    board: "all inclusive", maxPax: 4, transferIncluded: true, rating: 8.9, reviews: 1200,
  });
  assert.equal(o.stars, 5);
  assert.equal(o.beach, 120);
  assert.equal(o.board, "All Inclusive");
  assert.equal(o.cap, 4);
  assert.equal(o.capUnknown, false);
  assert.equal(o.transferIncluded, true);
  assert.equal(o.rating, 8.9);
});

test("MerlinX nie zmyśla odległości od plaży, kategorii ani wyżywienia", () => {
  const o = normalizeMX(SUROWA_MX);
  assert.equal(o.beach, null, "domyślne 300 m trafiało na kartę jako fakt o hotelu");
  assert.equal(o.stars, undefined, "brak kategorii zamieniał się w trzy gwiazdki");
  assert.equal(o.board, undefined, "nieznany kod wyżywienia zamieniał się w BB");
  assert.equal(o.capUnknown, true);
  assert.equal(o.transferIncluded, undefined,
    "zapis `!== false` zamieniał BRAK informacji w obietnicę transferu w cenie");
});

test("MerlinX przepuszcza dane, które system REALNIE podał", () => {
  const o = normalizeMX({
    id: "mx2", hotelName: "Hotel Z Danymi", price: 4000, stars: 5, beachDistance: 80,
    boardCode: "UAI", maxPax: 5, transferIncluded: true, rating: 9.1, reviewsCount: 340,
  });
  assert.equal(o.stars, 5);
  assert.equal(o.beach, 80);
  assert.equal(o.board, "Ultra All Inclusive");
  assert.equal(o.cap, 5);
  assert.equal(o.capUnknown, false);
  assert.equal(o.transferIncluded, true);
  assert.equal(o.rating, 9.1);
  assert.equal(o.reviews, 340);
});

// Hotelbeds nie ma recenzji w Content API i szacuje ocenę z kategorii. Odkąd
// mapStars zwraca undefined dla kodów spoza słownika, szacunek liczył
// `6 + undefined * 0.6` = NaN — a NaN po serializacji JSON staje się `null`
// i wypada z każdego progu oceny.
test("Hotelbeds nie produkuje oceny NaN, gdy nie zna kategorii", () => {
  // Kod kategorii spoza słownika → mapStars zwraca undefined → szacunek nie ma
  // z czego liczyć. Wynikiem musi być BRAK oceny, nigdy NaN (po serializacji `null`,
  // które wypada z każdego progu oceny i psuje porównania w rankingu).
  const bezKategorii = normalizeHB({ code: 1, name: "Hotel Bez Kategorii", categoryCode: "XYZ" }, {}, { net: 100 }, 2);
  assert.equal(bezKategorii.stars, undefined, "nieznany kod kategorii miał dać brak gwiazdek");
  assert.ok(!Number.isNaN(bezKategorii.rating), "ocena wyszła jako NaN");
  assert.equal(bezKategorii.rating, undefined, "bez kategorii nie ma z czego szacować oceny");

  // Znana kategoria → szacunek zostaje, tak jak dotąd.
  const zKategoria = normalizeHB({ code: 2, name: "Hotel 4*", categoryCode: "4EST" }, {}, { net: 100 }, 2);
  assert.equal(zKategoria.stars, 4);
  assert.ok(Number.isFinite(zKategoria.rating) && zKategoria.rating > 6,
    "przy znanej kategorii szacunek oceny ma działać jak dotąd");
});

// Ta sama reguła dla obu źródeł — gdyby ktoś poprawił jedno i zapomniał o drugim.
test("żadne z uśpionych źródeł nie wypełnia braków wartościami domyślnymi", () => {
  for (const [nazwa, oferta] of [["TravelLead", normalizeTL(SUROWA_TL)], ["MerlinX", normalizeMX(SUROWA_MX)]]) {
    assert.ok(!(oferta.beach > 0), `${nazwa}: podaje odległość od plaży, choć jej nie zna`);
    assert.ok(!oferta.stars, `${nazwa}: podaje kategorię, choć jej nie zna`);
    assert.ok(!oferta.board, `${nazwa}: podaje wyżywienie, choć go nie zna`);
    assert.ok(!oferta.transferIncluded, `${nazwa}: obiecuje transfer, choć nie ma potwierdzenia`);
    assert.equal(oferta.capUnknown, true, `${nazwa}: nie oznacza nieznanej pojemności`);
  }
});
