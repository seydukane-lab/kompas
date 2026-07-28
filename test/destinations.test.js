// ============================================================
//  Wiedza o kierunkach i dane krajów
//
//  Ta baza jest jedynym miejscem, z którego doradca bierze twarde fakty
//  o kierunku — czerwone flagi, na co uważać, dla kogo dany kierunek jest.
//  Jeśli tu zrobi się dziura, model zacznie zmyślać, a to jest dokładnie
//  to, przed czym ma chronić zasada anty-przekoloryzacji.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { allDestinations, destIntel } from "../src/destinations.js";
import { clientData, regionInfo } from "../src/countries.js";

test("baza kierunków nie jest pusta", () => {
  const wszystkie = allDestinations();
  assert.ok(Array.isArray(wszystkie));
  assert.ok(wszystkie.length >= 30, `tylko ${wszystkie.length} kierunków — to za mało jak na tę bazę`);
});

test("każdy kierunek ma komplet pól, na których stoi doradca", () => {
  for (const d of allDestinations()) {
    assert.ok(Array.isArray(d.keys) && d.keys.length, `kierunek bez słów kluczowych: ${JSON.stringify(d).slice(0, 80)}`);
    for (const pole of ["vibe", "forWho", "watch", "tip"]) {
      assert.ok(typeof d[pole] === "string" && d[pole].trim(), `kierunek ${d.keys[0]} bez pola ${pole}`);
    }
  }
});

test("słowa kluczowe kierunków się nie powtarzają", () => {
  const widziane = new Map();
  for (const d of allDestinations()) {
    for (const k of d.keys) {
      const klucz = k.toLowerCase();
      assert.ok(!widziane.has(klucz), `słowo „${k}" pasuje do dwóch kierunków: ${widziane.get(klucz)} i ${d.keys[0]}`);
      widziane.set(klucz, d.keys[0]);
    }
  }
});

test("dopasowanie kierunku działa mimo polskich znaków i wielkości liter", () => {
  const a = destIntel("Hurghada", "Egipt");
  assert.ok(a, "Hurghada musi być rozpoznana");
  // destIntel oddaje tylko treść dla doradcy (bez słów kluczowych), więc
  // porównujemy po treści — ta sama nazwa zapisana inaczej to ten sam kierunek.
  assert.equal(destIntel("HURGHADA", "EGIPT")?.vibe, a.vibe);
  assert.equal(destIntel("hurghada", "")?.vibe, a.vibe);
  assert.equal(destIntel("  Hurghada  ", "Egipt")?.vibe, a.vibe);
});

test("wynik dla doradcy nie zawiera pól technicznych", () => {
  const w = destIntel("Hurghada", "Egipt");
  assert.ok(!("keys" in w), "słowa kluczowe to detal wyszukiwania, nie treść dla klienta");
  for (const pole of ["vibe", "forWho", "watch", "tip"]) {
    assert.ok(w[pole], `brak pola ${pole}`);
  }
});

test("nieznany kierunek zwraca brak wiedzy, a nie przypadkowy wpis", () => {
  assert.equal(destIntel("Wakanda", "Wakanda"), null);
  assert.equal(destIntel("", ""), null);
  assert.equal(destIntel(null, undefined), null);
});

test("ostrzeżenia o kierunku są konkretne, nie ogólnikowe", () => {
  for (const d of allDestinations()) {
    assert.ok(d.watch.length > 15, `ostrzeżenie dla ${d.keys[0]} jest zbyt ogólne: „${d.watch}"`);
  }
});

test("baza krajów zawiera kierunki, na których stoi polski rynek", () => {
  const kraje = clientData();
  for (const kraj of ["Egipt", "Grecja", "Turcja", "Hiszpania", "Włochy"]) {
    assert.ok(kraje[kraj], `brak kraju: ${kraj}`);
    assert.ok(Array.isArray(kraje[kraj].regions) && kraje[kraj].regions.length, `${kraj} bez regionów`);
  }
});

test("każdy kraj ma komplet informacji praktycznych dla klienta", () => {
  const kraje = clientData();
  for (const [nazwa, dane] of Object.entries(kraje)) {
    assert.ok(dane.regions?.length, `${nazwa} bez regionów`);
    assert.ok(dane.practical, `${nazwa} bez informacji praktycznych`);
    // To są dane, które konsultant przekazuje klientowi jako fakty — dokumenty
    // i wiza decydują o tym, czy klient w ogóle wjedzie do kraju.
    for (const pole of ["documents", "visa", "currency"]) {
      const v = dane.practical[pole];
      assert.ok(typeof v === "string" && v.trim().length > 5, `${nazwa}: puste lub szczątkowe pole „${pole}"`);
    }
  }
});

test("kraje mają flagę do wyświetlenia w panelu", () => {
  for (const [nazwa, dane] of Object.entries(clientData())) {
    assert.ok(dane.flag, `${nazwa} bez flagi`);
  }
});

test("regiony nie powtarzają się między krajami", () => {
  const widziane = new Map();
  for (const [kraj, dane] of Object.entries(clientData())) {
    for (const r of dane.regions) {
      assert.ok(!widziane.has(r), `region „${r}" występuje w dwóch krajach: ${widziane.get(r)} i ${kraj}`);
      widziane.set(r, kraj);
    }
  }
});

test("regiony rozpoznawane są po nazwie z panelu", () => {
  const kraje = clientData();
  const jakisRegion = kraje["Egipt"].regions[0];
  const info = regionInfo(jakisRegion);
  assert.ok(info, `region „${jakisRegion}" z panelu musi być rozpoznawalny`);
});
