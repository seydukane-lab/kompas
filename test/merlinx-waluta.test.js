// ============================================================
//  MerlinX — waluta obca liczona po ŻYWYM kursie, nie po stałej z kodu
//
//  Do 02.09.2026 w merlinx.js siedziało `priceRaw * 4.3` — kurs wpisany ręcznie
//  w kodzie. Ta sama mina była w hotelbeds.js i została rozbrojona 24.08; tutaj
//  przetrwała, bo bez kluczy MerlinX ta gałąź w ogóle się nie wykonuje.
//
//  Dlaczego to nie jest kosmetyka: konsultant podaje klientowi kwotę policzoną
//  tym przelicznikiem. Kurs wpisany na sztywno nie zestarzeje się głośno — nie
//  rzuci błędu, nie zapali ostrzeżenia, po prostu z każdym miesiącem będzie
//  podawał coraz bardziej nieprawdziwą cenę.
//
//  Kurs ustawiamy PRZED importem i dlatego to osobny plik: fx.js czyta
//  EUR_PLN_FALLBACK przy ładowaniu modułu, a statyczne importy w innych plikach
//  testowych zdążyłyby go wciągnąć wcześniej (ten sam wzorzec co w fx.test.js).
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

process.env.EUR_PLN_FALLBACK = "5";
process.env.FX_MARKUP = "0";

const { normalize } = await import("../src/providers/merlinx.js");

const oferta = (over = {}) => ({ id: "mx1", hotelName: "Hotel Testowy", price: 100, ...over });

test("cena w walucie obcej idzie przez kurs z fx.js, a nie przez liczbę z kodu", () => {
  const wynik = normalize(oferta({ currency: "EUR" }));

  // Przy kursie 5,0 sto euro to 500 zł. Stała 4.3, która tam siedziała, dałaby 430 —
  // i właśnie ta różnica jest tym, co klient zobaczyłby na ofercie.
  assert.equal(wynik.price, 500,
    "waluta obca liczona po stałej z kodu zamiast po żywym kursie NBP");
});

test("cena w PLN nie jest przeliczana ani razu", () => {
  // MerlinX zwykle podaje PLN i wtedy kurs nie ma prawa niczego dotknąć —
  // podwójne przeliczenie byłoby groźniejsze niż stary kurs.
  assert.equal(normalize(oferta({ currency: "PLN" })).price, 100);
  assert.equal(normalize(oferta({})).price, 100, "brak pola waluty domyślnie traktujemy jako PLN");
});

test("kurs nie jest wpisany w kod providera", () => {
  // Zabezpieczenie na przyszłość: nawet gdyby ktoś dopisał drugą ścieżkę cenową,
  // liczba przelicznika nie ma prawa wrócić do tego pliku.
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const kod = readFileSync(join(ROOT, "src/providers/merlinx.js"), "utf8");

  assert.doesNotMatch(kod, /const\s+EUR_PLN\s*=/,
    "wróciła stała z kursem — kurs w kodzie starzeje się po cichu");
  assert.match(kod, /eurToPln/, "provider przestał używać wspólnego przelicznika z fx.js");
});
