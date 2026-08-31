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
  trustScore, trustLabel, scoreOffer, sortOffers, normalizeName, applyFilters, promoteMatchingVariant, filtrRozproszony, powrotPoOknie, ofertaZFlagami, hasAttribute, isDividedRoom, attributeCoverage, unknownAttrs, znanyAtrybut, offerGroupTotal, isGroupTotalExact, podpowiedziRozluznienia,
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

// Część źródeł podaje ocenę, ale NIE podaje liczby opinii (Hotelbeds Content API
// ich nie ma, wakacje.pl daje samą ocenę). Taka oferta ma trust = 0 i dostawała
// podpis „Mało / stare opinie" — czyli twierdzenie o wolumenie, którego nie znamy.
// Konsultant powtarzał to klientowi jako fakt o hotelu.
test("brak ZNANEJ liczby opinii nie udaje informacji, że opinii jest mało", () => {
  const bezWolumenu = { rating: 9.0, reviews: 0, freshDays: null };
  const etykieta = trustLabel(trustScore(bezWolumenu), bezWolumenu);
  assert.equal(etykieta.cls, "unknown");
  assert.match(etykieta.txt, /brak danych/i,
    "podpis ma mówić o braku danych, a nie o tym, że opinii jest mało albo są stare");

  // Oferta z realnie małą liczbą świeżych opinii to CO INNEGO i ma zostać jak było.
  const maloOpinii = { rating: 9.8, reviews: 3, freshDays: 200 };
  assert.equal(trustLabel(trustScore(maloOpinii), maloOpinii).cls, "low",
    "trzy stare opinie to wiedza, nie niewiedza — tego podpisu nie wolno rozmyć");

  // Bez podanej oferty (stare wywołania) progi działają jak dotąd.
  assert.equal(trustLabel(0.2).cls, "low");
});

// ------------------------------------------------------------------
//  Oferta bez ZNANEJ oceny (Hotelbeds bez recenzji, feed bez pola „rating").
//
//  Trzy rzeczy szły źle naraz, wszystkie z jednego korzenia:
//  · szacunek oceny z kategorii liczył `6 + undefined * 0.6` = NaN,
//  · NaN w score sprawiał, że porównania zwracały false i oferta zostawała
//    tam, gdzie ją wrzucono — potrafiła wylądować na szczycie rankingu,
//  · po serializacji NaN → `null`, a `null < 9` to prawda, więc oferta
//    wypadała z KAŻDEGO progu oceny, choć nikt nie stwierdził, że jest słaba.
// ------------------------------------------------------------------
test("oferta bez znanej oceny nie psuje rankingu ani nie wygrywa go NaN-em", () => {
  const bezOceny = scoreOffer(offer({ id: "bez", rating: undefined, reviews: 0, freshDays: null, stars: undefined }), {});
  const dobra = scoreOffer(offer({ id: "dobra", rating: 9.2, reviews: 2000, freshDays: 3, stars: 5 }), {});
  const slaba = scoreOffer(offer({ id: "slaba", rating: 6.4, reviews: 2000, freshDays: 3, stars: 3 }), {});

  for (const o of [bezOceny, dobra, slaba]) {
    assert.ok(Number.isFinite(o.score), `score nie jest liczbą dla ${o.id}: ${o.score}`);
    assert.ok(Number.isFinite(o.valueScore), `valueScore nie jest liczbą dla ${o.id}`);
    assert.ok(Number.isFinite(o.adjRating), `adjRating nie jest liczbą dla ${o.id}`);
  }
  assert.equal(bezOceny.adjRating, 7.5, "brak oceny ma dawać punkt neutralny, nie zero i nie NaN");
  assert.equal(sortOffers([bezOceny, dobra, slaba], "score")[0].id, "dobra",
    "oferta bez oceny wygrała ranking — dokładnie to robi NaN w porównaniach");
});

test("nieznana ocena nie odsiewa oferty, znana i za niska — owszem", () => {
  const bezOceny = offer({ id: "bez", rating: undefined, reviews: 0 });
  const zaSlaba = offer({ id: "slaba", rating: 7.2 });
  const dobra = offer({ id: "dobra", rating: 9.1 });

  const wynik = applyFilters([bezOceny, zaSlaba, dobra], { minRate: 8 }).map((o) => o.id);
  assert.ok(wynik.includes("bez"),
    "oferta bez znanej oceny wypadła z progu — brak danych nie może być karany jak zła ocena");
  assert.ok(!wynik.includes("slaba"), "oferta o znanej, za niskiej ocenie ma dalej wypadać");
  assert.ok(wynik.includes("dobra"));

  // `null` (tak wygląda NaN po serializacji JSON) musi być traktowany tak samo.
  assert.equal(applyFilters([offer({ rating: null })], { minRate: 9 }).length, 1,
    "ocena null to brak danych, nie zero");
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

// Hotel, którego DWA warianty dzielą między siebie dwa filtry pakietowe: jeden ma
// właściwe miasto wylotu, ale zły transport; drugi — właściwy transport, ale złe
// miasto. Żaden pojedynczy termin nie spełnia obu naraz, mimo że oferta przechodzi
// applyFilters (matchesAnyVariant sprawdza każdy filtr osobno).
function hotelRozdzielony() {
  return offer({
    id: "rozdzielony",
    variants: [
      { departureCity: "Warszawa", transport: "Samolot" }, // pasuje do miasta, nie do transportu
      { departureCity: "Katowice", transport: "Autokar" },  // pasuje do transportu, nie do miasta
    ],
  });
}

test("filtrRozproszony: true, gdy dwa aktywne filtry pakietowe dzielą się między różne warianty", () => {
  const hotel = hotelRozdzielony();
  const crit = { departures: ["Warszawa"], transports: ["Autokar"] };
  assert.equal(filtrRozproszony(hotel, crit), true);
});

test("filtrRozproszony: false, gdy istnieje wariant spełniający wszystkie aktywne filtry naraz", () => {
  const hotel = hotelRozdzielony();
  hotel.variants.push({ departureCity: "Warszawa", transport: "Autokar" }); // łączy oba warunki
  const crit = { departures: ["Warszawa"], transports: ["Autokar"] };
  assert.equal(filtrRozproszony(hotel, crit), false);
});

test("filtrRozproszony: false, gdy aktywny jest tylko JEDEN filtr pakietowy", () => {
  const hotel = hotelRozdzielony();
  assert.equal(filtrRozproszony(hotel, { departures: ["Warszawa"] }), false);
  assert.equal(filtrRozproszony(hotel, { transports: ["Autokar"] }), false);
});

test("filtrRozproszony: false, gdy nie ma aktywnych filtrów pakietowych", () => {
  const hotel = hotelRozdzielony();
  assert.equal(filtrRozproszony(hotel, {}), false);
});

test("filtrRozproszony: false dla oferty hotel-only (bez lotu)", () => {
  const hotelOnly = offer({ id: "ho2", type: "hotel", variants: [
    { departureCity: "Warszawa", transport: "Samolot" },
    { departureCity: "Katowice", transport: "Autokar" },
  ] });
  const crit = { departures: ["Warszawa"], transports: ["Autokar"] };
  assert.equal(filtrRozproszony(hotelOnly, crit), false);
});

test("filtrRozproszony: false, gdy oferta ma mniej niż dwa warianty", () => {
  const jedenWariant = offer({ id: "jw2", variants: [{ departureCity: "Warszawa", transport: "Samolot" }] });
  const crit = { departures: ["Warszawa"], transports: ["Autokar"] };
  assert.equal(filtrRozproszony(jedenWariant, crit), false);
});

test("filtrRozproszony: trzy aktywne filtry, każdy wariant łączy tylko dwa z trzech naraz", () => {
  const hotel = offer({
    id: "trzy-filtry",
    variants: [
      // Warszawa + Autokar, ale wylot w sobotę (dzień 6) — nie pasuje do weekdays.
      { departureCity: "Warszawa", transport: "Autokar", departDate: "2026-09-05" },
      // Warszawa + wylot w niedzielę (dzień 0), ale Samolot — nie pasuje do transports.
      { departureCity: "Warszawa", transport: "Samolot", departDate: "2026-09-06" },
    ],
  });
  const crit = { departures: ["Warszawa"], transports: ["Autokar"], weekdays: [0] };
  assert.equal(filtrRozproszony(hotel, crit), true);
});

test("sortowanie po sumie za grupę odwraca kolejność, gdy tańsza „od” nie jest tańsza razem", () => {
  // Scenariusz z docs/struktura-oferty-pakietowej.md: operator B ma wyższą cenę za osobę
  // (promocja „druga osoba za symboliczną kwotę”), ale niższą sumę. Sortowanie po cenie/os.
  // stawia go na drugim miejscu, po sumie — na pierwszym. To jest cały powód istnienia
  // tego trybu: konsultant sprzedaje wyjazd parze, nie jednej osobie.
  // priceTotalPax: 2 — operatorzy podają „cenę za wyjazd" dla pary i tak też ją tu czytamy.
  const tanszaZaOsobe = scoreOffer(offer({ id: "operator-a", price: 5349, priceTotal: 10698, priceTotalPax: 2 }), {});
  const drozszaZaOsobeTanszaRazem = scoreOffer(offer({ id: "operator-b", price: 9101, priceTotal: 10521, priceTotalPax: 2 }), {});
  const list = [tanszaZaOsobe, drozszaZaOsobeTanszaRazem];

  assert.equal(sortOffers(list, "price")[0].id, "operator-a");
  assert.equal(sortOffers(list, "total", 2)[0].id, "operator-b");
  assert.equal(list[0].id, "operator-a", "sortowanie nie może modyfikować wejścia");
});

// ------------------------------------------------------------------
//  Suma od operatora dotyczy DWÓCH osób — dla większego składu jest nieprawdą.
//
//  Zmierzone 17.08.2026 na seedzie demo: przy rodzinie 2+3 wszystkie 12 ofert
//  pokazywały „Razem" za parę (np. 9 340 zł zamiast ~23 350 zł), bo kod ufał
//  polu priceTotal niezależnie od składu. Konsultant przekleja tę liczbę
//  klientowi — pomyłka tej klasy podważa całe narzędzie.
// ------------------------------------------------------------------
test("suma podana dla pary nie jest podawana jako suma za większą grupę", () => {
  const paraOferta = offer({ id: "para", price: 4670, priceTotal: 9340, priceTotalPax: 2 });

  assert.equal(offerGroupTotal(paraOferta, 2), 9340,
    "dla pary suma operatora jest dokładna i ma być użyta");
  assert.equal(offerGroupTotal(paraOferta, 5), 4670 * 5,
    "dla pięciu osób suma za parę musi ustąpić szacunkowi z ceny za osobę");
  assert.equal(isGroupTotalExact(paraOferta, 2), true);
  assert.equal(isGroupTotalExact(paraOferta, 5), false,
    "interfejs musi wiedzieć, że to szacunek, a nie liczba od operatora");
});

test("suma bez deklaracji, dla ilu osób, nie jest brana za pewnik", () => {
  // Źródło, które podaje samą liczbę bez kontekstu składu, jest niewiadomą —
  // liczymy wtedy z ceny za osobę zamiast zgadywać, co ta suma obejmuje.
  const bezDeklaracji = offer({ id: "nieznane", price: 3000, priceTotal: 6000 });
  assert.equal(offerGroupTotal(bezDeklaracji, 4), 12000);
  assert.equal(isGroupTotalExact(bezDeklaracji, 4), false);
  assert.equal(isGroupTotalExact(bezDeklaracji, 2), false,
    "brak deklaracji to brak wiedzy także dla pary");
});

test("suma policzona dla całej grupy (multiroom) jest używana wprost", () => {
  // Hotelbeds w trybie wspólnego wyjazdu sumuje realne stawki wszystkich pokoi,
  // więc jego priceTotal dotyczy całego składu i nie wolno go zastępować szacunkiem.
  const grupowa = offer({ id: "multiroom", price: 2000, priceTotal: 10000, priceTotalPax: 5 });
  assert.equal(offerGroupTotal(grupowa, 5), 10000);
  assert.equal(isGroupTotalExact(grupowa, 5), true);
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

// ------------------------------------------------------------------
//  Podpowiedzi przy zerze wyników.
//
//  „Nic nie pasuje do tych kryteriów" jest prawdziwe i bezużyteczne: konsultant
//  siedzi przy kliencie i nie wie, czy zawadza budżet, ocena, czy dzień wylotu.
//  Lista ofert jest już pobrana, więc policzenie „ile byłoby BEZ tego filtra"
//  nie kosztuje ani jednego zapytania do dostawcy.
// ------------------------------------------------------------------
test("podpowiedź wskazuje filtr, który realnie wyciął wyniki", () => {
  const lista = [
    offer({ id: "a", price: 2000, rating: 8.0, stars: 4 }),
    offer({ id: "b", price: 2500, rating: 8.2, stars: 4 }),
    offer({ id: "c", price: 2800, rating: 9.6, stars: 5 }),
  ];
  // Każdy z tych dwóch filtrów Z OSOBNA przepuszcza coś, ale RAZEM dają zero:
  // budżet 2600 zł odcina ofertę „c", a ocena 9,5 odcina „a" i „b".
  const crit = { budget: 2600, budgetMode: "person", minRate: 9.5 };
  assert.equal(applyFilters(lista, crit).length, 0, "scenariusz założycielski: zero wyników");

  const p = podpowiedziRozluznienia(lista, crit);
  assert.equal(p.length, 2, "spodziewano się podpowiedzi dla budżetu i dla oceny");
  assert.equal(p[0].klucz, "minRate", "najpierw ten filtr, który odblokowuje najwięcej ofert");
  assert.equal(p[0].ofert, 2, "bez progu oceny mieszczą się dwie oferty w budżecie");

  const budzet = p.find((x) => x.klucz === "budget");
  assert.equal(budzet.ofert, 1, "bez budżetu zostaje jedna oferta z oceną ≥ 9,5");
  assert.match(budzet.wartosc, /2600 zł \/os\./, "podpowiedź ma przypomnieć, jaka wartość filtra przeszkadza");
});

test("podpowiedź nie proponuje zdjęcia filtra, który sam z siebie nic nie odblokuje", () => {
  // Budżet 900 zł nie przepuszcza NICZEGO, więc zdjęcie samej oceny dalej daje zero —
  // podpowiadanie tego wysyłałoby konsultanta w ślepy zaułek przy kliencie.
  const lista = [offer({ price: 2000, rating: 8.0 }), offer({ price: 2500, rating: 9.6 })];
  const p = podpowiedziRozluznienia(lista, { budget: 900, budgetMode: "person", minRate: 9.5 });
  assert.deepEqual(p.map((x) => x.klucz), ["budget"],
    "jedyna sensowna podpowiedź to budżet — zdjęcie oceny zostawia zero ofert");
});

test("podpowiedź nie proponuje zdejmowania kierunku ani filtrów, które nic nie dają", () => {
  const lista = [offer({ country: "Grecja", price: 5000 }), offer({ country: "Egipt", price: 5200 })];
  // Kierunek Turcja + budżet 1000: zdjęcie budżetu NIC nie da, bo kraj i tak nie pasuje.
  const crit = { countries: ["Turcja"], budget: 1000, budgetMode: "person" };
  const p = podpowiedziRozluznienia(lista, crit);

  assert.ok(!p.some((x) => x.klucz === "countries"),
    "kierunek to pytanie klienta, nie filtr do zdjęcia — nie proponujemy „poszukaj gdziekolwiek”");
  assert.equal(p.length, 0,
    "zdjęcie budżetu nie odblokowuje żadnej oferty, więc nie ma czego podpowiadać");
});

// Zmierzone 17.08.2026 na żywym panelu: podpowiedź obiecywała „bez oceny 4 oferty",
// a po kliknięciu „Zdejmij" wychodziła 1. Powód: liczyła filtr wyłączony do ZERA,
// a suwak oceny nie schodzi poniżej swojego minimum (6) — czyli obiecywała stan,
// którego interfejs nie potrafi osiągnąć. Liczba niezgodna z tym, co widać po
// kliknięciu, jest gorsza niż jej brak.
test("podpowiedź liczy stan, który panel realnie ustawi po kliknięciu", () => {
  const lista = [
    offer({ id: "bezOceny", rating: 0, reviews: 0, price: 2000 }),
    offer({ id: "slaba", rating: 5.2, price: 2100 }),
    offer({ id: "dobra", rating: 8.4, price: 2200 }),
  ];
  const crit = { minRate: 9.5 };

  // Bez granic: „wyłączony filtr" przepuszcza nawet oferty bez oceny.
  assert.equal(podpowiedziRozluznienia(lista, crit)[0].ofert, 3);

  // Z granicą suwaka (6) — tyle ofert konsultant realnie zobaczy po kliknięciu.
  const zGranica = podpowiedziRozluznienia(lista, crit, { minRate: 6 });
  assert.equal(zGranica[0].ofert, 1,
    "podpowiedź nie uwzględnia minimum suwaka — obiecuje oferty, których po kliknięciu nie będzie");

  // Granica równa obecnej wartości = nie ma czego zdejmować.
  assert.deepEqual(podpowiedziRozluznienia(lista, { minRate: 6 }, { minRate: 6 }), [],
    "filtr ustawiony już na swoim minimum nie jest podpowiedzią");
});

test("podpowiedzi liczą się tylko wtedy, gdy filtr jest realnie włączony", () => {
  const lista = [offer({ price: 3000, rating: 8.0 })];
  const bezFiltrow = podpowiedziRozluznienia(lista, { minRate: 0, budget: 0, boards: [], tags: [] });
  assert.deepEqual(bezFiltrow, [], "wyłączone filtry nie mogą się pojawiać jako podpowiedzi");
  assert.deepEqual(podpowiedziRozluznienia([], { budget: 100 }), [], "pusta lista nie ma czego podpowiadać");
});

test("budżet „razem” nie ufa cudzej sumie z innego składu — liczy dla realnej grupy", () => {
  // Seed demo podaje priceTotal dla DWÓCH osób (packages.js: priceTotalPax = 2).
  // Filtr brał tę kwotę jak sumę dla dowolnego składu, więc rodzina 2+3 dostawała
  // oferty realnie dwa razy droższe, niż zadeklarowała w budżecie.
  // cap: 6 celowo wysoki — o wyniku ma decydować filtr BUDŻETU, nie pojemności.
  const list = [offer({ price: 4000, priceTotal: 8000, priceTotalPax: 2, cap: 6 })];

  const rodzina = applyFilters(list, { budget: 15000, budgetMode: "total", pax: 5 });
  assert.equal(rodzina.length, 0, "realny koszt dla 5 osób (4000 zł/os. razy 5 = 20 000 zł) przekracza 15 000 zł");

  const para = applyFilters(list, { budget: 15000, budgetMode: "total", pax: 2 });
  assert.equal(para.length, 1, "dla pary priceTotal dotyczy TEGO składu (8000 zł) i mieści się w budżecie");
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
  // priceTotalPax MUSI zgadzać się z pax z kryteriów, inaczej to nie jest suma dla
  // TEJ grupy — filtr liczy wtedy z ceny za osobę (patrz offerGroupTotal i test niżej).
  const list = [offer({ price: 4000, priceTotal: 8000, priceTotalPax: 2 })];
  assert.equal(applyFilters(list, { budget: 3000, budgetMode: "person" }).length, 0);
  assert.equal(applyFilters(list, { budget: 4000, budgetMode: "person" }).length, 1);
  assert.equal(applyFilters(list, { budget: 7000, budgetMode: "total", pax: 2 }).length, 0);
  assert.equal(applyFilters(list, { budget: 8000, budgetMode: "total", pax: 2 }).length, 1);
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

  // Nieznana długość pobytu NIE odsiewa oferty — ta sama zasada co przy ocenie,
  // gwiazdkach i atrybutach. Wcześniej dostawcy podstawiali zmyślone 7 nocy, więc
  // oferta o nieznanej długości cicho odpadała przy każdym filtrze poza 6–8 nocy,
  // a konsultant nawet nie wiedział, że coś zniknęło.
  const bezDlugosci = [offer({ nights: undefined })];
  assert.equal(applyFilters(bezDlugosci, { nights: 10 }).length, 1,
    "oferta o nieznanej długości pobytu została cicho odrzucona");
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

// ============================================================
//  Termin — do 24.08 pole „Termin" nie odcinało ani jednej oferty pakietowej
//  (applyFilters w ogóle nie czytało crit.from/crit.to). Te testy pilnują,
//  żeby filtr istniał, ale NIE odpalał się sam z siebie.
// ============================================================

const wyjazd = (od, doo, over = {}) => offer({ departDate: od, returnDate: doo, ...over });

test("termin poza oknem klienta odpada, termin w oknie zostaje", () => {
  const lista = [
    wyjazd("2026-09-22", "2026-09-29", { id: "w-oknie" }),
    wyjazd("2026-12-21", "2026-12-28", { id: "grudzien" }),
  ];
  const znalezione = applyFilters(lista, { from: "2026-09-20", to: "2026-09-30" }).map((h) => h.id);
  assert.deepEqual(znalezione, ["w-oknie"],
    "termin przestał odcinać oferty spoza okna — wraca filtr-widmo sprzed 24.08");
});

test("bez podanego terminu filtr w ogóle nie działa", () => {
  // Kluczowe zabezpieczenie: pola dat startują wypełnione (+30/+37 dni), więc
  // filtr odpalający się bez decyzji konsultanta odciąłby prawie cały katalog.
  // Zmierzone na demo: domyślne okno przy „Dokładnym terminie" = 7 ofert z 453.
  const lista = [wyjazd("2026-09-22", "2026-09-29"), wyjazd("2026-12-21", "2026-12-28")];
  assert.equal(applyFilters(lista, {}).length, 2, "brak dat zaczął cokolwiek filtrować");
  assert.equal(applyFilters(lista, { from: "", to: "" }).length, 2,
    "puste pola dat zaczęły filtrować — nietknięty termin wraca tylnymi drzwiami");
});

test("okno terminu dotyczy WYLOTU, a długość pobytu przycina osobne kryterium", () => {
  // ZMIANA SEMANTYKI 27.08.2026, decyzja właściciela na pomiarze. Wcześniej w oknie
  // musiał zmieścić się cały wyjazd — brzmiało ostrożniej, ale przy „Dokładnym
  // terminie" okno ma dokładnie długość wyjazdu, więc wylot musiał trafić co do dnia
  // w jego pierwszy dzień. Zmierzone na katalogu PL (453 warianty, 72 zapytania):
  // 3 zapytania zwracały ZERO ofert wyłącznie przez tę semantykę, a przy wylocie
  // +16 dni przechodziło 13 ofert zamiast 207.
  const dwutygodniowy = wyjazd("2026-09-28", "2026-10-12", { id: "dwutygodniowy", nights: 14 });
  const okno = { from: "2026-09-22", to: "2026-09-29" };

  assert.equal(applyFilters([dwutygodniowy], okno).length, 1,
    "wylot w oknie odpadł przez datę powrotu — wróciła semantyka sprzed 27.08");

  // I ZABEZPIECZENIE TEJ DECYZJI: skoro okno przestało ograniczać czas trwania,
  // robi to kryterium „długość pobytu". Bez tego zmiana byłaby zwykłym poluzowaniem.
  assert.equal(applyFilters([dwutygodniowy], { ...okno, nights: 7 }).length, 0,
    "dwutygodniowy wyjazd przeszedł przy wybranych 7 nocach — nic już nie pilnuje długości");

  // Wylot PO końcu okna dalej odpada — inaczej filtr przestałby cokolwiek znaczyć.
  const poOknie = [wyjazd("2026-09-30", "2026-10-07", { id: "po-oknie" })];
  assert.equal(applyFilters(poOknie, okno).length, 0,
    "wylot poza oknem klienta przeszedł filtr terminu");
});

test("nieznana data powrotu nie odsiewa oferty, nieznany wylot tak", () => {
  // Ta sama zasada co przy ocenie i gwiazdkach: odrzucamy tylko to, o czym WIEMY,
  // że nie spełnia kryterium. Brak daty powrotu to niewiadoma...
  const bezPowrotu = [wyjazd("2026-09-22", undefined, { id: "bez-powrotu" })];
  assert.equal(applyFilters(bezPowrotu, { from: "2026-09-20", to: "2026-09-30" }).length, 1,
    "oferta bez daty powrotu wypadła na terminie, choć wylot pasuje");
  // ...ale brak daty WYLOTU znaczy, że nie da się jej przypisać do żadnego terminu
  // (tak samo działa filtr dnia tygodnia).
  const bezWylotu = [wyjazd(undefined, undefined, { id: "bez-wylotu" })];
  assert.equal(applyFilters(bezWylotu, { from: "2026-09-20", to: "2026-09-30" }).length, 0,
    "pakiet bez daty wylotu udaje, że pasuje do wybranego terminu");
});

test("hotel bez lotu nie wypada przez wybrany termin", () => {
  // Hotelbeds jest odpytywany po datach już na poziomie API, a matchesAnyVariant
  // zwraca dla ofert hotel-only twarde false. Bez wyjątku na typ oferty ustawienie
  // terminu wycięłoby całe żywe źródło — ta sama klasa błędu co twardy filtr profilu.
  const hotelOnly = [offer({ id: "hb", type: "hotel", departDate: undefined, departureCity: undefined })];
  assert.equal(applyFilters(hotelOnly, { from: "2026-09-20", to: "2026-09-30" }).length, 1,
    "oferta hotel-only wypadła na filtrze terminu — Hotelbeds znika z wyników");
});

test("termin szuka po WSZYSTKICH terminach hotelu, nie po reprezentancie", () => {
  // Ten sam problem co przy lotnisku (56 hoteli z Katowic, filtr przepuszczał 19):
  // reprezentant wybrany przez dedupeOffers bywa innym wariantem niż ten pasujący.
  const hotelZWieloma = offer({
    id: "wiele", departDate: "2026-12-21", returnDate: "2026-12-28",
    variants: [
      { departDate: "2026-12-21", returnDate: "2026-12-28", price: 4000, departureCity: "Katowice" },
      { departDate: "2026-09-22", returnDate: "2026-09-29", price: 3200, departureCity: "Katowice" },
    ],
  });
  assert.equal(applyFilters([hotelZWieloma], { from: "2026-09-20", to: "2026-09-30" }).length, 1,
    "hotel z pasującym terminem wypadł, bo reprezentant miał inną datę");
});

test("karta pokazuje termin, o który konsultant pytał", () => {
  // promoteMatchingVariant musi znać ten sam warunek co applyFilters — inaczej
  // oferta zostaje na liście, ale karta opisuje ją grudniowym wylotem.
  const hotelZWieloma = offer({
    id: "wiele", departDate: "2026-12-21", returnDate: "2026-12-28", price: 4000,
    variants: [
      { departDate: "2026-12-21", returnDate: "2026-12-28", price: 4000, departureCity: "Katowice" },
      { departDate: "2026-09-22", returnDate: "2026-09-29", price: 3200, departureCity: "Katowice" },
    ],
  });
  const pokazany = promoteMatchingVariant(hotelZWieloma, { from: "2026-09-20", to: "2026-09-30" });
  assert.equal(pokazany.departDate, "2026-09-22",
    "karta dalej pokazuje termin spoza okna, o które pytał konsultant");
  assert.equal(pokazany.price, 3200, "cena została z wariantu, który nie pasuje do terminu");
});

// ============================================================
//  Nieznany klucz atrybutu
//
//  hasAttribute() zwraca dla nieznanego klucza `undefined`, a brak danych
//  ŚWIADOMIE nie odsiewa ofert — to filar anty-przekoloryzacji. Skutek uboczny:
//  literówka w nazwie atrybutu daje filtr, który przepuszcza cały katalog, a mimo
//  to liczy się w panelu jako aktywny. Nie wolno tego naprawić przez „nieznany
//  klucz = false", bo wtedy literówka wycinałaby wszystko po cichu. Naprawa polega
//  na tym, że serwer NAZYWA nieznany klucz i mówi o nim wprost.
// ============================================================

test("system wie, których kluczy atrybutów nie rozumie", () => {
  assert.equal(znanyAtrybut("plaza"), true, "atrybut z listy odległości przestał być rozpoznawany");
  assert.equal(znanyAtrybut("wifi"), true, "udogodnienie przestało być rozpoznawane");
  assert.equal(znanyAtrybut("pokoje-polaczone"), true, "układ pokoju przestał być rozpoznawany");
  // Dokładnie ta literówka siedziała w scripts/audyt.js i produkowała fałszywe
  // znalezisko „filtr zwraca same niewiadome" przy każdym przebiegu.
  assert.equal(znanyAtrybut("plaza-blisko"), false, "nieistniejący klucz uchodzi za znany");
  assert.equal(znanyAtrybut(""), false, "pusty klucz uchodzi za znany");
});

test("nieznany atrybut nie odsiewa ani jednej oferty — dlatego serwer musi go zgłosić", () => {
  const lista = [offer({ id: "a", beach: 100 }), offer({ id: "b", beach: 4000 })];

  // Znany klucz działa: hotel 4 km od plaży wypada.
  assert.equal(applyFilters(lista, { attrs: ["plaza"] }).length, 1,
    "znany atrybut przestał filtrować");

  // Nieznany klucz przepuszcza WSZYSTKO — łącznie z ofertą, która jawnie nie
  // spełnia kryterium, o które konsultantowi chodziło.
  assert.equal(applyFilters(lista, { attrs: ["plaza-blisko"] }).length, 2,
    "zmieniła się semantyka nieznanego klucza — sprawdź, czy nie zaczął cicho wycinać ofert");
  assert.equal(hasAttribute(lista[1], "plaza-blisko"), undefined,
    "nieznany klucz przestał być brakiem danych — grozi cichym odsiewaniem");
});

// ============================================================
//  „Powrót poza wpisanym oknem"
//
//  Od 27.08.2026 okno terminu dotyczy WYLOTU. Zmierzone w nocy 30/31.08 na katalogu
//  PL: przy oknie 7-dniowym 14 z 14 ofert ma powrot po dacie „do", przy 14-dniowym
//  23 z 45, przy 30-dniowym ZERO. Konsultant wpisuje termin klienta i widzi pasujacy
//  wylot — to, ze klient wroci po koncu urlopu, wychodzi dopiero przy liczeniu dat.
// ============================================================

test("powrót po górnej granicy okna jest oznaczany, a mieszczący się nie", () => {
  const crit = { from: "2026-09-10", to: "2026-09-17" };
  const pakiet = (returnDate) => ({ type: "package", departDate: "2026-09-15", returnDate });

  assert.equal(powrotPoOknie(pakiet("2026-09-22"), crit), true,
    "powrót 5 dni po końcu okna nie został oznaczony — konsultant nie ma jak tego zauważyć");
  assert.equal(powrotPoOknie(pakiet("2026-09-17"), crit), false,
    "powrót DOKŁADNIE w ostatnim dniu okna oznaczony jako wykraczający — plakietka kłamałaby");
  assert.equal(powrotPoOknie(pakiet("2026-09-14"), crit), false);
});

test("bez górnej granicy okna nie ma o czym ostrzegać", () => {
  // Klient nie podał „do" — nie ma czego przekroczyć. Ostrzeżenie bez kryterium
  // byłoby czystym hałasem na każdej karcie.
  const p = { type: "package", departDate: "2026-09-15", returnDate: "2026-12-31" };
  assert.equal(powrotPoOknie(p, { from: "2026-09-10" }), false);
  assert.equal(powrotPoOknie(p, {}), false);
  assert.equal(powrotPoOknie(p, null), false);
});

test("brak daty powrotu i hotel bez lotu nie są ostrzeżeniem", () => {
  // O czym nie wiemy, o tym nie straszymy — ta sama zasada co przy atrybutach.
  // Hotel-only nie ma lotu powrotnego, a dostawca odpytuje go po datach u siebie.
  const crit = { to: "2026-09-17" };
  assert.equal(powrotPoOknie({ type: "package", departDate: "2026-09-15" }, crit), false,
    "oferta bez znanej daty powrotu dostała ostrzeżenie — to zgadywanie, nie fakt");
  assert.equal(powrotPoOknie({ type: "hotel", terminDo: "2026-09-30" }, crit), false,
    "hotel bez lotu dostał plakietkę o powrocie, którego nie ma");
});

test("flagi zapytania NIGDY nie dopisuja sie do oferty z cache", () => {
  // promoteMatchingVariant oddaje ORYGINAL, gdy nie ma czego promowac (hotel bez lotu,
  // jeden wariant, brak aktywnych filtrow wariantowych). Ten oryginal przychodzi
  // z cache dostawcy i zyje miedzy wyszukiwaniami — dopisanie do niego flagi znaczy,
  // ze nastepny konsultant z INNYM terminem zobaczy plakietke policzona dla cudzych
  // kryteriow. Ta klasa bledu juz w tym projekcie wystapila.
  const zCache = { type: "package", id: "x", departDate: "2026-09-15", returnDate: "2026-09-22" };
  const crit = { to: "2026-09-17" };

  // Przypadek, w ktorym promocja zwraca ten SAM obiekt (brak variants).
  const promowana = promoteMatchingVariant(zCache, crit);
  assert.equal(promowana, zCache, "zalozenie testu nieaktualne — promocja skopiowala oferte");

  const wynik = ofertaZFlagami(zCache, promowana, crit);
  assert.equal(wynik.powrotPoOknie, true, "flaga w ogole nie powstala");
  assert.notEqual(wynik, zCache, "flaga dopisana do obiektu z cache zamiast do kopii");
  assert.equal("powrotPoOknie" in zCache, false,
    "oferta z cache zostala ZATRUTA flaga — nastepne wyszukiwanie pokaze ja z cudzymi kryteriami");
  assert.equal("filtrRozproszony" in zCache, false, "oferta z cache zatruta flaga rozproszenia");
});

test("bez zadnej flagi oferta idzie dalej bez zbednego kopiowania", () => {
  // Gdy nie ma czego oznaczyc, nie ma powodu mnozyc obiektow — a jednoczesnie
  // to potwierdza, ze funkcja nie dopisuje pol "na wszelki wypadek".
  const o = { type: "package", departDate: "2026-09-15", returnDate: "2026-09-16" };
  const wynik = ofertaZFlagami(o, o, { to: "2026-09-17" });
  assert.equal(wynik, o);
  assert.deepEqual(Object.keys(o), ["type", "departDate", "returnDate"]);
});
