// ============================================================
//  Reguły audytu
//
//  Audyt chodzi po ŻYWYCH źródłach i wyłapuje klasę błędów, której testy na
//  atrapach nie widzą. Sama reguła musi jednak być weryfikowalna — inaczej może
//  się cicho zepsuć i audyt przestanie zgłaszać to, po co go napisano.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { podejrzaneZero, PROG_CISZY_MS, ocenObietnice, filtrPrzecieka, filtrBezPotwierdzen, rozproszenieZWariantow, plakietkiRozproszenia, ocenFiltrWariantowy } from "../src/audyt-reguly.js";

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

// ============================================================
//  Filtry WARIANTOWE — wylot, transport, dzień tygodnia, okno terminu
//
//  Te cztery pytają o TERMINY oferty, nie o nią samą: przechodzi ta, której
//  KTÓRYKOLWIEK wariant spełnia kryterium. Reguła z sekcji OBIETNICE nie umie ich
//  sprawdzić, bo patrzy na pola reprezentanta — a reprezentant na karcie bywa innym
//  wariantem niż ten, który filtr przepuścił. Do 28.08.2026 nikt ich maszynowo nie
//  sprawdzał, choć 27.08 zmieniła się semantyka okna terminu.
// ============================================================

test("oferta bez ANI JEDNEGO pasującego wariantu to jawny przeciek", () => {
  const zKatowic = (v) => v.departureCity === "Katowice";

  const ocena = ocenFiltrWariantowy([
    pakiet([wariant({ departureCity: "Warszawa" }), wariant({ departureCity: "Kraków" })]),
    pakiet([wariant({ departureCity: "Warszawa" }), wariant({ departureCity: "Katowice" })]),
  ], zKatowic);

  assert.equal(ocena.razem, 2);
  assert.equal(ocena.lamie, 1, "oferta bez żadnego terminu z Katowic nie została uznana za przeciek");
  assert.equal(ocena.potwierdza, 1);
  assert.equal(filtrPrzecieka(ocena), true, "przeciek filtra wariantowego przeszedł niezauważony");
});

test("wystarczy JEDEN pasujący termin — reprezentant nie przesądza o ofercie", () => {
  // Odkąd jeden hotel niesie po kilkanaście wariantów, sprawdzanie pól reprezentanta
  // odpowiadałoby na inne pytanie niż zadane: applyFilters przepuszcza ofertę, gdy
  // pasuje KTÓRYKOLWIEK wariant, a promoteMatchingVariant pokazuje potem inny.
  const samolotem = (v) => v.transport === "Samolot";

  const ocena = ocenFiltrWariantowy([
    pakiet([wariant({ transport: "Autokar" }), wariant({ transport: "Samolot" })]),
  ], samolotem);

  assert.equal(ocena.lamie, 0, "oferta z pasującym terminem zgłoszona jako przeciek — audyt hałasowałby co przebieg");
  assert.equal(ocena.potwierdza, 1);
});

test("hotel-only jest POMIJANY, a nie liczony jako łamiący filtr pakietowy", () => {
  // Filtry pakietowe odsiewają hotel-only z definicji (applyFilters), a Hotelbeds
  // jest odpytywany po datach już u dostawcy. Liczenie go jako przecieku zamieniłoby
  // świadomą zasadę w co-przebiegowy fałszywy alarm.
  const ocena = ocenFiltrWariantowy([
    { id: "h", name: "Sam nocleg", type: "hotel" },
    pakiet([wariant()]),
  ], () => true);

  assert.equal(ocena.razem, 1, "hotel bez lotu wszedł do oceny filtra pakietowego");
  assert.equal(ocena.pominiete, 1);
  assert.equal(ocena.lamie, 0, "hotel-only policzony jako przeciek — audyt zgłaszałby świadomą zasadę jako błąd");
});

test("okno terminu: liczy się data WYLOTU wariantu, nie powrotu", () => {
  // Decyzja właściciela z 27.08.2026 (patrz ranking.js:variantWithinDates): okno
  // dotyczy wylotu. Do 27.08 w oknie musiał się zmieścić CAŁY wyjazd i trzy z 72
  // realistycznych zapytań zwracały pustkę wyłącznie przez tę semantykę.
  const OD = "2026-09-07", DO = "2026-09-27";
  const wOknie = (v) => !!v.departDate && v.departDate >= OD && v.departDate <= DO;

  // Wylot w oknie, powrót PO nim — po zmianie z 27.08 to trafienie, nie przeciek.
  const ocena = ocenFiltrWariantowy([
    pakiet([wariant({ departDate: "2026-09-25", returnDate: "2026-10-02" })]),
  ], wOknie);
  assert.equal(ocena.lamie, 0,
    "oferta z wylotem w oknie zgłoszona jako przeciek — to stara semantyka sprzed 27.08, cofnięta decyzją właściciela");

  // Wylot POZA oknem — przeciek niezależnie od tego, gdzie wypada powrót.
  const poza = ocenFiltrWariantowy([
    pakiet([wariant({ departDate: "2026-10-05", returnDate: "2026-09-20" })]),
  ], wOknie);
  assert.equal(poza.lamie, 1, "wylot poza oknem przepuszczony — filtr terminu nie filtruje");
});

test("wariant bez daty nie jest niewiadomą — ocena filtra wariantowego jest binarna", () => {
  // Inaczej niż przy atrybutach: brak daty wylotu ODSIEWA w applyFilters, więc tutaj
  // też musi liczyć się jako złamanie. Bez tego filtrBezPotwierdzen mógłby zapalić się
  // na ofercie, o której wiadomo dość, żeby ją odrzucić.
  const wSobote = (v) => !!v.departDate && new Date(v.departDate + "T00:00:00").getDay() === 6;

  const ocena = ocenFiltrWariantowy([pakiet([wariant({ departDate: null })])], wSobote);

  assert.equal(ocena.bezDanych, 0, "filtr wariantowy dorobił sobie stan bez danych, którego applyFilters nie ma");
  assert.equal(ocena.lamie, 1, "wariant bez daty wylotu przepuszczony jako niewiadoma");
  assert.equal(filtrBezPotwierdzen(ocena), false,
    "jedno znalezisko zamieniłoby się w dwa — przeciek zgłoszony TAKŻE jako same niewiadome");
});
