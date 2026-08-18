// ============================================================
//  Ranking ofert + wskaźnik wiarygodności opinii
//  Ta sama logika działa niezależnie od dostawcy danych,
//  bo pracuje na znormalizowanym kształcie oferty (patrz normalize.js).
// ============================================================

// Wiarygodność opinii (0..1): łączy liczbę opinii i ich świeżość.
// Chroni przed "przekoloryzowaniem" — wysoka ocena z małej / starej próbki jest mniej warta.
export function trustScore(offer) {
  const reviews = offer.reviews || 0;
  const freshDays = offer.freshDays == null ? 60 : offer.freshDays;
  const volume = Math.min(1, Math.log10(reviews + 1) / Math.log10(3000)); // 0..1
  const fresh = Math.max(0, 1 - freshDays / 30); // >30 dni -> 0
  return 0.6 * volume + 0.4 * fresh;
}

// Etykieta wiarygodności opinii. Drugi argument (oferta) jest opcjonalny, ale bez
// niego etykieta potrafi skłamać: część źródeł podaje ocenę, NIE podając liczby
// opinii (Hotelbeds Content API ich nie ma, wakacje.pl daje samą ocenę). Taka
// oferta ma trust = 0 i dostawała podpis „Mało / stare opinie" — czyli twierdzenie
// o wolumenie, którego nie znamy. Konsultant powtarzał to klientowi jako fakt
// („ten hotel ma mało opinii"), choć prawdą jest tylko tyle, że ich nie policzyliśmy.
export function trustLabel(t, offer) {
  if (offer && !(offer.reviews > 0)) return { cls: "unknown", txt: "Brak danych o opiniach" };
  if (t >= 0.7) return { cls: "high", txt: "Opinie wiarygodne" };
  if (t >= 0.45) return { cls: "mid", txt: "Opinie umiarkowane" };
  return { cls: "low", txt: "Mało / stare opinie" };
}

// Dopasowanie oferty do KONKRETNEGO klienta (0..1): profil wyjazdu + skład osobowy.
// Ten sam hotel ma inną wartość dla pary i dla rodziny 2+3 — bez tego członu
// plakietka ETA pokazywała obu tę samą liczbę.
//
// ANTY-PRZEKOLORYZACJA: czego nie wiemy, tego nie oceniamy. Brak podanego profilu
// albo brak pojemności w danych daje 0.5 (neutralnie), nigdy zera — inaczej oferty
// z uboższym opisem byłyby karane za to, że dostawca nie przysłał tagów.
// Wynik 0.5 jest punktem neutralnym: w ETA działa jako modyfikator w obie strony
// (patrz scoreOffer), więc brak wiedzy nie przesuwa liczby ani w górę, ani w dół.
export function clientFit(offer, crit) {
  const tags = (crit && crit.tags) || [];
  const offerTags = offer.tags || [];
  let tagFit = 0.5;
  // Oceniamy dopasowanie tylko wtedy, gdy klient podał profil I oferta ma tagi.
  // Pusta lista tagów u dostawcy to brak wiedzy, nie zaprzeczenie profilu — hotel
  // rodzinny bez opisu nie może przegrywać z hotelem opisanym jako imprezowy.
  if (tags.length && offerTags.length) {
    tagFit = tags.filter((x) => offerTags.includes(x)).length / tags.length;
  }

  const pax = Number((crit && crit.adults) || 0) + Number((crit && crit.kids) || 0);
  const cap = offer.cap || 0;
  let capFit = 0.5;
  if (pax > 0 && cap > 0) {
    // Pokój dokładnie na skład jest lepszy niż wielki zapas: apartament dla sześciu
    // osób sprzedany parze to zwykle przepłacona przestrzeń, nie luksus.
    capFit = cap < pax ? 0.3 : Math.max(0.4, 1 - (cap - pax) * 0.2);
  }

  // Oba składniki po połowie, każdy z neutralnym 0.5 przy braku danych. Rozważane
  // było pomijanie nieznanego składnika zamiast domieszywania 0.5 — odrzucone, bo
  // wtedy hotel bez opisu dostawałby tyle samo co potwierdzenie dopasowany, czyli
  // brak wiedzy udawałby wiedzę. Dostawcy bez tagów to nie krzywdzi: filtr profilu
  // (patrz applyFilters) i tak nie wpuszcza takich ofert do wyników z profilem.
  return 0.5 * tagFit + 0.5 * capFit;
}

// Ile punktów ETA (ze 100) waży dopasowanie do klienta. Modyfikator liczony od
// środka: idealne dopasowanie dokłada +20, kompletnie chybione zabiera -20,
// a brak danych (0.5) nie robi nic. Dzięki temu progi werdyktów ("Najlepszy
// value" od 82) zostają tam, gdzie były — zmienia się kolejność, nie skala.
export const FIT_WEIGHT = 20;

// Ranking trafności: ocena skorygowana o wiarygodność + cena + dopasowanie do klienta + standard.
export function scoreOffer(offer, crit) {
  const t = trustScore(offer);
  // Ocena "skorygowana": niepewne oceny ściągane w stronę średniej (7.5) -> anty-przekoloryzacja.
  // Oferta BEZ znanej oceny (część źródeł podaje sam obiekt, bez recenzji) dostaje
  // wprost średnią — punkt neutralny. Wcześniej wchodziło tu `undefined`, co dawało
  // NaN w score, a NaN w porównaniach zawsze zwraca false: taka oferta zostawała
  // tam, gdzie ją wrzucono, i potrafiła wylądować na szczycie rankingu.
  const znanaOcena = typeof offer.rating === "number" && !Number.isNaN(offer.rating) && offer.rating > 0;
  const adjRating = znanaOcena ? offer.rating * t + 7.5 * (1 - t) : 7.5;
  const ratingPart = Math.max(0, Math.min(1, (adjRating - 6) / 4));

  let pricePart = 1 - (offer.price - 2500) / 9000;
  pricePart = Math.max(0, Math.min(1, pricePart));

  const fit = clientFit(offer, crit);

  const starPart = (offer.stars || 3) / 5;
  const score =
    0.34 * ratingPart + 0.22 * pricePart + 0.2 * fit + 0.1 * starPart + 0.14 * t;

  // valueScore (0-100) = "jakość za pieniądze dla TEGO klienta". Ten sam wzór co
  // kliencki etaValue, żeby liczby na karcie i sortowanie się nie rozjeżdżały.
  // Nie zmyśla nic ponad dane, które już mamy (cena, ocena ważona wiarygodnością,
  // standard, dopasowanie do kryteriów).
  const pricePartV = Math.max(0, Math.min(1, 1 - ((offer.price || 0) - 2000) / 12000));
  const vfm = Math.max(0, Math.min(1, ratingPart * 0.6 + pricePartV * 0.4));
  const base = 0.4 * vfm + 0.25 * ratingPart + 0.15 * pricePartV + 0.1 * starPart + 0.1 * t;
  const valueScore = Math.max(0, Math.min(100,
    Math.round(base * 100 + (fit - 0.5) * 2 * FIT_WEIGHT)
  ));

  return { ...offer, score, trust: t, adjRating, valueScore };
}

// Czy KTÓRYKOLWIEK wariant obiektu spełnia warunek? Oferta pakietowa po scaleniu
// (dedupeOffers) niesie `variants[]` — wszystkie terminy tego samego hotelu, także te
// z innych lotnisk i od innych operatorów niż wariant pokazany jako reprezentant.
// Filtr, który patrzy tylko na pola reprezentanta, odsiewa obiekty realnie pasujące.
//
// Oferty hotel-only (bez `type === "package"`) nie pasują do filtrów pakietowych z zasady
// — użytkownik szuka wtedy wyjazdu z konkretnego miasta, nie samego noclegu.
export function matchesAnyVariant(offer, warunek) {
  if (offer.type !== "package") return false;
  const warianty = offer.variants && offer.variants.length ? offer.variants : [offer];
  return warianty.some((v) => warunek(v));
}

// Suma za CAŁĄ GRUPĘ: priceTotal dostawcy, ale TYLKO gdy dotyczy tylu osób, ilu
// faktycznie jedzie. Inaczej cena/os. × liczba osób — ten sam wzór co offerTotal()
// we froncie (public/index.html), żeby sortowanie po sumie i wyświetlana suma nigdy
// się nie rozjechały.
//
// Skąd warunek na liczbę osób: źródła pakietowe (demo, wakacje.pl) podają „cenę za
// wyjazd" dla DWÓCH osób, bo tak wygląda standardowa oferta operatora. Kod czytał ją
// jako sumę za grupę niezależnie od składu. Zmierzone 17.08.2026 na seedzie demo:
// dla rodziny 2+3 wszystkie 12 ofert pokazywały sumę za parę — np. Royal Wings
// 9 340 zł zamiast ~23 350 zł. Konsultant przekleja tę liczbę klientowi, więc to
// najgroźniejszy rodzaj pomyłki, jaki może zrobić narzędzie sprzedażowe.
//
// Brak `priceTotalPax` traktujemy jak brak wiedzy, dla ilu osób jest suma — wtedy
// liczymy szacunek z ceny za osobę zamiast ufać liczbie nieznanego pochodzenia.
export function offerGroupTotal(offer, pax) {
  const osob = Math.max(1, pax || 1);
  const suma = typeof offer.priceTotal === "number" && offer.priceTotal > 0;
  const dlaIlu = offer.priceTotalPax;
  if (suma && dlaIlu === osob) return offer.priceTotal;
  return offer.price * osob;
}

// Czy „Razem” to liczba od operatora, czy nasz szacunek z ceny za osobę. Interfejs
// ma prawo to rozróżnić i napisać wprost, zamiast podawać oszacowanie jako fakt.
export function isGroupTotalExact(offer, pax) {
  return typeof offer.priceTotal === "number" && offer.priceTotal > 0
    && offer.priceTotalPax === Math.max(1, pax || 1);
}

// `pax` (liczba osób z kryteriów wyszukiwania) jest potrzebny tylko dla trybu "total" —
// część operatorów stosuje promocje typu „druga osoba za symboliczną kwotę", więc oferta
// droższa za osobę bywa tańsza w sumie dla grupy (patrz docs/struktura-oferty-pakietowej.md).
// Sortowanie po cenie/os. potrafi wtedy postawić na pierwszym miejscu ofertę, która dla
// pary jest droższa — stąd osobny tryb.
export function sortOffers(list, mode, pax) {
  const arr = list.slice();
  arr.sort((a, b) => {
    if (mode === "price") return a.price - b.price;
    if (mode === "total") return offerGroupTotal(a, pax) - offerGroupTotal(b, pax);
    if (mode === "value") return (b.valueScore || 0) - (a.valueScore || 0);
    if (mode === "rating") return b.rating - a.rating;
    if (mode === "trust") return b.trust - a.trust;
    return b.score - a.score; // domyślnie: trafność
  });
  return arr;
}

// Normalizacja tekstu do porównań nazw: małe litery + usunięcie polskich znaków
// diakrytycznych (ł, ą, é…), żeby "Lagoon" == "lagoon", a "Dżerba" == "dzerba".
// Ile z przefiltrowanych ofert faktycznie POTWIERDZA każdy z wybranych atrybutów,
// a ile przeszło tylko dlatego, że dostawca nie podał danych.
//
// Po co: zasada „brak danych nie odsiewa oferty" jest słuszna, ale na rzadkich
// atrybutach potrafi wprowadzić w błąd. Zmierzone 01.08.2026 na realnych danych:
// filtr „Pokoje połączone" zwracał 30 ofert, z których ANI JEDNA nie miała tej
// informacji — konsultant czytał to jako „30 hoteli z pokojami połączonymi”.
// Dla porównania „Osobna sypialnia”: 123 oferty = 93 potwierdzone + 30 niewiadomych,
// czyli proporcja zdrowa. Sama liczba wyników nie odróżnia tych dwóch sytuacji.
//
// Zwraca dane, nie ocenę — to interfejs decyduje, jak je pokazać. Liczy na liście
// PO filtrach, bo oferty z jawnym „nie ma” już z niej wypadły.
export function attributeCoverage(list, crit) {
  const attrs = (crit && crit.attrs) || [];
  if (!attrs.length) return [];

  return attrs.map((key) => {
    let confirmed = 0;
    let unknown = 0;
    for (const offer of list) {
      const val = hasAttribute(offer, key);
      if (val === true) confirmed++;
      else if (val === undefined) unknown++;
    }
    return { key, confirmed, unknown };
  });
}

// Które z wybranych atrybutów TA KONKRETNA oferta nie potwierdza (hasAttribute
// === undefined) — czyli przeszła filtr wyłącznie dlatego, że brak danych nie
// odsiewa ofert. attributeCoverage() liczy to zbiorczo dla całej listy; tu jest
// wersja per oferta, żeby karta mogła oznaczyć TĘ cechę jako niepewną zamiast
// dawać konsultantowi wrażenie, że skoro oferta przeszła filtr „Przy plaży", to
// na pewno jest przy plaży.
export function unknownAttrs(offer, attrs) {
  if (!attrs || !attrs.length) return [];
  return attrs.filter((key) => hasAttribute(offer, key) === undefined);
}

// ------------------------------------------------------------------
//  Który filtr wyciął wyniki (podpowiedź przy zerze ofert)
//
//  „Nic nie pasuje do tych kryteriów" jest prawdziwe, ale bezużyteczne przy
//  kliencie: konsultant nie wie, czy zawadza budżet, ocena, czy dzień wylotu,
//  i zaczyna zdejmować filtry po kolei. Tymczasem lista ofert jest już pobrana,
//  więc policzenie „ile byłoby BEZ tego jednego filtra" nic nie kosztuje —
//  ani jednego zapytania do dostawcy.
//
//  Efekt przy stole: „dla 900 zł/os. nie ma nic, ale przy zdjęciu budżetu
//  mamy 47 ofert" to zdanie, które od razu prowadzi rozmowę dalej.
//
//  Kierunku (countries) świadomie NIE proponujemy do zdjęcia — klient pyta
//  o konkretne miejsce, a nie o „cokolwiek gdziekolwiek". Regiony owszem:
//  zdjęcie zawężenia do regionu zostawia wybrany kraj.
// ------------------------------------------------------------------
const FILTRY_DO_ROZLUZNIENIA = [
  { klucz: "budget", pusty: 0, etykieta: "budżet", opis: (c) => `${c.budget} zł ${c.budgetMode === "total" ? "za grupę" : "/os."}` },
  { klucz: "minRate", pusty: 0, etykieta: "minimalna ocena", opis: (c) => String(c.minRate).replace(".", ",") },
  { klucz: "minStars", pusty: 0, etykieta: "kategoria obiektu", opis: (c) => `min. ${c.minStars}★` },
  { klucz: "onlyReviewed", pusty: false, etykieta: "tylko z realnymi opiniami", opis: () => "" },
  { klucz: "nights", pusty: 0, etykieta: "długość pobytu", opis: (c) => `${c.nights} nocy` },
  { klucz: "boards", pusty: [], etykieta: "wyżywienie", opis: (c) => c.boards.join(", ") },
  { klucz: "tags", pusty: [], etykieta: "profil wyjazdu", opis: (c) => c.tags.join(", ") },
  { klucz: "attrs", pusty: [], etykieta: "atrybuty obiektu", opis: (c) => c.attrs.join(", ") },
  { klucz: "regions", pusty: [], etykieta: "zawężenie do regionów", opis: (c) => c.regions.join(", ") },
  { klucz: "departures", pusty: [], etykieta: "miasto wylotu", opis: (c) => c.departures.join(", ") },
  { klucz: "transports", pusty: [], etykieta: "środek transportu", opis: (c) => c.transports.join(", ") },
  { klucz: "weekdays", pusty: [], etykieta: "dzień wylotu", opis: (c) => c.weekdays.join(", ") },
];

const aktywny = (wartosc) => Array.isArray(wartosc) ? wartosc.length > 0 : !!wartosc;

// `granice` to wartości, jakie panel USTAWI po kliknięciu „Zdejmij" — bo część
// filtrów nie da się wyłączyć do zera: suwak oceny zaczyna się od 6, budżet kończy
// na swoim maksimum. Bez tego podpowiedź obiecywała stan nieosiągalny w interfejsie:
// zmierzone 17.08.2026 — „bez oceny 4 oferty", a po kliknięciu wychodziła 1, bo suwak
// siadał na 6, nie na 0. Liczba, która nie zgadza się z tym, co widać po kliknięciu,
// jest gorsza niż jej brak.
export function podpowiedziRozluznienia(list, crit, granice = {}) {
  if (!list || !list.length || !crit) return [];
  const wynik = [];
  for (const f of FILTRY_DO_ROZLUZNIENIA) {
    if (!aktywny(crit[f.klucz])) continue;
    const po = granice[f.klucz] !== undefined ? granice[f.klucz] : f.pusty;
    // Granica równa obecnej wartości znaczy, że nie ma czego zdejmować.
    if (po === crit[f.klucz]) continue;
    const ile = applyFilters(list, { ...crit, [f.klucz]: po }).length;
    if (ile > 0) wynik.push({ klucz: f.klucz, etykieta: f.etykieta, wartosc: f.opis(crit), ofert: ile });
  }
  // Najpierw ten, który odblokowuje najwięcej — konsultant czyta pierwszą linijkę.
  return wynik.sort((a, b) => b.ofert - a.ofert);
}

export function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ł/g, "l") // ł
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // znaki diakrytyczne
    .replace(/\s+/g, " ") // zwiń wielokrotne spacje (różne zapisy między źródłami)
    .trim();
}

// Atrybuty oferty pokazywane w 3 kolumnach (wzorem MerlinX): Lokalizacja / Obiekt / Aktywność.
// Lokalizacja liczy się z realnego dystansu (m), gdy dostawca go poda (patrz hotelbeds.js:
// beach/centre/airport). Obiekt i Aktywność to jawne flagi w offer.amenities.
const ATTR_DIST = {
  plaza: { field: "beach", max: 300 },
  centrum: { field: "centre", max: 1500 },
  lotnisko: { field: "airport", max: 5000 },
};
const ATTR_AMENITY = new Set([
  "basen", "spa", "wifi", "niepelnosprawni",
  "animacje", "sporty-wodne", "klub-dzieci", "silownia",
]);

// Układ pokoju — czytany z `offer.roomType` (Hotelbeds: rooms[].name z availability).
// ŚWIADOMIE DWA OSOBNE ATRYBUTY, nie jeden wspólny „dzielony":
//   pokoj-dzielony    = JEDNA jednostka z osobną sypialnią (rodzinny, apartament,
//                       duplex) — jeden klucz, jedna łazienka, dzieci za ścianą;
//   pokoje-polaczone  = DWA pokoje z drzwiami między nimi (connecting) — dwa klucze,
//                       zwykle dwie łazienki i wyraźnie wyższa cena.
// Konsultant sprzedaje te dwie rzeczy inaczej i klient płaci za nie inaczej, więc
// wrzucenie ich do wspólnego worka wprowadzałoby w błąd przy rozmowie o cenie.
const ATTR_ROOM = new Set(["pokoj-dzielony", "pokoje-polaczone"]);

// Nazwy pokoi przychodzą po angielsku (Hotelbeds), po hiszpańsku (sandbox) i po
// polsku (dane demo) — dlatego dopasowujemy na tekście znormalizowanym.
const ROOM_DIVIDED = /\bfamily\b|rodzinn|bedroom|sypialni|duplex|dwupokojow|apartment|apartament|maisonette/;
// „Suite" liczy się jako osobna sypialnia, ale „Junior Suite" NIE — to zwykle jeden
// pokój z wnęką, a nie oddzielne pomieszczenie do spania. Mylenie tych dwóch to
// dokładnie ten rodzaj przekoloryzacji, przez który klient czuje się oszukany na miejscu.
const ROOM_SUITE = /\bsuite\b/;
const ROOM_JUNIOR_SUITE = /junior\s*suite/;
const ROOM_CONNECTING = /connecting|interconnect|comunicad|polaczon/;

/** Czy nazwa pokoju opisuje jednostkę z wydzielonym miejscem do spania. */
export function isDividedRoom(roomType) {
  const t = normalizeName(roomType);
  if (!t) return undefined; // brak nazwy pokoju = nie wiemy, a nie „nie ma"
  if (ROOM_DIVIDED.test(t)) return true;
  return ROOM_SUITE.test(t) && !ROOM_JUNIOR_SUITE.test(t);
}

// Czy oferta ma dany atrybut: true/false gdy wiadomo, undefined gdy BRAK DANYCH.
// Brak danych nigdy nie liczy się jako "nie posiada" — to ANTY-PRZEKOLORYZACJA:
// milczące odsiewanie ofert bez informacji wyglądałoby jak wiedza, której nie mamy.
export function hasAttribute(offer, key) {
  const dist = ATTR_DIST[key];
  if (dist) {
    const v = offer[dist.field];
    return v == null ? undefined : v <= dist.max;
  }
  if (ATTR_AMENITY.has(key)) {
    if (!Array.isArray(offer.amenities)) return undefined;
    // Sama pusta pozycja w tablicy amenities to za mało, żeby powiedzieć „nie ma".
    // Provider może zadeklarować w `amenityCoverage`, o KTÓRYCH udogodnieniach w ogóle
    // ma wiedzę; klucz spoza tej listy to brak danych, nie zaprzeczenie. Bez deklaracji
    // (Hotelbeds) zostaje stara reguła: tablica istnieje = odpowiedź jest znana.
    // Po co: seed demo wyprowadza amenities z tagów, więc każda oferta miała tablicę,
    // ale żadna nie mogła mieć "niepelnosprawni" — i konsultant szukający hotelu dla
    // klienta na wózku dostawał „0 z 91" jako sprawdzone zaprzeczenie zamiast niewiedzy.
    if (Array.isArray(offer.amenityCoverage) && !offer.amenityCoverage.includes(key)) return undefined;
    return offer.amenities.includes(key);
  }
  if (ATTR_ROOM.has(key)) {
    // Uwaga: availability zwraca nazwę TEGO wariantu pokoju, o który zapytaliśmy.
    // Brak dopasowania znaczy więc „ten wariant nie jest dzielony", a NIE „hotel
    // nie ma pokoi rodzinnych" — dlatego filtr wycina tylko jawne dopasowanie
    // negatywne, a oferty bez nazwy pokoju zostawia w wynikach.
    const t = normalizeName(offer.roomType);
    if (!t) return undefined;
    return key === "pokoj-dzielony" ? isDividedRoom(t) : ROOM_CONNECTING.test(t);
  }
  return undefined;
}

// Warunki filtrów pakietowych w KOLEJNOŚCI zgodnej z applyFilters — ta sama logika
// dopasowania wariantu (departures/departure, transports, weekdays), żeby
// promoteMatchingVariant wybierał spośród dokładnie tych wariantów, przez które
// oferta w ogóle przeszła filtr. Zwraca [] gdy żaden filtr pakietowy nie jest aktywny.
export function activeVariantPredicates(crit) {
  const preds = [];
  if (crit.departures && crit.departures.length) {
    preds.push((v) => crit.departures.includes(v.departureCity));
  } else if (crit.departure) {
    preds.push((v) => v.departureCity === crit.departure);
  }
  if (crit.transports && crit.transports.length) {
    preds.push((v) => crit.transports.includes(v.transport));
  }
  if (crit.weekdays && crit.weekdays.length) {
    preds.push((v) => v.departDate && crit.weekdays.includes(new Date(`${v.departDate}T00:00:00`).getDay()));
  }
  return preds;
}

// Pola WARIANTU (konkretnego terminu/lotu) — dane HOTELU (nazwa, kraj, region,
// gwiazdki, ocena, plaża, zdjęcia...) tu celowo nie występują i zostają nietknięte.
const VARIANT_FIELDS = [
  "departureCity", "departureCode", "arrivalCode", "departDate", "returnDate",
  "price", "priceTotal", "operator", "carrier", "flightNo", "board",
  "nights", "days", "seatsLeft", "transport",
];

// Po applyFilters oferta na liście PASUJE do filtrów pakietowych (patrz
// matchesAnyVariant), ale reprezentant wybrany przez dedupeOffers() bywa INNYM
// wariantem niż ten, który faktycznie pasował. Efekt: konsultant zaznacza
// „Wylot z: Katowice", dostaje hotel na liście — i widzi na karcie „Wylot:
// Warszawa" plus cenę tamtego wariantu. Oferta jest, ale opisana nie tym, o co
// pytał konsultant. Zmierzone na seedzie demo: z 56 hoteli pasujących do „Wylot
// z: Katowice" aż 37 pokazywało na reprezentancie inne miasto wylotu.
//
// promoteMatchingVariant przestawia pola WIERZCHNIE oferty na NAJTAŃSZY (po sumie
// za grupę — patrz offerGroupTotal) wariant spełniający WSZYSTKIE aktywne filtry
// pakietowe NARAZ. Gdy żaden filtr pakietowy nie jest aktywny, albo żaden wariant
// nie spełnia ich wszystkich jednocześnie, oferta wraca nietknięta — nie ma
// jednoznacznego wariantu, na który dałoby się bezpiecznie przestawić.
// h.variants ZOSTAJE kompletną listą (konsultant dalej widzi wszystkie terminy
// w zakładce „Terminy i operatorzy") — podmieniane są tylko pola na wierzchu oferty.
export function promoteMatchingVariant(offer, crit) {
  if (offer.type !== "package") return offer;
  if (!offer.variants || offer.variants.length < 2) return offer;

  const preds = activeVariantPredicates(crit);
  if (!preds.length) return offer;

  const matching = offer.variants.filter((v) => preds.every((p) => p(v)));
  if (!matching.length) return offer;

  let best = matching[0];
  let bestTotal = offerGroupTotal(best, crit.pax);
  for (let i = 1; i < matching.length; i++) {
    const total = offerGroupTotal(matching[i], crit.pax);
    if (total < bestTotal) { best = matching[i]; bestTotal = total; }
  }

  const promoted = { ...offer };
  for (const key of VARIANT_FIELDS) promoted[key] = best[key];
  return promoted;
}

// Oferta bywa na liście, choć ŻADEN pojedynczy termin nie spełnia wszystkich
// aktywnych filtrów pakietowych naraz — patrz applyFilters (matchesAnyVariant
// sprawdza każdy filtr osobno) i promoteMatchingVariant wyżej (wraca nietknięty,
// gdy nie ma wariantu spełniającego wszystko naraz). Konsultant zaznacza „Wylot:
// Warszawa" + „Autokar", dostaje hotel na liście — a żaden termin nie łączy obu
// warunków. Karta o tym milczała. Zmierzone 18/19.08.2026 na seedzie demo: dla
// „Katowice + wylot w sobotę" 11 z 23 pasujących hoteli nie miało ani jednego
// takiego wariantu.
//
// Te SAME predykaty co promoteMatchingVariant (activeVariantPredicates) — flaga
// i wybór reprezentanta nigdy się nie rozjadą. Przy jednym albo zerze aktywnych
// filtrów pakietowych zawsze false: pojedynczy warunek zawsze ma „swój" wariant,
// bo inaczej oferta w ogóle nie przeszłaby applyFilters.
export function filtrRozproszony(offer, crit) {
  if (offer.type !== "package") return false;
  const warianty = offer.variants && offer.variants.length ? offer.variants : [offer];
  if (warianty.length < 2) return false;
  const preds = activeVariantPredicates(crit);
  if (preds.length < 2) return false;
  return !warianty.some((v) => preds.every((p) => p(v)));
}

// Filtrowanie po kryteriach (wspólne dla wszystkich dostawców).
export function applyFilters(list, crit) {
  // Wyszukiwanie po NAZWIE hotelu jest dominujące: gdy podano nazwę,
  // pomijamy miękkie filtry (budżet, ocena, wyżywienie, profil, liczba osób),
  // żeby konkretny hotel zawsze się pokazał — niezależnie od pozostałych suwaków.
  if (crit.name) {
    const needle = normalizeName(crit.name);
    return needle ? list.filter((h) => normalizeName(h.name).includes(needle)) : list;
  }

  const hasCountries = crit.countries && crit.countries.length;
  const hasRegions = crit.regions && crit.regions.length;

  return list.filter((h) => {
    // --- Filtr geograficzny: SUMA „całych krajów" i „konkretnych regionów" ---
    // Oferta przechodzi, gdy jej kraj jest zaznaczony w całości (countryOk),
    // ALBO jej region pasuje do któregoś z zaznaczonych regionów (regionOk).
    // „Cały kraj" filtruje po nazwie kraju (odporne na różnice nazw regionów,
    // np. „Marsa Alam" vs „Marsa El Alam").
    if (hasCountries || hasRegions) {
      const countryOk = hasCountries && crit.countries.includes(h.country);
      let regionOk = false;
      if (hasRegions && !countryOk) {
        if (h.source === "Hotelbeds") {
          // HB odpytywany po kodach destynacji (region po angielsku) — przepuszczamy.
          regionOk = true;
        } else {
          const hay = (h.region || "").toLowerCase();
          regionOk = crit.regions.some((reg) => {
            // Pierwszy człon nazwy regionu (przed „/", „(" lub „,"), np.
            // „Kreta, Heraklion" -> „kreta", by pasowało do „Kreta" z wakacje.pl.
            const needle = reg.split(/[\/(,]/)[0].trim().toLowerCase();
            return needle && hay.includes(needle);
          });
        }
      }
      if (!countryOk && !regionOk) return false;
    } else if (crit.dest && h.country !== crit.dest) {
      // Wsteczna zgodność: pojedynczy kierunek (agent NL / stare wywołania).
      return false;
    }
    // Budżet = TWARDY limit realnej ceny. Tryb "total" porównuje z ceną łączną
    // za cały wyjazd (priceTotal z API — za 2 dor.; w braku: cena/os. × liczba osób),
    // tryb "person" — z ceną za osobę. Ustawisz 8000 → nic powyżej 8000 się nie pokaże.
    if (crit.budget) {
      if (crit.budgetMode === "total") {
        const total = h.priceTotal || h.price * Math.max(1, crit.pax || 2);
        if (total > crit.budget) return false;
      } else if (h.price > crit.budget) return false;
    }
    // Ocena nieznana (`null`/`undefined`) NIE odsiewa oferty — ta sama zasada co przy
    // gwiazdkach i atrybutach obiektu: odrzucamy tylko to, o czym WIEMY, że nie spełnia
    // kryterium. Wcześniej oferta bez oceny wypadała przy każdym progu, bo `null < 9`
    // jest prawdą — a panel i tak oznacza takie oferty jako „brak danych o opiniach".
    if (crit.minRate && h.rating != null && h.rating < crit.minRate) return false;
    // Gwiazdki: `h.stars == null` znaczy „dostawca nie podał kategorii", a nie
    // „hotel jest słaby". Nieznaną kategorię przepuszczamy — ta sama zasada co
    // przy atrybutach obiektu. Stary `(h.stars || 0)` wywalał takie oferty przy
    // KAŻDYM ustawionym progu, bo undefined schodziło do zera.
    if (crit.minStars && h.stars != null && h.stars < crit.minStars) return false;
    // „Tylko z realnymi opiniami" — anty-przekoloryzacja: odrzuca oferty bez wolumenu opinii.
    if (crit.onlyReviewed && !(h.reviews > 0)) return false;
    // Długość pobytu: tolerancja ±1 noc (7 vs 8 to praktycznie ten sam wyjazd).
    if (crit.nights && h.nights && Math.abs(h.nights - crit.nights) > 1) return false;
    // Wyżywienie: oferta bez potwierdzonego kodu (h.board == null) NIE jest
    // odsiewana — inaczej powtórzyłby się błąd filtra profilu z 05.08, tyle że
    // na 34,7% stawek Hotelbeds. Panel oznacza takie oferty jako „brak danych",
    // więc konsultant widzi różnicę między potwierdzonym HB a niewiadomą.
    if (crit.boards && crit.boards.length && h.board != null && !crit.boards.includes(h.board)) {
      return false;
    }
    // Profil wyjazdu = twardy filtr (OR): oferta musi mieć CHOĆ JEDEN z wybranych
    // tagów. OR (nie AND), bo tagi są heurystyczne — nie chcemy wycinać za ostro.
    // Profil wyjazdu (rodzinny / para / imprezowy) — ta sama zasada co przy atrybutach
    // obiektu: odsiewamy tylko te oferty, o których WIEMY, że profilu nie mają.
    // Dostawca, który nie przysyła tagów, nie może przez to znikać z wyników —
    // Hotelbeds to ponad połowa realnych ofert i ZERO tagów, więc twardy filtr
    // wycinał całe żywe źródło, zostawiając konsultanta z samymi danymi demo.
    // Oferty o nieznanym profilu ranking i tak stawia niżej niż potwierdzone
    // dopasowane (patrz clientFit) — widoczne, ale nie udające pewniaka.
    if (crit.tags && crit.tags.length) {
      const tagiOferty = h.tags || [];
      if (tagiOferty.length && !crit.tags.some((t) => tagiOferty.includes(t))) return false;
    }
    if (crit.pax && h.cap < crit.pax) return false;
    // Filtry pakietowe: dotyczą tylko ofert typu "package" (lot+hotel).
    // Gdy aktywne, oferty hotel-only odpadają — użytkownik szuka wyjazdu z konkretnego miasta.
    // Wylot z (wiele miast): oferta pakietowa musi startować z któregokolwiek wybranego.
    // ⚠️ Filtry pakietowe muszą patrzeć na WSZYSTKIE warianty obiektu, nie tylko na ten
    // wybrany na reprezentanta przez dedupeOffers(). Odkąd jeden hotel ma po kilka
    // wariantów z różnych lotnisk i od różnych operatorów, sprawdzanie samego
    // h.departureCity gubiło większość trafień: zmierzone na seedzie demo — 56 hoteli
    // ma lot z Katowic, a filtr przepuszczał 19. Konsultant, który zaznaczył lotnisko
    // klienta, tracił 2/3 realnie dostępnych ofert i nie miał jak się o tym dowiedzieć.
    if (crit.departures && crit.departures.length && !matchesAnyVariant(h, (v) => crit.departures.includes(v.departureCity))) return false;
    else if (crit.departure && !matchesAnyVariant(h, (v) => v.departureCity === crit.departure)) return false;
    if (crit.transports && crit.transports.length && !matchesAnyVariant(h, (v) => crit.transports.includes(v.transport))) return false;
    // Atrybuty (Lokalizacja/Obiekt/Aktywność) — wyklucza TYLKO jawne "nie posiada".
    // Brak danych o atrybucie (hasAttribute === undefined) nie wyklucza oferty.
    if (crit.attrs && crit.attrs.length && crit.attrs.some((a) => hasAttribute(h, a) === false)) return false;
    // Dni tygodnia wylotu: filtr twardy jak przy mieście wylotu — dotyczy tylko
    // pakietów ze znaną datą wylotu (hotel-only i pakiet bez daty nie pasują do wyboru).
    if (crit.weekdays && crit.weekdays.length) {
      // Ten sam problem co przy lotnisku: warianty tego samego hotelu wylatują
      // w różne dni tygodnia, więc dzień reprezentanta nie przesądza o całym obiekcie.
      if (!matchesAnyVariant(h, (v) => {
        if (!v.departDate) return false;
        return crit.weekdays.includes(new Date(`${v.departDate}T00:00:00`).getDay());
      })) return false;
    }
    return true;
  });
}
