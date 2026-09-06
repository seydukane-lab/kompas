// ============================================================
//  MerlinX i TravelLead: brak danych zostaje brakiem — a fakt faktem
//
//  Zadanie 2 z docs/nocny-kolejka.md, wykonane przez nocnego 06.09.2026.
//  Jego commity przepadły razem z kontenerem (push odrzucony — patrz raport),
//  więc praca jest tu odtworzona z logu sesji.
//
//  Oba providery mapują realne zewnętrzne API na wspólny kształt oferty i miały
//  ZERO testów pilnujących granicy „brak danych zostaje brakiem". Pliki są bogato
//  okomentowane w duchu anty-przekoloryzacji, ale komentarz bez testu niczego
//  nie pilnuje.
//
//  Przy okazji wyszedł realny błąd, ten sam w obu plikach:
//  `beach: Number(x) || null` zamieniało PRAWDZIWE 0 (hotel dosłownie na plaży)
//  w „brak danych", bo zero jest falsy. To ta sama pomyłka co udawanie wiedzy,
//  tylko w drugą stronę — zamiast zmyślić fakt, gubimy potwierdzony.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { normalize as normalizeMX } from "../src/providers/merlinx.js";
import { normalize as normalizeTL } from "../src/providers/travellead.js";

const mx = (over = {}) => normalizeMX({ id: "mx1", hotelName: "Hotel", price: 1000, ...over });
const tl = (over = {}) => normalizeTL({ id: "tl1", name: "Hotel", price: 1000, ...over });

test("MerlinX: hotel DOSŁOWNIE na plaży nie staje się ofertą bez danych", () => {
  // 0 metrów to najmocniejsza informacja, jaką można podać o odległości od plaży —
  // i właśnie ona ginęła. Konsultant tracił argument, który miał potwierdzony.
  assert.equal(mx({ beachDistance: 0 }).beach, 0,
    "realne 0 zamienione w brak danych — hotel przy samej plaży stracił swoją najlepszą cechę");
  assert.equal(mx({ beachDistance: 250 }).beach, 250);
});

test("TravelLead: to samo zero, ten sam błąd, ten sam wymóg", () => {
  assert.equal(tl({ beachDistance: 0 }).beach, 0);
  assert.equal(tl({ odlegloscOdPlazy: 0 }).beach, 0, "alias pola też musi przepuścić zero");
  assert.equal(tl({ beachDistance: 120 }).beach, 120);
});

test("brak odległości od plaży zostaje brakiem, nie zerem", () => {
  // Odwrotny kierunek tej samej zasady: pusty string i brak pola NIE MOGĄ stać się
  // zerem, bo Number("") to 0 — czyli twierdzenie „plaża przy hotelu".
  for (const puste of [undefined, null, ""]) {
    assert.equal(mx({ beachDistance: puste }).beach, null,
      `MerlinX zamienił ${JSON.stringify(puste)} w liczbę — to zmyślony fakt o hotelu`);
    assert.equal(tl({ beachDistance: puste }).beach, null,
      `TravelLead zamienił ${JSON.stringify(puste)} w liczbę`);
  }
  assert.equal(mx({ beachDistance: "nie wiadomo" }).beach, null, "śmieć w polu ma dać brak danych");
});

test("nieznana kategoria hotelu nie dostaje domyślnych gwiazdek", () => {
  // Trzy gwiazdki wpisane „na wszelki wypadek" to ocena obiektu, której nikt nie wystawił.
  assert.equal(mx({}).stars, undefined, "MerlinX dorobił gwiazdki hotelowi, który ich nie podał");
  assert.equal(mx({ stars: 4 }).stars, 4);
});

test("nieznany kod wyżywienia zostaje nieznany", () => {
  // „BB" jako domyślne byłoby obietnicą śniadań, których nikt nie potwierdził.
  // Nieznany kod zostaje SUROWY (albo pusty) — i to jest uczciwe: konsultant widzi,
  // że kodu nie znamy. Błędem byłoby zamienić go w konkretne wyżywienie, np. „BB",
  // czyli obietnicę śniadań, których nikt nie potwierdził.
  const nieznany = mx({ board: "XYZ" }).board;
  assert.ok(nieznany === undefined || nieznany === "XYZ",
    `nieznany kod zamieniony w konkretne wyżywienie: ${JSON.stringify(nieznany)}`);
  assert.notEqual(nieznany, "BB", "nieznany kod stał się obietnicą śniadań");
  assert.equal(mx({ board: "AI" }).board, "All Inclusive");
  assert.equal(mx({ board: "UAI" }).board, "Ultra All Inclusive");
});

test("transfer jest „w cenie” tylko wtedy, gdy źródło to potwierdza", () => {
  // Domyślne `true` sprzedawałoby usługę, o której nic nie wiemy.
  assert.notEqual(mx({}).transferIncluded, true, "transfer obiecany bez potwierdzenia w danych");
  assert.notEqual(tl({}).transferIncluded, true);
});
