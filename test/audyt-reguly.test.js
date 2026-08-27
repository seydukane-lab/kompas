// ============================================================
//  Reguły audytu
//
//  Audyt chodzi po ŻYWYCH źródłach i wyłapuje klasę błędów, której testy na
//  atrapach nie widzą. Sama reguła musi jednak być weryfikowalna — inaczej może
//  się cicho zepsuć i audyt przestanie zgłaszać to, po co go napisano.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { podejrzaneZero, PROG_CISZY_MS, ocenObietnice, filtrPrzecieka, filtrBezPotwierdzen, rozproszenieZWariantow, plakietkiRozproszenia } from "../src/audyt-reguly.js";

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

// ============================================================
//  Czy filtr dotrzymał obietnicy
//
//  Reguła powstała po nocy 26/27.08.2026, gdy okazało się, że filtr o nieznanej
//  nazwie klucza przepuszczał CAŁY katalog, a panel liczył go jako aktywny.
//  Rozróżnienie „brak danych" vs „jawne złamanie" jest tu całą treścią: pierwsze
//  jest świadomą zasadą produktu, drugie to przeciek filtra.
// ============================================================

const gwiazdki = (o) => o.stars != null;
const piec = (o) => o.stars >= 5;

test("oferta, o której wiemy, że kryterium nie spełnia, to przeciek filtra", () => {
  const ocena = ocenObietnice(
    [{ name: "A", stars: 5 }, { name: "B", stars: 3 }, { name: "C", stars: null }],
    gwiazdki, piec);

  assert.equal(ocena.razem, 3);
  assert.equal(ocena.potwierdza, 1, "potwierdzona oferta nie została policzona");
  assert.equal(ocena.bezDanych, 1, "nieznana kategoria potraktowana jak odpowiedź");
  assert.equal(ocena.lamie, 1, "oferta jawnie łamiąca kryterium nie została wykryta");
  assert.equal(ocena.przyklady[0].name, "B", "raport nie wskaże konkretnej oferty");
  assert.equal(filtrPrzecieka(ocena), true, "przeciek filtra nie zostanie zgłoszony");
});

test("brak danych nie jest złamaniem kryterium — to świadoma zasada, nie błąd", () => {
  const ocena = ocenObietnice([{ stars: null }, { stars: undefined }], gwiazdki, piec);

  assert.equal(ocena.lamie, 0,
    "brak danych policzony jako złamanie — audyt zacząłby alarmować o zdrowym zachowaniu");
  assert.equal(filtrPrzecieka(ocena), false, "same niewiadome zgłoszone jako przeciek");
  // Ale cisza na ten temat też jest błędem: filtr niczego nie gwarantuje.
  assert.equal(filtrBezPotwierdzen(ocena), true,
    "filtr bez ani jednego potwierdzenia przeszedł niezauważony — lista udaje zawężoną");
});

test("zero wyników to uczciwa odpowiedź, nie cicha obietnica", () => {
  const ocena = ocenObietnice([], gwiazdki, piec);

  assert.equal(ocena.razem, 0);
  assert.equal(filtrBezPotwierdzen(ocena), false,
    "pusta lista zgłoszona jako filtr bez potwierdzeń — audyt hałasowałby przy każdym „nic nie pasuje");
  assert.equal(filtrPrzecieka(ocena), false, "pusta lista zgłoszona jako przeciek");
  assert.equal(ocenObietnice(null, gwiazdki, piec).razem, 0, "brak listy wywraca regułę");
});

test("komplet potwierdzeń nie wywołuje żadnego alarmu", () => {
  const ocena = ocenObietnice([{ stars: 5 }, { stars: 5 }], gwiazdki, piec);

  assert.equal(ocena.potwierdza, 2);
  assert.equal(filtrPrzecieka(ocena), false, "zdrowy filtr zgłoszony jako przeciekający");
  assert.equal(filtrBezPotwierdzen(ocena), false, "zdrowy filtr zgłoszony jako pusty");
});

test("przecieku nie da się zagłuszyć niewiadomymi", () => {
  // Jedna jawnie zła oferta w tłumie niewiadomych to dalej przeciek — i tylko
  // ta jedna ma trafić do raportu, a nie cała reszta listy.
  const lista = [{ name: "zla", stars: 2 }];
  for (let i = 0; i < 40; i++) lista.push({ name: "nieznana" + i, stars: null });
  const ocena = ocenObietnice(lista, gwiazdki, piec);

  assert.equal(filtrPrzecieka(ocena), true, "przeciek utonął w niewiadomych");
  assert.equal(ocena.przyklady.length, 1, "raport puchnie zamiast wskazać przykłady");
  assert.equal(filtrBezPotwierdzen(ocena), false,
    "lista z przeciekiem zgłoszona TAKŻE jako pusta — jedno znalezisko zamieniłoby się w dwa");
});

// ============================================================
//  Plakietka „terminy rozproszone" — sprawdzana niezależnie
//
//  Panel twierdzi, że ŻADEN pojedynczy termin nie spełnia wszystkich filtrów naraz.
//  Konsultant uprzedza na tej podstawie klienta, że wyjazd trzeba poskładać inaczej,
//  niż wygląda na karcie. Audyt liczy to OD NOWA z wariantów, a nie przez ranking.js —
//  inaczej potwierdzałby sam siebie i przespał błąd obecny po obu stronach naraz.
// ============================================================

// Wariant pakietu: tylko pola, po których filtruje się termin.
const wariant = (over = {}) => ({ departureCity: "Katowice", transport: "Samolot", departDate: "2026-09-05", ...over });
// 2026-09-05 to sobota, 2026-09-06 niedziela — dni tygodnia liczone jak Date#getDay.
const pakiet = (warianty) => ({ id: "p", name: "Hotel", type: "package", variants: warianty });

test("rozproszenie widać dopiero wtedy, gdy ŻADEN termin nie łapie kompletu", () => {
  const kryteria = { departures: ["Katowice"], weekdays: [6] };

  // Jeden wariant spełnia oba kryteria naraz — nie ma rozproszenia.
  assert.equal(rozproszenieZWariantow(pakiet([
    wariant({ departureCity: "Katowice", departDate: "2026-09-05" }),
    wariant({ departureCity: "Warszawa", departDate: "2026-09-06" }),
  ]), kryteria), false, "oferta z pasującym terminem oznaczona jako rozproszona");

  // Każde kryterium spełnia INNY wariant — to właśnie rozproszenie.
  assert.equal(rozproszenieZWariantow(pakiet([
    wariant({ departureCity: "Katowice", departDate: "2026-09-06" }),
    wariant({ departureCity: "Warszawa", departDate: "2026-09-05" }),
  ]), kryteria), true, "rozproszenie przeoczone — konsultant obieca wyjazd, którego nie ma");
});

test("bez dwóch kryteriów albo dwóch terminów nie ma o czym mówić", () => {
  const dwa = [wariant(), wariant({ departureCity: "Warszawa" })];

  assert.equal(rozproszenieZWariantow(pakiet(dwa), { departures: ["Katowice"] }), null,
    "jedno kryterium nie ma się jak rozproszyć — flaga z definicji nie powstaje");
  assert.equal(rozproszenieZWariantow(pakiet([wariant()]), { departures: ["Katowice"], weekdays: [6] }), null,
    "pojedynczy termin nie może być rozproszony między terminami");
  assert.equal(rozproszenieZWariantow({ id: "h", type: "hotel", variants: dwa }, { departures: ["Katowice"], weekdays: [6] }), null,
    "hotel bez lotu nie ma terminów wylotu — nie wolno mu doklejać tej plakietki");
});

test("obie pomyłki plakietki są wychwytywane osobno", () => {
  const kryteria = { departures: ["Katowice"], weekdays: [6] };
  const rozproszony = [wariant({ departDate: "2026-09-06" }), wariant({ departureCity: "Warszawa" })];
  const zwarty = [wariant(), wariant({ departureCity: "Warszawa", departDate: "2026-09-06" })];

  const w = plakietkiRozproszenia([
    { ...pakiet(rozproszony), name: "BezPlakietki", filtrRozproszony: false },
    { ...pakiet(zwarty), name: "Nadmiarowa", filtrRozproszony: true },
    { ...pakiet(zwarty), name: "Zgodna", filtrRozproszony: false },
    { id: "x", name: "Pominieta", type: "hotel" },
  ], kryteria);

  assert.equal(w.sprawdzone, 3, "do porównania weszła oferta, której ta plakietka nie dotyczy");
  assert.equal(w.zgodne, 1);
  assert.deepEqual(w.brakujaca, ["BezPlakietki"],
    "brakująca plakietka nie została wykryta — to groźniejszy kierunek pomyłki");
  assert.deepEqual(w.nadmiarowa, ["Nadmiarowa"],
    "nadmiarowa plakietka nie została wykryta — panel straszy rozproszeniem, którego nie ma");
});
