// ============================================================
//  Ranking, wiarygodność opinii i filtry
//
//  To jest serce produktu: obietnica „nie koloryzujemy" musi być
//  weryfikowalna, a nie deklaratywna. Te testy pilnują, żeby przypadkowa
//  zmiana wag nie zamieniła Kompasa w kolejną wyszukiwarkę promującą
//  hotele z oceną 9,8 wystawioną przez trzy osoby.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import {
  trustScore, trustLabel, scoreOffer, sortOffers, normalizeName, applyFilters, promoteMatchingVariant, hasAttribute, isDividedRoom, attributeCoverage, unknownAttrs,
} from "../src/ranking.js";
import { mapBoard } from "../src/providers/hotelbeds.js";

// Oferta wzorcowa — testy zmieniają tylko to, co badają.
function offer(over = {}) {
  return {
    id: "x", name: "Hotel Testowy", country: "Egipt", region: "Hurghada",
    price: 3500, priceTotal: 7000, rating: 8.5, reviews: 500, freshDays: 5,
    stars: 4, board: "All Inclusive", tags: [], cap: 4, nights: 7,
    type: "package", departureCity: "Katowice", transport: "Samolot",
    ...over,
  };
}

test("wiarygodność rośnie z liczbą opinii", () => {
  const malo = trustScore(offer({ reviews: 3 }));
  const duzo = trustScore(offer({ reviews: 4000 }));
  assert.ok(duzo > malo, `4000 opinii (${duzo}) powinno bić 3 opinie (${malo})`);
});

test("wiarygodność spada wraz ze starością opinii", () => {
  const swieze = trustScore(offer({ freshDays: 2 }));
  const stare = trustScore(offer({ freshDays: 400 }));
  assert.ok(swieze > stare);
});

test("opinie starsze niż 30 dni nie dokładają już nic za świeżość", () => {
  assert.equal(trustScore(offer({ freshDays: 31 })), trustScore(offer({ freshDays: 900 })));
});

test("brak opinii daje niską wiarygodność", () => {
  assert.ok(trustScore(offer({ reviews: 0, freshDays: null })) < 0.45);
});

test("etykieta wiarygodności zgadza się z progami", () => {
  assert.equal(trustLabel(0.8).cls, "high");
  assert.equal(trustLabel(0.5).cls, "mid");
  assert.equal(trustLabel(0.2).cls, "low");
});

test("ANTY-PRZEKOLORYZACJA: hotel 9,8 z trzech opinii przegrywa z 8,7 z tysięcy", () => {
  const podejrzany = scoreOffer(offer({ rating: 9.8, reviews: 3, freshDays: 200 }), {});
  const solidny = scoreOffer(offer({ rating: 8.7, reviews: 4000, freshDays: 4 }), {});
  assert.ok(
    solidny.score > podejrzany.score,
    `solidny ${solidny.score.toFixed(3)} musi bić podejrzany ${podejrzany.score.toFixed(3)}`
  );
});

test("ocena skorygowana ściąga niepewne oceny w stronę średniej", () => {
  const niepewny = scoreOffer(offer({ rating: 9.8, reviews: 1, freshDays: 300 }), {});
  const pewny = scoreOffer(offer({ rating: 9.8, reviews: 5000, freshDays: 2 }), {});
  // Przy znikomej próbce ocena 9,8 nie może być brana za dobrą monetę.
  assert.ok(niepewny.adjRating < 9.8);
  assert.ok(niepewny.adjRating < pewny.adjRating);
  // Przy dużej i świeżej próbce zostaje blisko deklarowanej.
  assert.ok(pewny.adjRating > 9.0);
});

test("przy równej jakości tańsza oferta ma wyższy score", () => {
  const tania = scoreOffer(offer({ price: 3000 }), {});
  const droga = scoreOffer(offer({ price: 8000 }), {});
  assert.ok(tania.score > droga.score);
});

test("valueScore mieści się w 0-100", () => {
  for (const o of [offer({ price: 500, rating: 10 }), offer({ price: 40000, rating: 1 })]) {
    const s = scoreOffer(o, {}).valueScore;
    assert.ok(s >= 0 && s <= 100, `valueScore poza zakresem: ${s}`);
  }
});

test("dopasowanie do profilu wyjazdu podnosi score", () => {
  const crit = { tags: ["rodzinny"] };
  const trafiony = scoreOffer(offer({ tags: ["rodzinny"] }), crit);
  const nietrafiony = scoreOffer(offer({ tags: ["spa"] }), crit);
  assert.ok(trafiony.score > nietrafiony.score);
});

test("sortowanie działa w każdym trybie", () => {
  const list = [
    scoreOffer(offer({ id: "a", price: 5000, rating: 9.1, reviews: 20 }), {}),
    scoreOffer(offer({ id: "b", price: 2000, rating: 7.9, reviews: 3000 }), {}),
  ];
  assert.equal(sortOffers(list, "price")[0].id, "b");
  assert.equal(sortOffers(list, "rating")[0].id, "a");
  assert.equal(sortOffers(list, "trust")[0].id, "b");
  assert.equal(sortOffers(list, "value")[0].id, "b");
  // Sortowanie nie może modyfikować wejścia — lista jest współdzielona z innymi widokami.
  assert.equal(list[0].id, "a");
});

test("filtr wylotu patrzy na WSZYSTKIE warianty obiektu, nie tylko na reprezentanta", () => {
  // Regresja z 16.08.2026. Odkąd jeden hotel ma po kilka wariantów z różnych lotnisk,
  // dedupeOffers wybiera jeden z nich na reprezentanta — a filtr sprawdzał wyłącznie
  // h.departureCity tego reprezentanta. Zmierzone na seedzie demo: 56 hoteli miało lot
  // z Katowic, filtr przepuszczał 19. Konsultant zaznaczał lotnisko klienta i tracił
  // dwie trzecie realnie dostępnych ofert, nie mając jak się o tym dowiedzieć.
  const hotel = offer({
    id: "wielolotniskowy",
    departureCity: "Warszawa", // reprezentant NIE pasuje do filtru
    variants: [
      { departureCity: "Warszawa", transport: "Samolot", departDate: "2026-09-07" },
      { departureCity: "Katowice", transport: "Samolot", departDate: "2026-09-09" },
    ],
  });

  assert.equal(applyFilters([hotel], { departures: ["Katowice"] }).length, 1,
    "hotel z wariantem z Katowic wypadł, bo reprezentant leci z Warszawy");
  assert.equal(applyFilters([hotel], { departure: "Katowice" }).length, 1,
    "wariant pojedynczego miasta wylotu (crit.departure) też musi czytać warianty");
  assert.equal(applyFilters([hotel], { departures: ["Gdańsk"] }).length, 0,
    "lotnisko, którego nie ma w ŻADNYM wariancie, nadal ma odsiewać ofertę");

  // Dzień tygodnia wylotu — ten sam mechanizm: 2026-09-07 to poniedziałek,
  // 2026-09-09 środa. Reprezentant leci w poniedziałek, więc filtr na środę
  // musi trafić w drugi wariant, a nie odrzucić cały obiekt.
  assert.equal(applyFilters([hotel], { weekdays: [3] }).length, 1,
    "filtr dnia tygodnia nie widzi wariantów — hotel wylatujący w środę wypadł");
  assert.equal(applyFilters([hotel], { weekdays: [6] }).length, 0,
    "dzień, w którym nie lata ŻADEN wariant, nadal ma odsiewać");

  // Oferta hotel-only (bez lotu) nie pasuje do filtrów pakietowych — bez zmian.
  const samNocleg = offer({ id: "hotel-only", type: "hotel", departureCity: undefined, variants: [] });
  assert.equal(applyFilters([samNocleg], { departures: ["Katowice"] }).length, 0,
    "oferta bez lotu nie może przechodzić filtru miasta wylotu");
});

// Hotel z trzema wariantami: reprezentant (Warszawa) NIE pasuje do filtru „Wylot z:
// Katowice", ale dwa inne warianty pasują — droższy w sumie i tańszy w sumie.
// Współdzielony przez testy promoteMatchingVariant, żeby nie powielać danych.
function hotelZWariantami() {
  return offer({
    id: "wielolotniskowy",
    name: "Rixos Premium Belek",
    country: "Turcja",
    stars: 5,
    rating: 9.1,
    beach: 80,
    photos: ["https://przyklad.pl/zdjecie.jpg"],
    departureCity: "Warszawa",
    departureCode: "WAW",
    arrivalCode: "AYT",
    price: 4000,
    priceTotal: 8000,
    operator: "TUI",
    carrier: "LOT",
    flightNo: "LO123",
    board: "HB",
    nights: 7,
    days: 8,
    seatsLeft: 5,
    departDate: "2026-09-07",
    returnDate: "2026-09-14",
    variants: [
      {
        departureCity: "Warszawa", departureCode: "WAW", arrivalCode: "AYT", transport: "Samolot",
        price: 4000, priceTotal: 8000, operator: "TUI", carrier: "LOT", flightNo: "LO123",
        board: "HB", nights: 7, days: 8, seatsLeft: 5, departDate: "2026-09-07", returnDate: "2026-09-14",
      },
      {
        // droższa w sumie mimo pozornie zbliżonej ceny/os. — sortowanie musi patrzeć na priceTotal
        departureCity: "Katowice", departureCode: "KTW", arrivalCode: "AYT", transport: "Samolot",
        price: 3800, priceTotal: 9000, operator: "Coral Travel", carrier: "Ryanair", flightNo: "FR789",
        board: "AI", nights: 7, days: 8, seatsLeft: 1, departDate: "2026-09-10", returnDate: "2026-09-17",
      },
      {
        // najtańsza w sumie spośród pasujących do Katowic — TA ma zostać reprezentantem
        departureCity: "Katowice", departureCode: "KTW", arrivalCode: "AYT", transport: "Samolot",
        price: 3500, priceTotal: 7000, operator: "Itaka", carrier: "Enter Air", flightNo: "ENT456",
        board: "AI", nights: 7, days: 8, seatsLeft: 2, departDate: "2026-09-09", returnDate: "2026-09-16",
      },
    ],
  });
}

test("promoteMatchingVariant: bez aktywnego filtru pakietowego nic się nie zmienia", () => {
  const hotel = hotelZWariantami();
  const out = promoteMatchingVariant(hotel, {});
  assert.equal(out, hotel, "brak filtrów pakietowych = ta sama oferta (nawet ta sama referencja)");
  assert.equal(out.departureCity, "Warszawa");
});

test("promoteMatchingVariant: przy aktywnym filtrze wybiera NAJTAŃSZY pasujący wariant po sumie za grupę", () => {
  const hotel = hotelZWariantami();
  const out = promoteMatchingVariant(hotel, { departures: ["Katowice"], pax: 2 });

  // Wariant za 9000 pasuje też do Katowic, ale wariant za 7000 jest tańszy w sumie — ten ma wygrać.
  assert.equal(out.departureCity, "Katowice");
  assert.equal(out.priceTotal, 7000);
  assert.equal(out.price, 3500);
  assert.equal(out.operator, "Itaka");
  assert.equal(out.carrier, "Enter Air");
  assert.equal(out.flightNo, "ENT456");
  assert.equal(out.board, "AI");
  assert.equal(out.seatsLeft, 2);
  assert.equal(out.departDate, "2026-09-09");
  assert.equal(out.returnDate, "2026-09-16");
  assert.equal(out.departureCode, "KTW");
});

test("promoteMatchingVariant: nie rusza danych HOTELU, tylko pola wariantu", () => {
  const hotel = hotelZWariantami();
  const out = promoteMatchingVariant(hotel, { departures: ["Katowice"], pax: 2 });
  assert.equal(out.name, "Rixos Premium Belek");
  assert.equal(out.country, "Turcja");
  assert.equal(out.stars, 5);
  assert.equal(out.rating, 9.1);
  assert.equal(out.beach, 80);
  assert.deepEqual(out.photos, ["https://przyklad.pl/zdjecie.jpg"]);
});

test("promoteMatchingVariant: h.variants zostaje kompletną listą (wszystkie terminy)", () => {
  const hotel = hotelZWariantami();
  const out = promoteMatchingVariant(hotel, { departures: ["Katowice"], pax: 2 });
  assert.equal(out.variants.length, 3, "konsultant ma dalej widzieć wszystkie warianty w zakładce");
  assert.deepEqual(out.variants, hotel.variants);
});

test("promoteMatchingVariant: oferty bez wariantów (np. Hotelbeds) przechodzą bez zmian", () => {
  const bezWariantow = offer({ id: "hb", source: "Hotelbeds", departureCity: "Warszawa" });
  delete bezWariantow.variants;
  const out1 = promoteMatchingVariant(bezWariantow, { departures: ["Katowice"], pax: 2 });
  assert.equal(out1, bezWariantow, "brak pola variants = oferta wraca nietknięta");

  const jedenWariant = offer({
    id: "jw", departureCity: "Warszawa",
    variants: [{ departureCity: "Warszawa", transport: "Samolot" }],
  });
  const out2 = promoteMatchingVariant(jedenWariant, { departures: ["Katowice"], pax: 2 });
  assert.equal(out2, jedenWariant, "jeden wariant = nie ma z czego wybierać, oferta wraca nietknięta");
});

test("promoteMatchingVariant: oferta typu hotel (bez lotu) przechodzi bez zmian", () => {
  const hotelOnly = offer({ id: "ho", type: "hotel", departureCity: "", variants: [] });
  const out = promoteMatchingVariant(hotelOnly, { departures: ["Katowice"], pax: 2 });
  assert.equal(out, hotelOnly);
});

test("sortowanie po sumie za grupę odwraca kolejność, gdy tańsza „od” nie jest tańsza razem", () => {
  // Scenariusz z docs/struktura-oferty-pakietowej.md: operator B ma wyższą cenę za osobę
  // (promocja „druga osoba za symboliczną kwotę”), ale niższą sumę. Sortowanie po cenie/os.
  // stawia go na drugim miejscu, po sumie — na pierwszym. To jest cały powód istnienia
  // tego trybu: konsultant sprzedaje wyjazd parze, nie jednej osobie.
  const tanszaZaOsobe = scoreOffer(offer({ id: "operator-a", price: 5349, priceTotal: 10698 }), {});
  const drozszaZaOsobeTanszaRazem = scoreOffer(offer({ id: "operator-b", price: 9101, priceTotal: 10521 }), {});
  const list = [tanszaZaOsobe, drozszaZaOsobeTanszaRazem];

  assert.equal(sortOffers(list, "price")[0].id, "operator-a");
  assert.equal(sortOffers(list, "total")[0].id, "operator-b");
  assert.equal(list[0].id, "operator-a", "sortowanie nie może modyfikować wejścia");
});

test("sortowanie po sumie liczy fallback cena/os. × pax, gdy dostawca nie poda priceTotal", () => {
  // packages.js (dane demo) nie ustawia priceTotal — bez fallbacku tryb „total”
  // sortowałby po samych zerach i nie różniłby się niczym od kolejności wejściowej.
  const drozsza = scoreOffer(offer({ id: "drozsza", price: 2000, priceTotal: 0 }), {});
  const tansza = scoreOffer(offer({ id: "tansza", price: 1200, priceTotal: 0 }), {});
  assert.equal(sortOffers([drozsza, tansza], "total", 3)[0].id, "tansza");
  // Bez podanego pax mnożnik schodzi do 1 — kolejność ma zostać ta sama, nie wywalić się.
  assert.equal(sortOffers([drozsza, tansza], "total")[0].id, "tansza");
});

test("normalizacja nazw radzi sobie z polskimi znakami i spacjami", () => {
  assert.equal(normalizeName("Dżerba"), "dzerba");
  assert.equal(normalizeName("  Blue   Lagoon "), "blue lagoon");
  assert.equal(normalizeName("ŁÓDŹ"), "lodz");
  assert.equal(normalizeName(null), "");
});

test("wyszukiwanie po nazwie ignoruje pozostałe filtry", () => {
  const list = [offer({ name: "Blue Lagoon", price: 99000, rating: 2 })];
  // Cena grubo ponad budżet i fatalna ocena — a hotel i tak ma się pokazać.
  const out = applyFilters(list, { name: "lagoon", budget: 3000, minRate: 9 });
  assert.equal(out.length, 1);
});

test("budżet jest twardym limitem w obu trybach", () => {
  const list = [offer({ price: 4000, priceTotal: 8000 })];
  assert.equal(applyFilters(list, { budget: 3000, budgetMode: "person" }).length, 0);
  assert.equal(applyFilters(list, { budget: 4000, budgetMode: "person" }).length, 1);
  assert.equal(applyFilters(list, { budget: 7000, budgetMode: "total" }).length, 0);
  assert.equal(applyFilters(list, { budget: 8000, budgetMode: "total" }).length, 1);
});

test("filtr tylko-z-realnymi-opiniami odrzuca oferty bez wolumenu", () => {
  const list = [offer({ id: "z", reviews: 0 }), offer({ id: "r", reviews: 120 })];
  const out = applyFilters(list, { onlyReviewed: true });
  assert.deepEqual(out.map((o) => o.id), ["r"]);
});

test("filtr długości pobytu ma tolerancję jednej nocy", () => {
  const list = [offer({ nights: 8 })];
  assert.equal(applyFilters(list, { nights: 7 }).length, 1, "8 nocy przy szukaniu 7 to ten sam wyjazd");
  assert.equal(applyFilters(list, { nights: 10 }).length, 0);
});

test("profil wyjazdu działa jak OR, nie AND", () => {
  const list = [offer({ tags: ["rodzinny"] })];
  assert.equal(applyFilters(list, { tags: ["rodzinny", "spa"] }).length, 1);
  assert.equal(applyFilters(list, { tags: ["narty"] }).length, 0);
});

test("filtr wylotu odrzuca oferty hotel-only", () => {
  const pakiet = offer({ id: "p", type: "package", departureCity: "Katowice" });
  const hotelOnly = offer({ id: "h", type: "hotel", departureCity: "" });
  const out = applyFilters([pakiet, hotelOnly], { departures: ["Katowice"] });
  assert.deepEqual(out.map((o) => o.id), ["p"]);
});

test("filtr geograficzny sumuje całe kraje i pojedyncze regiony", () => {
  const eg = offer({ id: "eg", country: "Egipt", region: "Hurghada" });
  const gr = offer({ id: "gr", country: "Grecja", region: "Kreta, Heraklion" });
  const tr = offer({ id: "tr", country: "Turcja", region: "Alanya" });
  const out = applyFilters([eg, gr, tr], { countries: ["Egipt"], regions: ["Kreta"] });
  assert.deepEqual(out.map((o) => o.id).sort(), ["eg", "gr"]);
});

test("oferta bez miejsc dla całego składu odpada", () => {
  const list = [offer({ cap: 3 })];
  assert.equal(applyFilters(list, { pax: 4 }).length, 0);
  assert.equal(applyFilters(list, { pax: 3 }).length, 1);
});

test("ANTY-PRZEKOLORYZACJA: atrybut lokalizacji bez danych nie jest cicho odsiewany", () => {
  const znany = offer({ id: "znany", beach: 100 }); // wiadomo: blisko plaży
  const nieznany = offer({ id: "nieznany" }); // brak danych o dystansie do plaży
  const daleko = offer({ id: "daleko", beach: 900 }); // wiadomo: NIE przy plaży
  const out = applyFilters([znany, nieznany, daleko], { attrs: ["plaza"] });
  assert.deepEqual(out.map((o) => o.id).sort(), ["nieznany", "znany"]);
});

test("ANTY-PRZEKOLORYZACJA: atrybut obiektu/aktywności bez danych nie jest cicho odsiewany", () => {
  const ma = offer({ id: "ma", amenities: ["basen", "silownia"] });
  const jawnyBrak = offer({ id: "jawnyBrak", amenities: ["basen"] }); // wiadomo: bez siłowni
  const nieznany = offer({ id: "nieznany" }); // brak danych o amenities w ogóle
  const out = applyFilters([ma, jawnyBrak, nieznany], { attrs: ["silownia"] });
  assert.deepEqual(out.map((o) => o.id).sort(), ["ma", "nieznany"]);
});

test("hasAttribute zwraca undefined, gdy nie ma podstawy do oceny", () => {
  assert.equal(hasAttribute(offer(), "plaza"), undefined);
  assert.equal(hasAttribute(offer({ beach: 50 }), "plaza"), true);
  assert.equal(hasAttribute(offer({ beach: 5000 }), "plaza"), false);
  assert.equal(hasAttribute(offer(), "basen"), undefined);
  assert.equal(hasAttribute(offer({ amenities: ["basen"] }), "basen"), true);
  assert.equal(hasAttribute(offer({ amenities: ["spa"] }), "basen"), false);
});

// Regresja: seed demo wyprowadza amenities z tagów, więc KAŻDA oferta miała tablicę —
// a skoro tablica istnieje, stara reguła czytała brak klucza jako "sprawdziliśmy, nie ma".
// Dla "niepelnosprawni" dawało to jawne `false` dla 91/91 ofert demo, czyli zaprzeczenie
// zamiast niewiedzy. Provider deklaruje teraz, o czym w ogóle ma wiedzę.
test("filtr wyżywienia nie wycina ofert, dla których wyżywienie jest nieznane", () => {
  // Od 11.08 Hotelbeds zwraca `board: undefined` dla kodów, których nie umiemy
  // jednoznacznie zmapować (zamiast wcześniejszego zmyślonego „BB"). Gdyby filtr
  // je odsiewał, konsultant zaznaczający „Śniadania" traciłby 34,7% realnych
  // stawek — dokładnie ten sam błąd, co filtr profilu naprawiony 05.08.
  const potwierdzone = offer({ id: "bb", board: "BB" });
  const inne = offer({ id: "ai", board: "All Inclusive" });
  const nieznane = offer({ id: "niewiadoma", board: undefined });

  const out = applyFilters([potwierdzone, inne, nieznane], { boards: ["BB"] });
  assert.deepEqual(out.map((o) => o.id).sort(), ["bb", "niewiadoma"],
    "oferta z jawnie innym wyżywieniem wypada, oferta bez danych zostaje");
});

test("filtr wyżywienia działa dla etykiety „Bez wyżywienia” — najliczniejszej kategorii w realnych danych", () => {
  // Po 3d5cc3f `mapBoard` zwraca „Bez wyżywienia” dla RO/SC/DR. W pomiarze z 11.08 to
  // 64 ze 120 realnych ofert — czyli kategoria częstsza niż wszystkie pozostałe razem.
  // Test celowo bierze etykietę z mapBoard(), a nie z przepisanego na sztywno stringa:
  // gdyby kiedyś zmieniło się brzmienie po stronie providera, chip w panelu przestałby
  // cokolwiek filtrować (porównanie w applyFilters jest dosłowne), a test ma to złapać.
  const etykieta = mapBoard("RO");
  assert.equal(etykieta, "Bez wyżywienia", "mapBoard('RO') zmienił etykietę — chip w panelu przestanie pasować");

  const ro = offer({ id: "ro", board: etykieta });
  const ai = offer({ id: "ai", board: "All Inclusive" });
  const nieznane = offer({ id: "niewiadoma", board: undefined });

  const zaznaczony = applyFilters([ro, ai, nieznane], { boards: [etykieta] });
  assert.deepEqual(zaznaczony.map((o) => o.id).sort(), ["niewiadoma", "ro"],
    "przy zaznaczonym chipie zostaje oferta bez wyżywienia i ta o nieznanym; All Inclusive wypada");

  const bezFiltra = applyFilters([ro, ai, nieznane], {});
  assert.equal(bezFiltra.length, 3, "bez zaznaczonego chipa filtr wyżywienia nie może niczego odsiewać");
});

test("próg gwiazdek nie wycina hoteli o nieznanej kategorii", () => {
  // `mapStars` zwraca undefined dla kategorii bez cyfry (SUP, BOU, ALBER...).
  // Stary zapis `(h.stars || 0) < minStars` schodził na zero i kasował je przy
  // każdym progu — hotel bez podanej kategorii nie jest hotelem jednogwiazdkowym.
  const piec = offer({ id: "piec", stars: 5 });
  const dwie = offer({ id: "dwie", stars: 2 });
  const bezKategorii = offer({ id: "bezKat", stars: undefined });

  const out = applyFilters([piec, dwie, bezKategorii], { minStars: 4 });
  assert.deepEqual(out.map((o) => o.id).sort(), ["bezKat", "piec"]);
});

test("provider może zadeklarować, o których udogodnieniach ma wiedzę — reszta to brak danych, nie zaprzeczenie", () => {
  const zasieg = ["basen", "spa"];
  const o = offer({ amenities: ["basen"], amenityCoverage: zasieg });

  assert.equal(hasAttribute(o, "basen"), true, "udogodnienie w zasięgu i obecne");
  assert.equal(hasAttribute(o, "spa"), false, "udogodnienie w zasięgu, ale nieobecne — to realne 'nie ma'");
  assert.equal(
    hasAttribute(o, "niepelnosprawni"), undefined,
    "cecha spoza zadeklarowanego zasięgu musi być brakiem danych, nie zaprzeczeniem"
  );

  // Bez deklaracji nic się nie zmienia — Hotelbeds mapuje tę ósemkę z opisu facility,
  // więc dla niego pusta pozycja NADAL znaczy "sprawdzone, nie ma".
  const bezDeklaracji = offer({ amenities: ["basen"] });
  assert.equal(hasAttribute(bezDeklaracji, "niepelnosprawni"), false, "provider bez deklaracji zachowuje stare zachowanie");
});


test("wielokrotne atrybuty działają jak AND, a nieznane dane nie psują wyniku", () => {
  const pelny = offer({ id: "pelny", beach: 50, amenities: ["basen", "wifi"] });
  const czesciowy = offer({ id: "czesciowy", beach: 50, amenities: ["basen"] }); // brak wifi
  const bezWiedzy = offer({ id: "bezWiedzy", beach: 50 }); // amenities nieznane
  const out = applyFilters([pelny, czesciowy, bezWiedzy], { attrs: ["plaza", "basen", "wifi"] });
  assert.deepEqual(out.map((o) => o.id).sort(), ["bezWiedzy", "pelny"]);
});

test("filtr dni tygodnia wylotu odrzuca pakiety w złe dni i oferty bez znanej daty", () => {
  const poniedzialek = offer({ id: "pon", type: "package", departDate: "2026-08-03" }); // pon
  const piatek = offer({ id: "pt", type: "package", departDate: "2026-08-07" }); // pt
  const hotelOnly = offer({ id: "hotel", type: "hotel", departDate: undefined });
  const bezDaty = offer({ id: "bezDaty", type: "package", departDate: undefined });
  const out = applyFilters([poniedzialek, piatek, hotelOnly, bezDaty], { weekdays: [1] });
  assert.deepEqual(out.map((o) => o.id), ["pon"]);
});

test("filtr dni tygodnia wylotu: brak wyboru nic nie odrzuca", () => {
  const list = [offer({ type: "hotel", departDate: undefined })];
  assert.equal(applyFilters(list, { weekdays: [] }).length, 1);
});

// ------------------------------------------------------------------
//  UKŁAD POKOJU — „jeden pokój, dwa pomieszczenia".
//  Realna potrzeba przy stole: rodzice chcą spać w tym samym pokoju
//  co dzieci, ale z przegrodą. To CO INNEGO niż dwa pokoje połączone
//  drzwiami (inny klucz, inna łazienka, inna cena), więc filtry są dwa.
// ------------------------------------------------------------------

test("osobna sypialnia rozpoznawana po nazwie pokoju, po polsku i po angielsku", () => {
  assert.equal(isDividedRoom("Pokój rodzinny (2 sypialnie)"), true);
  assert.equal(isDividedRoom("FAMILY ROOM"), true);
  assert.equal(isDividedRoom("TWO BEDROOM APARTMENT"), true);
  assert.equal(isDividedRoom("Apartament z 2 sypialniami"), true);
  assert.equal(isDividedRoom("DUPLEX SUPERIOR"), true);
  assert.equal(isDividedRoom("DOUBLE ROOM"), false);
  assert.equal(isDividedRoom("Pokój dwuosobowy"), false);
});

test("Junior Suite NIE jest pokojem z osobną sypialnią, zwykły Suite jest", () => {
  // Junior Suite to najczęściej jeden pokój z wnęką. Uznanie go za osobną
  // sypialnię kończy się awanturą na miejscu — klient zapłacił za przegrodę,
  // której nie ma.
  assert.equal(isDividedRoom("JUNIOR SUITE SEA VIEW"), false);
  assert.equal(isDividedRoom("SUITE SEA VIEW"), true);
});

test("ANTY-PRZEKOLORYZACJA: oferta bez nazwy pokoju nie jest odsiewana", () => {
  assert.equal(isDividedRoom(undefined), undefined);
  assert.equal(isDividedRoom(""), undefined);
  assert.equal(hasAttribute(offer(), "pokoj-dzielony"), undefined);

  const rodzinny = offer({ id: "rodzinny", roomType: "Pokój rodzinny (2 sypialnie)" });
  const dwuosobowy = offer({ id: "dwuosobowy", roomType: "Pokój dwuosobowy" });
  const bezDanych = offer({ id: "bezDanych" }); // dostawca nie podał typu pokoju
  const out = applyFilters([rodzinny, dwuosobowy, bezDanych], { attrs: ["pokoj-dzielony"] });
  assert.deepEqual(out.map((o) => o.id).sort(), ["bezDanych", "rodzinny"],
    "brak nazwy pokoju to brak wiedzy — nie wolno tego czytać jako „nie ma sypialni”");
});

test("pokoje połączone to osobny filtr, nie synonim osobnej sypialni", () => {
  const polaczone = offer({ id: "polaczone", roomType: "CONNECTING ROOMS" });
  const rodzinny = offer({ id: "rodzinny", roomType: "FAMILY ROOM" });

  const filtrPolaczone = applyFilters([polaczone, rodzinny], { attrs: ["pokoje-polaczone"] });
  assert.deepEqual(filtrPolaczone.map((o) => o.id), ["polaczone"],
    "pokój rodzinny to jeden klucz — nie może wpaść pod „pokoje połączone”");

  const filtrSypialnia = applyFilters([polaczone, rodzinny], { attrs: ["pokoj-dzielony"] });
  assert.deepEqual(filtrSypialnia.map((o) => o.id), ["rodzinny"]);
});

// ============================================================
//  Dopasowanie do klienta — ten sam hotel nie może być wart tyle samo
//  dla pary i dla rodziny 2+3. Bez tego plakietka ETA była stała.
// ============================================================

test("ten sam hotel dostaje różne ETA dla różnych profili klienta", () => {
  const rodzinny = offer({ tags: ["rodzina", "plaza"], cap: 5 });
  const dlaRodziny = scoreOffer(rodzinny, { tags: ["rodzina"], adults: 2, kids: 3 });
  const dlaPary = scoreOffer(rodzinny, { tags: ["para"], adults: 2, kids: 0 });

  assert.notEqual(dlaRodziny.valueScore, dlaPary.valueScore,
    "hotel rodzinny na pięć osób musi mieć inną wartość dla rodziny 2+3 niż dla pary");
  assert.ok(dlaRodziny.valueScore > dlaPary.valueScore,
    `rodzina ${dlaRodziny.valueScore} powinna bić parę ${dlaPary.valueScore}`);
});

test("ANTY-PRZEKOLORYZACJA: oferta bez tagów nie jest karana", () => {
  const bezTagow = scoreOffer(offer({ id: "bezTagow", tags: [] }), { tags: ["rodzina"], adults: 2, kids: 2 });
  const nietrafiony = scoreOffer(offer({ id: "nietrafiony", tags: ["impreza"] }), { tags: ["rodzina"], adults: 2, kids: 2 });

  const trafiony = scoreOffer(offer({ id: "trafiony", tags: ["rodzina"] }), { tags: ["rodzina"], adults: 2, kids: 2 });

  assert.ok(bezTagow.valueScore > nietrafiony.valueScore,
    `hotel bez opisu (${bezTagow.valueScore}) nie może przegrywać z opisanym jako imprezowy (${nietrafiony.valueScore}) — brak danych to nie zaprzeczenie profilu`);
  assert.ok(trafiony.valueScore > bezTagow.valueScore,
    "potwierdzone dopasowanie ma nadal bić brak danych — inaczej tagi nie znaczyłyby nic");

  // Ten sam skład osobowy, jedyna różnica to podany profil — dla oferty bez tagów
  // nie może to zmienić niczego, bo nie ma czego porównywać.
  const bezProfiluKlienta = scoreOffer(offer({ tags: [] }), { adults: 2, kids: 2 });
  assert.equal(bezTagow.valueScore, bezProfiluKlienta.valueScore,
    "oferta bez tagów wychodzi tak samo, niezależnie od tego, czy klient podał profil");
});

test("pokój dokładnie na skład bije wielki zapas miejsc", () => {
  const krit = { adults: 2, kids: 0 };
  const naMiare = scoreOffer(offer({ cap: 2 }), krit);
  const zZapasem = scoreOffer(offer({ cap: 6 }), krit);

  assert.ok(naMiare.valueScore > zZapasem.valueScore,
    `pokój dla dwóch (${naMiare.valueScore}) powinien bić apartament dla sześciu (${zZapasem.valueScore}) przy parze`);
});

test("brak kryteriów klienta zostawia skalę ETA nietkniętą", () => {
  const bezKryteriow = scoreOffer(offer(), {});
  const stary = (() => {
    const o = offer(), t = trustScore(o);
    const adj = o.rating * t + 7.5 * (1 - t);
    const ratingPart = Math.max(0, Math.min(1, (adj - 6) / 4));
    const pricePart = Math.max(0, Math.min(1, 1 - (o.price - 2000) / 12000));
    const vfm = Math.max(0, Math.min(1, ratingPart * 0.6 + pricePart * 0.4));
    return Math.round((0.4 * vfm + 0.25 * ratingPart + 0.15 * pricePart + 0.1 * (o.stars / 5) + 0.1 * t) * 100);
  })();

  assert.equal(bezKryteriow.valueScore, stary,
    "gdy nie ma czego dopasowywać, liczba musi zostać ta sama co przed dodaniem członu — inaczej progi werdyktów się przesuwają");
});

test("dopasowanie do klienta wpływa też na kolejność, nie tylko na plakietkę", () => {
  const krit = { tags: ["rodzina"], adults: 2, kids: 2 };
  const dopasowany = scoreOffer(offer({ id: "dopasowany", tags: ["rodzina"], cap: 4 }), krit);
  const niedopasowany = scoreOffer(offer({ id: "niedopasowany", tags: ["impreza"], cap: 4 }), krit);

  const kolejnosc = sortOffers([niedopasowany, dopasowany], "trafnosc").map((o) => o.id);
  assert.deepEqual(kolejnosc, ["dopasowany", "niedopasowany"]);
});

test("ANTY-PRZEKOLORYZACJA: profil wyjazdu nie odsiewa ofert o nieznanym profilu", () => {
  // Hotelbeds nie przysyła tagów profilu, a to ponad połowa realnych wyników.
  // Twardy filtr wycinał całe żywe źródło i zostawiał konsultanta z danymi demo.
  const potwierdzony = offer({ id: "potwierdzony", tags: ["rodzina"] });
  const nieznany = offer({ id: "nieznany", tags: [] }); // dostawca nie opisał profilu
  const inny = offer({ id: "inny", tags: ["impreza"] }); // wiadomo: NIE rodzinny

  const out = applyFilters([potwierdzony, nieznany, inny], { tags: ["rodzina"] });
  assert.deepEqual(out.map((o) => o.id).sort(), ["nieznany", "potwierdzony"],
    "brak tagów to brak wiedzy — nie wolno tego czytać jako „to nie jest hotel rodzinny”");
});

test("oferta o nieznanym profilu jest w wynikach, ale niżej niż potwierdzona", () => {
  const krit = { tags: ["rodzina"], adults: 2, kids: 2 };
  const potwierdzony = scoreOffer(offer({ tags: ["rodzina"], cap: 4 }), krit);
  const nieznany = scoreOffer(offer({ tags: [], cap: 4 }), krit);

  assert.ok(potwierdzony.valueScore > nieznany.valueScore,
    "wpuszczenie do wyników nie może oznaczać udawania, że profil się zgadza — od tego jest ranking");
});

// ============================================================
//  Pokrycie atrybutów — ile wyników naprawdę potwierdza filtr
//
//  Zasada „brak danych nie odsiewa oferty" jest słuszna, ale sama liczba
//  wyników nie odróżnia „93 potwierdzone + 30 niewiadomych" od „0 + 30".
//  Te testy pilnują, żeby serwer podawał rozbicie, a nie samą sumę.
// ============================================================

test("bez wybranych atrybutów nie ma czego raportować", () => {
  assert.deepEqual(attributeCoverage([offer()], {}), []);
  assert.deepEqual(attributeCoverage([offer()], { attrs: [] }), []);
});

test("rozbicie oddziela potwierdzone od przepuszczonych z braku danych", () => {
  const potwierdzony = offer({ id: "p", roomType: "Family Room (2 bedrooms)" });
  const nieznany = offer({ id: "n" }); // dostawca nie podał typu pokoju
  const drugiNieznany = offer({ id: "n2" });

  const [stat] = attributeCoverage([potwierdzony, nieznany, drugiNieznany], { attrs: ["pokoj-dzielony"] });
  assert.equal(stat.key, "pokoj-dzielony");
  assert.equal(stat.confirmed, 1);
  assert.equal(stat.unknown, 2);
});

test("filtr bez ani jednego potwierdzenia jest rozpoznawalny", () => {
  // Dokładnie przypadek zmierzony 01.08: „Pokoje połączone" dawało 30 ofert,
  // wszystkie bez informacji o typie pokoju. Konsultant musi móc to zobaczyć.
  const bezDanych = [offer({ id: "a" }), offer({ id: "b" })];
  const [stat] = attributeCoverage(bezDanych, { attrs: ["pokoje-polaczone"] });
  assert.equal(stat.confirmed, 0);
  assert.ok(stat.unknown > 0, "same niewiadome muszą być policzone, nie zgubione");
});

test("każdy wybrany atrybut dostaje własne rozbicie", () => {
  const lista = [offer({ beach: 100, roomType: "Family Room (2 bedrooms)" }), offer({})];
  const stats = attributeCoverage(lista, { attrs: ["plaza", "pokoj-dzielony"] });
  assert.deepEqual(stats.map((s) => s.key), ["plaza", "pokoj-dzielony"]);
  assert.ok(stats.every((s) => s.confirmed === 1 && s.unknown === 1));
});

// ============================================================
//  unknownAttrs — to samo pytanie, ale PER OFERTA (nie zbiorczo dla listy).
//  Karta oferty potrzebuje wiedzieć, czy TA KONKRETNA oferta potwierdza
//  wybraną cechę, czy tylko przeszła filtr z braku danych.
// ============================================================

test("oferta z potwierdzoną cechą nie dostaje znacznika braku danych", () => {
  const potwierdzony = offer({ roomType: "Family Room (2 bedrooms)" });
  assert.deepEqual(unknownAttrs(potwierdzony, ["pokoj-dzielony"]), []);
});

test("oferta bez danych o cesze dostaje znacznik z jej kluczem", () => {
  const nieznany = offer({}); // brak roomType = nie wiadomo
  assert.deepEqual(unknownAttrs(nieznany, ["pokoj-dzielony"]), ["pokoj-dzielony"]);
});

test("znacznik dotyczy tylko atrybutów bez danych, nie wszystkich wybranych", () => {
  const mieszana = offer({ beach: 100 }); // plaża potwierdzona, pokój — brak danych
  assert.deepEqual(unknownAttrs(mieszana, ["plaza", "pokoj-dzielony"]), ["pokoj-dzielony"]);
});

test("bez wybranych atrybutów nie ma czego oznaczać na karcie", () => {
  assert.deepEqual(unknownAttrs(offer({}), []), []);
  assert.deepEqual(unknownAttrs(offer({}), undefined), []);
});

test("jawne „nie posiada” to nie jest brak danych — nie dostaje znacznika", () => {
  // hasAttribute zwraca false (nie undefined) dla dystansu poza progiem —
  // to wiedza, nie niewiadoma, więc unknownAttrs nie powinno tego oznaczać
  // (a filtr i tak wyciąłby taką ofertę wcześniej w applyFilters).
  const dalekoOdPlazy = offer({ beach: 2000 });
  assert.deepEqual(unknownAttrs(dalekoOdPlazy, ["plaza"]), []);
});
