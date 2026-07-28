// ============================================================
//  Provider: HOTELBEDS APItude  (prawdziwe dane + zdjęcia)
//  Dokumentacja: https://developer.hotelbeds.com
//
//  Włącza się TYLKO gdy w .env są HOTELBEDS_API_KEY i HOTELBEDS_SECRET.
//  Bez nich isEnabled() zwraca false i provider jest pomijany.
//
//  Uwaga o zdjęciach: przychodzą z Content API wraz z licencją na
//  wyświetlanie w ramach umowy partnerskiej — to legalne źródło,
//  NIE scrapujemy stron.
// ============================================================

import crypto from "node:crypto";
import { regionCode, regionInfo } from "../countries.js";
import { fetchWithTimeout, createLimiter, withRetry } from "../http.js";
import { eurToPln } from "../fx.js";

// Wszystkie zapytania do Hotelbeds idą przez wspólną kolejkę. Multiroom pyta
// osobno o każdy pokój i każdą destynację, więc jedno kliknięcie konsultanta
// potrafiło wysłać kilkanaście zapytań naraz i dostać serię 429 — a wtedy
// wyszukiwanie kończyło się pustą listą mimo wolnych miejsc.
const limit = createLimiter({
  concurrency: Number(process.env.HOTELBEDS_CONCURRENCY) || 1,
  minIntervalMs: Number(process.env.HOTELBEDS_MIN_INTERVAL_MS) || 250,
});

const KEY = process.env.HOTELBEDS_API_KEY || "";
const SECRET = process.env.HOTELBEDS_SECRET || "";
const ENV = (process.env.HOTELBEDS_ENV || "test").toLowerCase();

const BASE =
  ENV === "prod"
    ? "https://api.hotelbeds.com"
    : "https://api.test.hotelbeds.com";

// Baza CDN zdjęć Hotelbeds. Ścieżki z Content API są względne.
const PHOTO_CDN = "https://photos.hotelbeds.com/giata/bigger/";

export const meta = { id: "hotelbeds", label: "Hotelbeds", needsKeys: true };

export function isEnabled() {
  return Boolean(KEY && SECRET);
}

// Podpis wymagany przez Hotelbeds: SHA256(apiKey + secret + unixTimeSeconds)
function signature() {
  const ts = Math.floor(Date.now() / 1000);
  return crypto.createHash("sha256").update(KEY + SECRET + ts).digest("hex");
}

function headers() {
  return {
    "Api-key": KEY,
    "X-Signature": signature(),
    Accept: "application/json",
    "Content-Type": "application/json",
    "Accept-Encoding": "gzip",
  };
}

// --- Mapowanie kierunku (nasz kraj) -> reprezentatywny kod destynacji Hotelbeds ---
// UWAGA: środowisko TESTOWE ma dane głównie dla destynacji hiszpańskich
// (konto "HOTELBEDS SPAIN"). Kraje spoza tej listy zwrócą 0 hoteli w sandboxie —
// w produkcji rozbudowujemy to przez Content API /locations/destinations.
const DEST_CODES = {
  Hiszpania: "PMI",    // Majorka (296 hoteli w sandboxie)
  Grecja: "CHQ",       // Chania / Kreta (produkcja)
  Egipt: "SSH",        // Sharm el-Sheikh (produkcja)
  Turcja: "AYT",       // Antalya (produkcja)
  Włochy: "OLB",       // Olbia / Sardynia (produkcja)
  Tunezja: "DJE",      // Dżerba (produkcja)
  Portugalia: "FAO",   // Faro / Algarve (produkcja)
};

// Destynacje z realnymi danymi w sandboxie — używane dla "dowolny kierunek".
const SANDBOX_DESTS = ["PMI", "BCN", "AGP"];

// Kod wyżywienia Hotelbeds -> nasza etykieta
function mapBoard(code, name) {
  const c = (code || "").toUpperCase();
  if (c === "AI" || /all inclusive/i.test(name || "")) {
    return /ultra/i.test(name || "") ? "Ultra All Inclusive" : "All Inclusive";
  }
  if (c === "HB" || c === "FB") return "HB";
  if (c === "BB") return "BB";
  return "BB";
}

// Kategoria Hotelbeds (np. "4EST", "5EST") -> liczba gwiazdek
function mapStars(categoryCode) {
  const m = /(\d)/.exec(categoryCode || "");
  return m ? Number(m[1]) : 3;
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// ----------------------------------------------------------------
//  Główna funkcja providera
// ----------------------------------------------------------------
export async function search(crit) {
  // Priorytet: zaznaczone regiony -> ich kody destynacji (może być kilka).
  // Inaczej: kod kraju. Inaczej (kierunek dowolny): destynacje sandboxa.
  let targets;
  if (crit.regions && crit.regions.length) {
    // Regiony mogą pochodzić z różnych krajów — rozwiązujemy globalnie.
    targets = crit.regions
      .map((r) => (regionInfo(r) ? regionInfo(r).hbCode : regionCode(crit.dest, r)))
      .filter(Boolean);
  } else if (DEST_CODES[crit.dest]) {
    targets = [DEST_CODES[crit.dest]];
  } else {
    targets = SANDBOX_DESTS;
  }
  // Limit liczby destynacji na jedno wyszukiwanie (oszczędność limitu zapytań).
  targets = targets.slice(0, 4);

  const adults = crit.adults || 2;
  const children = crit.kids || 0;
  const pax = Math.max(1, adults + children);
  const from = crit.from ? isoDate(crit.from) : isoDate(Date.now() + 30 * 864e5);
  const to = crit.to ? isoDate(crit.to) : isoDate(Date.now() + 37 * 864e5);

  // Destynacje odpytujemy RÓWNOLEGLE (nie zwiększa liczby zapytań — ten sam
  // limit dzienny — a wyraźnie skraca czas odpowiedzi przy kilku regionach).
  const perDest = await Promise.all(
    targets.map(async (dest) => {
      try {
        const avail = await availability({ dest, from, to, adults, children });
        // Bierzemy górę listy — sandbox potrafi zwrócić setki hoteli.
        const hotels = (avail?.hotels?.hotels || []).slice(0, 40);
        if (!hotels.length) return [];

        // Wzbogacenie o treści statyczne (nazwa, zdjęcia, gwiazdki, plaża).
        const codes = hotels.map((h) => h.code);
        const content = await fetchContent(codes);

        return hotels.map((h) => normalize(h, content[h.code] || {}, cheapestRate(h), pax));
      } catch (err) {
        console.warn(`[hotelbeds] błąd dla destynacji ${dest}:`, err.message);
        return [];
      }
    })
  );
  return perDest.flat();
}

// ============================================================
//  MULTIROOM FINDER — dostępność na kilka pokoi/składów naraz.
//  crit.rooms = [{adults, children, ages:[]}, ...] (kilka rodzin/par, wspólny wyjazd).
//  Dla każdego składu pytamy availability OSOBNO (pewne, przetestowane zachowanie),
//  a potem bierzemy tylko hotele dostępne dla WSZYSTKICH pokoi (spójne: ten sam
//  hotel + termin) i sumujemy najtańsze raty. Wynik: oferty z rozbiciem ceny per
//  pokój, posortowane od najtańszych (suma za grupę). Anti-przekoloryzacja:
//  pokazujemy tylko realnie dostępne kombinacje — brak przecięcia = brak wyniku.
// ============================================================
export async function searchMultiroom(crit) {
  const rooms = normalizeRoomsInput(crit);
  // Tryb "any" = ułożenie obojętne: dla każdego hotelu wybieramy TANIEJ z dwóch
  // opcji — osobne spójne pokoje ALBO jeden duży pokój na cały skład.
  const mode = crit.roomsMode === "any" ? "any" : "split";
  const totalAdults = rooms.reduce((s, r) => s + r.adults, 0);
  const totalChildren = rooms.reduce((s, r) => s + r.children, 0);
  const totalPax = totalAdults + totalChildren || 1;
  const targets = resolveTargets(crit);
  const from = crit.from ? isoDate(crit.from) : isoDate(Date.now() + 30 * 864e5);
  const to = crit.to ? isoDate(crit.to) : isoDate(Date.now() + 37 * 864e5);

  // Ile zapytań do dostawcy padło. Bez tego licznika awaria API wygląda dla
  // konsultanta identycznie jak brak wolnych miejsc — a to dwie zupełnie różne
  // wiadomości dla klienta („nie ma miejsc" vs „system nie odpowiada").
  let bledy = 0;

  const availMap = (dest, adults, children) =>
    availability({ dest, from, to, adults, children })
      .then((a) => {
        const map = {};
        for (const h of a?.hotels?.hotels || []) map[h.code] = cheapestRate(h);
        return map;
      })
      .catch((err) => {
        bledy++;
        console.warn(`[hotelbeds][multiroom] ${dest} (${adults} dor. + ${children} dz.):`, err.message);
        return {};
      });

  const perDest = await Promise.all(
    targets.map(async (dest) => {
      try {
        // Osobne pokoje: zapytanie per skład -> przecięcie hoteli dostępnych dla WSZYSTKICH.
        const perRoom = await Promise.all(rooms.map((r) => availMap(dest, r.adults, r.children)));
        let common = Object.keys(perRoom[0] || {});
        for (let i = 1; i < perRoom.length; i++) common = common.filter((code) => perRoom[i][code]);
        const splitByCode = {};
        for (const code of common) splitByCode[code] = perRoom.map((m) => m[code]);

        // Jeden duży pokój na cały skład (tylko w trybie "any").
        let bigByCode = {};
        if (mode === "any") bigByCode = await availMap(dest, totalAdults, totalChildren);

        const codes = Array.from(new Set([...Object.keys(splitByCode), ...Object.keys(bigByCode)])).slice(0, 40);
        if (!codes.length) return [];
        const content = await fetchContent(codes);

        return codes
          .map((code) => {
            const c = content[code] || {};
            const split = splitByCode[code] ? normalizeMultiroom(code, c, splitByCode[code], rooms, totalPax) : null;
            const big = bigByCode[code] ? normalizeSingleRoom(code, c, bigByCode[code], totalAdults, totalChildren, totalPax) : null;
            if (split && big) return big.priceTotal < split.priceTotal ? big : split;
            return split || big;
          })
          .filter(Boolean);
      } catch (err) {
        bledy++;
        console.warn(`[hotelbeds][multiroom] błąd dla ${dest}:`, err.message);
        return [];
      }
    })
  );
  const offers = perDest.flat();

  // Pusty wynik przy awarii wszystkich zapytań to NIE jest „brak dostępności".
  // Milczące zero wysyła konsultanta do klienta z błędną informacją.
  if (!offers.length && bledy > 0) {
    throw new Error(
      `dostawca nie odpowiedział na ${bledy} z ${targets.length * (rooms.length + (mode === "any" ? 1 : 0))} zapytań — wynik nie jest wiarygodny`
    );
  }

  offers.sort((a, b) => a.priceTotal - b.priceTotal); // od najtańszych za grupę
  return offers;
}

// Składy pokoi z kryteriów (fallback: jeden pokój z ogólnej liczby gości).
function normalizeRoomsInput(crit) {
  if (Array.isArray(crit.rooms) && crit.rooms.length) {
    return crit.rooms.map((r) => ({
      adults: Math.max(1, +r.adults || 1),
      children: Math.max(0, +r.children || 0),
      ages: r.ages || [],
    }));
  }
  return [{ adults: crit.adults || 2, children: crit.kids || 0, ages: crit.childAges || [] }];
}

// Cele destynacji: zaznaczone regiony -> ich kody, inaczej kod kraju, inaczej sandbox.
function resolveTargets(crit) {
  let targets;
  if (crit.regions && crit.regions.length) {
    targets = crit.regions
      .map((r) => (regionInfo(r) ? regionInfo(r).hbCode : regionCode(crit.dest, r)))
      .filter(Boolean);
  } else if (crit.countries && crit.countries.length) {
    // Panel wysyła zaznaczone kraje w `countries` (wyszukiwarka pozwala wybrać
    // kilka naraz). Bez tej gałęzi wybór kraju w Multiroomie był po cichu
    // ignorowany i wpadał w „dowolny kierunek".
    targets = crit.countries.map((c) => DEST_CODES[c]).filter(Boolean);
  } else if (DEST_CODES[crit.dest]) {
    targets = [DEST_CODES[crit.dest]];
  } else {
    targets = SANDBOX_DESTS;
  }
  return targets.slice(0, 4);
}

// Oferta multiroom: bazowe atrybuty hotelu + rozbicie ceny per pokój + suma za grupę.
function normalizeMultiroom(code, c, rates, rooms, totalPax) {
  const base = normalize({ code, name: c.name?.content }, c, rates[0], totalPax);
  const breakdown = rooms.map((r, i) => {
    const rate = rates[i];
    const who = r.adults + " dor." + (r.children ? " + " + r.children + " dz." : "");
    return {
      label: "Pokój " + (i + 1) + " (" + who + ")",
      roomName: prettyRoom(rate.roomName),
      board: mapBoard(rate.boardCode, rate.boardName),
      price: Math.round(eurToPln(rate.net)),
    };
  });
  const priceTotal = breakdown.reduce((s, b) => s + b.price, 0);
  return {
    ...base,
    id: "hb-mr-" + code,
    multiroom: true,
    layout: "split", // osobne pokoje
    roomsCount: rooms.length,
    roomsBreakdown: breakdown,
    priceTotal,
    price: Math.round(priceTotal / Math.max(1, totalPax)),
  };
}

// Jeden duży pokój na cały skład grupy (opcja w trybie "obojętne").
function normalizeSingleRoom(code, c, rate, adults, children, totalPax) {
  const off = normalizeMultiroom(code, c, [rate], [{ adults, children }], totalPax);
  const who = adults + " dor." + (children ? " + " + children + " dz." : "");
  off.layout = "single";
  off.roomsCount = 1;
  off.roomsBreakdown[0].label = "Jeden pokój — wszyscy (" + who + ")";
  return off;
}

// --- Availability API: dostępność + ceny ---
async function availability({ dest, from, to, adults, children }) {
  const body = {
    stay: { checkIn: from, checkOut: to },
    occupancies: [
      {
        rooms: 1,
        adults,
        children,
        paxes:
          children > 0
            ? Array.from({ length: children }, () => ({ type: "CH", age: 8 }))
            : undefined,
      },
    ],
    destination: { code: dest },
  };
  return limit(() =>
    withRetry(async () => {
      const res = await fetchWithTimeout(`${BASE}/hotel-api/1.0/hotels`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = new Error(`availability HTTP ${res.status}`);
        err.status = res.status; // pozwala odróżnić „za dużo zapytań" od realnego błędu
        throw err;
      }
      return res.json();
    })
  );
}

// --- Content API: nazwy, zdjęcia, kategoria, odległość od plaży ---
async function fetchContent(codes) {
  if (!codes.length) return {};
  const params = new URLSearchParams({
    fields: "all",
    language: "ENG",
    from: "1",
    to: String(Math.min(codes.length, 50)),
    codes: codes.slice(0, 50).join(","),
  });
  const data = await limit(() =>
    withRetry(async () => {
      const res = await fetchWithTimeout(
        `${BASE}/hotel-content-api/1.0/hotels?${params.toString()}`,
        { headers: headers() }
      );
      if (!res.ok) {
        const err = new Error(`content HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    })
  );
  const map = {};
  for (const h of data.hotels || []) map[h.code] = h;
  return map;
}

function cheapestRate(h) {
  let best = null;
  for (const room of h.rooms || []) {
    for (const rate of room.rates || []) {
      const net = Number(rate.net);
      if (!best || net < best.net) best = { net, boardCode: rate.boardCode, boardName: rate.boardName, roomName: room.name };
    }
  }
  return best || { net: Number(h.minRate) || 0, boardCode: h.boardCodes?.[0], boardName: "", roomName: "" };
}

// Nazwa pokoju z availability przychodzi WIELKIMI LITERAMI ("DOUBLE SEA VIEW
// WITH BALCONY 2 ADULTS"). Zamieniamy na czytelną formę i usuwamy końcówkę
// „2 Adults" (skład i tak pokazujemy osobno).
function prettyRoom(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s*\b\d+\s+Adults?\b.*$/i, "")
    .trim();
}

// Zamiana EUR->PLN po kursie NBP (patrz src/fx.js). Kurs jest odświeżany w tle,
// tutaj tylko odczytujemy aktualną wartość — przeliczanie nie może czekać na sieć.

function normalize(h, c, rate, pax) {
  const images = (c.images || [])
    .sort((a, b) => (a.visualOrder || 99) - (b.visualOrder || 99))
    .map((im) => PHOTO_CDN + im.path);

  const stars = mapStars(c.categoryCode || h.categoryCode);
  const board = mapBoard(rate.boardCode, rate.boardName);
  const region = [c.destinationName?.content, c.city?.content].filter(Boolean).join(", ");
  const facilities = c.facilities || [];
  const beach = beachDistance(facilities);
  const yearBuilt = numByCode(facilities, 10, 20);   // rok budowy
  const yearRenov = numByCode(facilities, 10, 30);   // rok ostatniej renowacji
  const adultsOnly = hasFacility(facilities, 85, 203); // Only Adults
  const ski = distByCode(facilities, 160);           // 40/160 = odległość od stoku (m)
  // „Nowy/odnowiony" = zbudowany LUB odnowiony w ciągu ostatnich 3 lat.
  const freshYear = Math.max(yearBuilt || 0, yearRenov || 0) || null;
  const newHotel = freshYear ? new Date().getFullYear() - freshYear <= 3 : false;

  // rate.net to cena za CAŁY pobyt/pokój (w EUR). Przeliczamy na zł/os.
  const pricePerPerson = Math.round(eurToPln(rate.net) / Math.max(1, pax));

  return {
    id: `hb-${h.code}`,
    source: "Hotelbeds",
    name: h.name || c.name?.content || `Hotel ${h.code}`,
    country: countryFromContent(c) || h.destinationName || "",
    region: region || h.zoneName || h.destinationName || "",
    stars,
    // UWAGA: oceny gości (rating/reviews) NIE są w podstawowym Content API.
    // Wymagają dodatku recenzji (np. TripAdvisor przez Hotelbeds) lub innego źródła.
    // Do czasu podpięcia recenzji szacujemy ocenę z kategorii — patrz README.
    rating: Math.min(9.5, 6 + stars * 0.6),
    reviews: 0,          // 0 => wskaźnik wiarygodności pokaże "brak opinii"
    freshDays: null,
    price: pricePerPerson,
    board,
    cap: stars >= 4 ? 4 : 3,
    tags: deriveTags(facilities, board),
    beach,                            // realny dystans do plaży (m) lub null
    roomType: prettyRoom(rate.roomName), // typ pokoju z availability
    airport: sane(distByCode(facilities, 80), 500), // lotnisko (m); <500 m = błędne dane sandboxa → null
    centre: distByCode(facilities, 10),  // dystans do centrum (m) — do szczegółów
    yearBuilt,                        // rok budowy (10/20) lub null
    yearRenov,                        // rok ostatniej renowacji (10/30) lub null
    newHotel,                         // zbudowany/odnowiony ≤3 lata
    adultsOnly,                       // tylko dla dorosłych (85/203)
    ski,                              // odległość od stoku (m, 40/160) lub null
    photo: images[0] || "linear-gradient(135deg,#0F6B68,#3FB0AB)",
    photos: images.slice(0, 8),
  };
}

function countryFromContent(c) {
  // Content API zwraca kod kraju; mapowanie podstawowych rynków.
  const map = { GR: "Grecja", ES: "Hiszpania", EG: "Egipt", TR: "Turcja", IT: "Włochy", TN: "Tunezja", PT: "Portugalia" };
  return map[c.countryCode] || c.countryCode || "";
}

// Content API zwraca dystanse jako KODY (nie opis tekstowy). Grupa 40 = dystanse:
//   40/40 = Beach, 40/80 = Airport, 40/10 = City centre, 40/70 = Harbour.
// Zweryfikowane na sandboxie przez /types/facilities. Bierzemy dystans po kodzie,
// a gdy hotel go nie podaje → null (karta ukryje plakietkę zamiast zmyślać).
function distByCode(facilities, code) {
  const f = (facilities || []).find(
    (x) => x.facilityGroupCode === 40 && x.facilityCode === code && x.distance != null
  );
  return f ? Number(f.distance) : null;
}

function beachDistance(facilities) {
  return distByCode(facilities, 40); // 40/40 = Beach (metry); null gdy brak danych
}

// Wartość liczbowa facility po kodzie (np. rok budowy/renowacji trzyma pole
// `number`). Grupa 10 = dane obiektu: 10/20 = rok budowy, 10/30 = rok renowacji.
function numByCode(facilities, group, code) {
  const f = (facilities || []).find(
    (x) => x.facilityGroupCode === group && x.facilityCode === code && x.number != null
  );
  return f ? Number(f.number) : null;
}

// Czy hotel ma dany facility (flaga bez wartości), np. 85/203 = Only Adults.
function hasFacility(facilities, group, code) {
  return (facilities || []).some(
    (x) => x.facilityGroupCode === group && x.facilityCode === code
  );
}

// Odrzuca ewidentnie błędne dystanse (sandbox potrafi zwrócić 0/kilka metrów
// do lotniska). Zwraca null, gdy wartość poniżej progu min lub brak.
function sane(v, min) {
  return typeof v === "number" && v >= min ? v : null;
}

function deriveTags(facilities, board) {
  const tags = [];
  const txt = facilities.map((f) => (f.description?.content || "").toLowerCase()).join(" ");
  if (/spa|wellness|massage/.test(txt)) tags.push("spa");
  if (/family|kids|children/.test(txt)) tags.push("rodzina");
  if (/beach/.test(txt)) tags.push("plaza");
  if (/disco|club|nightlife/.test(txt)) tags.push("impreza");
  if (/adults only|romantic/.test(txt)) tags.push("para");
  if (!tags.length) tags.push("plaza");
  return tags;
}
