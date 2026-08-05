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
  trustScore, trustLabel, scoreOffer, sortOffers, normalizeName, applyFilters, hasAttribute, isDividedRoom,
} from "../src/ranking.js";

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
