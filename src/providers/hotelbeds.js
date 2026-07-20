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

  const results = [];
  for (const dest of targets) {
    try {
      const avail = await availability({ dest, from, to, adults, children });
      // Bierzemy górę listy — sandbox potrafi zwrócić setki hoteli.
      const hotels = (avail?.hotels?.hotels || []).slice(0, 40);
      if (!hotels.length) continue;

      // Wzbogacenie o treści statyczne (nazwa, zdjęcia, gwiazdki, plaża).
      const codes = hotels.map((h) => h.code);
      const content = await fetchContent(codes);

      for (const h of hotels) {
        const c = content[h.code] || {};
        const cheapest = cheapestRate(h);
        results.push(normalize(h, c, cheapest, pax));
      }
    } catch (err) {
      console.warn(`[hotelbeds] błąd dla destynacji ${dest}:`, err.message);
    }
  }
  return results;
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
  const res = await fetch(`${BASE}/hotel-api/1.0/hotels`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`availability HTTP ${res.status}`);
  return res.json();
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
  const res = await fetch(
    `${BASE}/hotel-content-api/1.0/hotels?${params.toString()}`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`content HTTP ${res.status}`);
  const data = await res.json();
  const map = {};
  for (const h of data.hotels || []) map[h.code] = h;
  return map;
}

function cheapestRate(h) {
  let best = null;
  for (const room of h.rooms || []) {
    for (const rate of room.rates || []) {
      const net = Number(rate.net);
      if (!best || net < best.net) best = { net, boardCode: rate.boardCode, boardName: rate.boardName };
    }
  }
  return best || { net: Number(h.minRate) || 0, boardCode: h.boardCodes?.[0], boardName: "" };
}

// Zamiana EUR->PLN (orientacyjnie). W produkcji: kurs z API NBP lub ustawiany w panelu.
const EUR_PLN = 4.3;

function normalize(h, c, rate, pax) {
  const images = (c.images || [])
    .sort((a, b) => (a.visualOrder || 99) - (b.visualOrder || 99))
    .map((im) => PHOTO_CDN + im.path);

  const stars = mapStars(c.categoryCode || h.categoryCode);
  const board = mapBoard(rate.boardCode, rate.boardName);
  const region = [c.destinationName?.content, c.city?.content].filter(Boolean).join(", ");
  const facilities = c.facilities || [];
  const beach = beachDistance(facilities);

  // rate.net to cena za CAŁY pobyt/pokój (w EUR). Przeliczamy na zł/os.
  const pricePerPerson = Math.round((rate.net * EUR_PLN) / Math.max(1, pax));

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
    beach,
    photo: images[0] || "linear-gradient(135deg,#0F6B68,#3FB0AB)",
    photos: images.slice(0, 8),
  };
}

function countryFromContent(c) {
  // Content API zwraca kod kraju; mapowanie podstawowych rynków.
  const map = { GR: "Grecja", ES: "Hiszpania", EG: "Egipt", TR: "Turcja", IT: "Włochy", TN: "Tunezja", PT: "Portugalia" };
  return map[c.countryCode] || c.countryCode || "";
}

function beachDistance(facilities) {
  const beachFac = facilities.find((f) => /beach/i.test(f.description?.content || ""));
  if (beachFac && beachFac.distance) return Number(beachFac.distance);
  return 300;
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
