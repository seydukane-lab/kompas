// ============================================================
//  Dobór miękkiego limitu na podstawie zmierzonych czasów źródeł
//
//  Chodzi o jedną liczbę (PROVIDER_SOFT_TIMEOUT_MS), ale kosztowną w obie
//  strony: za wysoka to konsultant czekający bez powodu, za niska to źródło
//  wypadające z pierwszej odpowiedzi. Testy pilnują, żeby analiza mówiła
//  o RÓŻNICY W WYNIKU, a nie tylko o sekundach.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { analizaProgu, najwiekszaPrzerwa } from "../src/czasy-zrodel.js";

// Realny rozkład zmierzony 26.08.2026 na żywych źródłach.
const ZMIERZONE = [
  { id: "pl-packages", ms: 9 },
  { id: "hotelbeds", ms: 617 },
  { id: "wakacje", ms: 9245 },
];

test("próg dzieli źródła na te, które zdążyły, i resztę", () => {
  const a = analizaProgu(ZMIERZONE, 6000);
  assert.deepEqual(a.zdazyly, ["pl-packages", "hotelbeds"]);
  assert.deepEqual(a.nieZdazyly, ["wakacje"]);
});

test("czekanie urywa się na progu, gdy któreś źródło nie zdążyło", () => {
  assert.equal(analizaProgu(ZMIERZONE, 6000).czekanie, 6000);
});

test("gdy wszyscy zdążą, czekamy tyle, ile najwolniejszy — nie tyle, ile próg", () => {
  const a = analizaProgu(ZMIERZONE, 30000);
  assert.equal(a.czekanie, 9245);
  assert.deepEqual(a.nieZdazyly, []);
  // Próg przestaje być wąskim gardłem, więc nie ma czego ucinać.
  assert.equal(a.doUciecia, 0);
});

test("dwa różne progi z tej samej przerwy dają IDENTYCZNY podział źródeł", () => {
  const wysoki = analizaProgu(ZMIERZONE, 6000);
  const niski = analizaProgu(ZMIERZONE, 2000);
  assert.deepEqual(niski.zdazyly, wysoki.zdazyly);
  assert.deepEqual(niski.nieZdazyly, wysoki.nieZdazyly);
  // Ta sama lista źródeł, a konsultant czeka cztery sekundy krócej.
  assert.equal(wysoki.czekanie - niski.czekanie, 4000);
});

test("doUciecia mierzy czekanie do oddania BEZ zmiany wyniku", () => {
  // 6000 można zejść do 617 ms (czas Hotelbeds) i dostać to samo.
  assert.equal(analizaProgu(ZMIERZONE, 6000).doUciecia, 6000 - 617);
});

test("zejście poniżej dolnej granicy WYRZUCA źródło z wyniku", () => {
  const a = analizaProgu(ZMIERZONE, 500);
  assert.deepEqual(a.zdazyly, ["pl-packages"]);
  // To już nie jest oszczędność czasu, tylko utrata Hotelbeds z pierwszej odpowiedzi.
  assert.ok(a.nieZdazyly.includes("hotelbeds"));
});

test("przedział równoważny sięga od najwolniejszego, który zdążył, do najszybszego, który nie", () => {
  const a = analizaProgu(ZMIERZONE, 6000);
  assert.deepEqual(a.rownowazne, { od: 617, do: 9245 });
});

test("gdy nikt nie wypada, górna granica jest nieskończona, a nie zmyślona", () => {
  assert.equal(analizaProgu(ZMIERZONE, 30000).rownowazne.do, Infinity);
});

test("największa przerwa wskazuje miejsce między skupiskami czasów", () => {
  assert.deepEqual(najwiekszaPrzerwa(ZMIERZONE), { od: 617, do: 9245, szerokosc: 8628 });
});

test("jedno źródło nie tworzy przerwy — null zamiast liczby udającej pomiar", () => {
  assert.equal(najwiekszaPrzerwa([{ id: "pl-packages", ms: 9 }]), null);
  assert.equal(najwiekszaPrzerwa([]), null);
});

test("źródło bez zmierzonego czasu (pominięte, padło przed odpowiedzią) nie liczy się do progu", () => {
  const z = [...ZMIERZONE, { id: "merlinx", ms: null }, { id: "travellead" }];
  const a = analizaProgu(z, 6000);
  assert.deepEqual(a.zdazyly, ["pl-packages", "hotelbeds"]);
  assert.deepEqual(a.nieZdazyly, ["wakacje"]);
  assert.equal(najwiekszaPrzerwa(z).szerokosc, 8628);
});
