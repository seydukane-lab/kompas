// ============================================================
//  Reguły audytu
//
//  Audyt chodzi po ŻYWYCH źródłach i wyłapuje klasę błędów, której testy na
//  atrapach nie widzą. Sama reguła musi jednak być weryfikowalna — inaczej może
//  się cicho zepsuć i audyt przestanie zgłaszać to, po co go napisano.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { podejrzaneZero, PROG_CISZY_MS } from "../src/audyt-reguly.js";

// Wpis w sources[] taki, jaki realnie wraca z /api/search.
const zrodlo = (over = {}) => ({ id: "x", label: "Źródło", count: 0, ok: true, ms: 5, ...over });

test("zero ofert po kilkunastu sekundach to połknięty błąd, nie brak wyników", () => {
  // Zmierzone 26.08.2026 na lokalnym wakacje.pl: 25 timeoutów w jednym przebiegu
  // audytu, każdy zaraportowany jako ok:true / 0 ofert. Panel milczał, więc
  // konsultant czytał to jako „w tym terminie nic nie ma".
  assert.equal(podejrzaneZero(zrodlo({ ms: 15015 })), true,
    "zero ofert po 15 s nie zostało uznane za podejrzane — awaria dalej udaje brak wyników");
});

test("uczciwe zero przychodzi szybko i nie jest zgłaszane", () => {
  // Katalog PL odpowiada w 4–7 ms. Źródło, które naprawdę nic nie ma, musi mieć
  // prawo powiedzieć „nic nie ma" bez podejrzeń — inaczej audyt zacznie hałasować.
  assert.equal(podejrzaneZero(zrodlo({ ms: 6 })), false,
    "szybkie, uczciwe zero zgłoszone jako awaria — fałszywy alarm w audycie");
  assert.equal(podejrzaneZero(zrodlo({ ms: PROG_CISZY_MS - 1 })), false,
    "wartość tuż pod progiem zgłoszona — próg nie jest progiem");
  assert.equal(podejrzaneZero(zrodlo({ ms: PROG_CISZY_MS })), true,
    "wartość dokładnie na progu nie została zgłoszona");
});

test("źródło, które COŚ zwróciło, nie jest podejrzane, choćby było wolne", () => {
  // Wolne źródło z ofertami to problem wydajności, nie uczciwości — a ta reguła
  // pyta wyłącznie o to, czy zero jest prawdziwe.
  assert.equal(podejrzaneZero(zrodlo({ count: 12, ms: 20000 })), false,
    "wolne źródło z ofertami zgłoszone jako połknięty błąd");
});

test("padnięte i pominięte źródła mają własny opis — reguła ich nie dubluje", () => {
  // ok:false niesie `reason` i trafia do czerwonego paska; skipped (ok:null) ma
  // swój spokojny komunikat. Zgłaszanie ich tutaj byłoby drugim głosem o tym samym.
  assert.equal(podejrzaneZero(zrodlo({ ok: false, ms: 15000, reason: "HTTP 403" })), false,
    "padnięte źródło zgłoszone drugi raz jako połknięty błąd");
  assert.equal(podejrzaneZero(zrodlo({ ok: null, skipped: true, ms: 15000 })), false,
    "pominięte źródło (brak kluczy) potraktowane jak awaria");
});

test("czas z cache nie mówi nic o dostawcy", () => {
  // Przy odpowiedzi z pamięci `ms` opisuje odczyt z cache, nie odpytanie źródła.
  // Bez tego wyjątku stary wpis z zerem ofert wyglądałby jak świeża awaria.
  assert.equal(podejrzaneZero(zrodlo({ cached: true, wiek: 12, ms: 15000 })), false,
    "wpis z cache oceniony tak, jakby to był czas odpowiedzi dostawcy");
});

test("brak danych o czasie nie jest dowodem awarii", () => {
  assert.equal(podejrzaneZero(zrodlo({ ms: undefined })), false,
    "źródło bez zmierzonego czasu uznane za podejrzane — reguła zgaduje");
  assert.equal(podejrzaneZero(null), false, "brak wpisu wywraca regułę");
});
