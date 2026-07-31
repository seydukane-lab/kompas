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

export function trustLabel(t) {
  if (t >= 0.7) return { cls: "high", txt: "Opinie wiarygodne" };
  if (t >= 0.45) return { cls: "mid", txt: "Opinie umiarkowane" };
  return { cls: "low", txt: "Mało / stare opinie" };
}

// Ranking trafności: ocena skorygowana o wiarygodność + cena + dopasowanie profilu + standard.
export function scoreOffer(offer, crit) {
  const t = trustScore(offer);
  // Ocena "skorygowana": niepewne oceny ściągane w stronę średniej (7.5) -> anty-przekoloryzacja.
  const adjRating = offer.rating * t + 7.5 * (1 - t);
  const ratingPart = Math.max(0, Math.min(1, (adjRating - 6) / 4));

  let pricePart = 1 - (offer.price - 2500) / 9000;
  pricePart = Math.max(0, Math.min(1, pricePart));

  const tags = (crit && crit.tags) || [];
  let tagMatch = 0.5;
  if (tags.length) {
    const hit = tags.filter((x) => (offer.tags || []).includes(x)).length;
    tagMatch = hit / tags.length;
  }

  const starPart = (offer.stars || 3) / 5;
  const score =
    0.34 * ratingPart + 0.22 * pricePart + 0.2 * tagMatch + 0.1 * starPart + 0.14 * t;

  // valueScore (0-100) = "jakość za pieniądze". Ten sam wzór co kliencki etaValue,
  // żeby liczby na karcie i sortowanie się nie rozjeżdżały. Nie zmyśla nic ponad
  // dane, które już mamy (cena, ocena ważona wiarygodnością, standard).
  const pricePartV = Math.max(0, Math.min(1, 1 - ((offer.price || 0) - 2000) / 12000));
  const vfm = Math.max(0, Math.min(1, ratingPart * 0.6 + pricePartV * 0.4));
  const valueScore = Math.round(
    (0.4 * vfm + 0.25 * ratingPart + 0.15 * pricePartV + 0.1 * starPart + 0.1 * t) * 100
  );

  return { ...offer, score, trust: t, adjRating, valueScore };
}

export function sortOffers(list, mode) {
  const arr = list.slice();
  arr.sort((a, b) => {
    if (mode === "price") return a.price - b.price;
    if (mode === "value") return (b.valueScore || 0) - (a.valueScore || 0);
    if (mode === "rating") return b.rating - a.rating;
    if (mode === "trust") return b.trust - a.trust;
    return b.score - a.score; // domyślnie: trafność
  });
  return arr;
}

// Normalizacja tekstu do porównań nazw: małe litery + usunięcie polskich znaków
// diakrytycznych (ł, ą, é…), żeby "Lagoon" == "lagoon", a "Dżerba" == "dzerba".
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
    return Array.isArray(offer.amenities) ? offer.amenities.includes(key) : undefined;
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
    if (crit.minRate && h.rating < crit.minRate) return false;
    if (crit.minStars && (h.stars || 0) < crit.minStars) return false;
    // „Tylko z realnymi opiniami" — anty-przekoloryzacja: odrzuca oferty bez wolumenu opinii.
    if (crit.onlyReviewed && !(h.reviews > 0)) return false;
    // Długość pobytu: tolerancja ±1 noc (7 vs 8 to praktycznie ten sam wyjazd).
    if (crit.nights && h.nights && Math.abs(h.nights - crit.nights) > 1) return false;
    if (crit.boards && crit.boards.length && !crit.boards.includes(h.board)) return false;
    // Profil wyjazdu = twardy filtr (OR): oferta musi mieć CHOĆ JEDEN z wybranych
    // tagów. OR (nie AND), bo tagi są heurystyczne — nie chcemy wycinać za ostro.
    if (crit.tags && crit.tags.length && !crit.tags.some((t) => (h.tags || []).includes(t))) return false;
    if (crit.pax && h.cap < crit.pax) return false;
    // Filtry pakietowe: dotyczą tylko ofert typu "package" (lot+hotel).
    // Gdy aktywne, oferty hotel-only odpadają — użytkownik szuka wyjazdu z konkretnego miasta.
    // Wylot z (wiele miast): oferta pakietowa musi startować z któregokolwiek wybranego.
    if (crit.departures && crit.departures.length && !(h.type === "package" && crit.departures.includes(h.departureCity))) return false;
    else if (crit.departure && !(h.type === "package" && h.departureCity === crit.departure)) return false;
    if (crit.transports && crit.transports.length && !(h.type === "package" && crit.transports.includes(h.transport))) return false;
    // Atrybuty (Lokalizacja/Obiekt/Aktywność) — wyklucza TYLKO jawne "nie posiada".
    // Brak danych o atrybucie (hasAttribute === undefined) nie wyklucza oferty.
    if (crit.attrs && crit.attrs.length && crit.attrs.some((a) => hasAttribute(h, a) === false)) return false;
    // Dni tygodnia wylotu: filtr twardy jak przy mieście wylotu — dotyczy tylko
    // pakietów ze znaną datą wylotu (hotel-only i pakiet bez daty nie pasują do wyboru).
    if (crit.weekdays && crit.weekdays.length) {
      if (!(h.type === "package" && h.departDate)) return false;
      const wd = new Date(`${h.departDate}T00:00:00`).getDay();
      if (!crit.weekdays.includes(wd)) return false;
    }
    return true;
  });
}
