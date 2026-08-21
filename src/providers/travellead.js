// ============================================================
//  Provider: TRAVELLEAD.PL  (program afiliacyjny Wakacje.pl)
//  Feed produktowy XML z ofertami pakietowymi (lot+hotel+transfer)
//  + deep-linki afiliacyjne do rezerwacji na Wakacje.pl.
//
//  ⚠️ STATUS 2026-07-28: zgłoszenie do programu ODRZUCONE. Powód z ich maila:
//  nie współpracują z serwisami będącymi „jedynie agregatami ofert", bo to
//  rozwiązanie tożsame z ich własnym. Feedu nie ma i w tym modelu nie będzie.
//  Kod zostaje nietknięty — nic nie kosztuje, bo bez klucza się nie włącza,
//  a decyzja może się zmienić przy innym ułożeniu współpracy (narzędzie dla
//  konsultantów zamiast publicznego agregatu). NIE zakładać, że to działa.
//
//  Włącza się TYLKO gdy w .env jest TRAVELLEAD_FEED_URL
//  (dostępny w panelu wydawcy po akceptacji konta).
//
//  Mapowanie pól jest TOLERANCYJNE (obsługuje typowe nazwy PL/EN);
//  po otrzymaniu próbki prawdziwego feedu doprecyzować pick()-i
//  w normalize() — reszta (cache, parser, kształt) jest gotowa.
// ============================================================

import { XMLParser } from "fast-xml-parser";
import { fetchWithTimeout } from "../http.js";

const FEED_URL = process.env.TRAVELLEAD_FEED_URL || "";
const PARTNER_ID = process.env.TRAVELLEAD_PARTNER_ID || "";

export const meta = { id: "travellead", label: "Wakacje.pl (TravelLead)", needsKeys: true };

export function isEnabled() {
  return Boolean(FEED_URL);
}

// --- Cache feedu w pamięci: feed to duży, statyczny plik — nie ma sensu
//     pobierać go przy każdym wyszukiwaniu. Odświeżamy co 30 minut.
const CACHE_TTL_MS = 30 * 60 * 1000;
let cache = { at: 0, offers: [] };

export async function search(crit) {
  if (Date.now() - cache.at > CACHE_TTL_MS) {
    cache = { at: Date.now(), offers: await fetchFeed() };
  }
  // Filtrowanie/ranking robi warstwa wspólna — zwracamy całość.
  return cache.offers;
}

async function fetchFeed() {
  const res = await fetchWithTimeout(FEED_URL, { headers: { Accept: "application/xml,text/xml" } });
  if (!res.ok) {
    const err = new Error(`travellead feed HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const xml = await res.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: true,
  });
  const doc = parser.parse(xml);

  const items = findOfferArray(doc);
  return items.map(normalize).filter(Boolean);
}

// Szuka pierwszej sensownej tablicy ofert w sparsowanym XML,
// niezależnie od nazwy kontenera (offers/offer, oferty/oferta, products/product…).
function findOfferArray(node, depth = 0) {
  if (depth > 4 || !node || typeof node !== "object") return [];
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v) && v.length && typeof v[0] === "object") return v;
    if (v && typeof v === "object") {
      const found = findOfferArray(v, depth + 1);
      if (found.length) return found;
    }
  }
  return [];
}

// Zwraca pierwszą niepustą wartość spośród kandydujących nazw pól.
function pick(o, ...keys) {
  for (const k of keys) {
    if (o[k] != null && o[k] !== "") return o[k];
  }
  return undefined;
}

// Dokleja identyfikator partnera do linku oferty (prowizja).
// TODO(feed): dostosować nazwę parametru do dokumentacji panelu wydawcy.
function affiliateUrl(url) {
  if (!url) return "";
  if (!PARTNER_ID) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}partnerId=${encodeURIComponent(PARTNER_ID)}`;
}

const COUNTRY_PL = {
  egipt: "Egipt", turcja: "Turcja", grecja: "Grecja", hiszpania: "Hiszpania",
  wlochy: "Włochy", włochy: "Włochy", tunezja: "Tunezja", portugalia: "Portugalia",
  bulgaria: "Bułgaria", bułgaria: "Bułgaria", albania: "Albania", cypr: "Cypr",
};

export function normalize(o) {
  const name = pick(o, "hotelName", "hotel", "nazwa", "name", "title");
  const priceRaw = Number(pick(o, "price", "cena", "priceTotal", "pricePerPerson")) || 0;
  if (!name || !priceRaw) return null; // bez nazwy/ceny oferta jest bezużyteczna

  const countryRaw = String(pick(o, "country", "kraj", "destinationCountry") || "");
  const country = COUNTRY_PL[countryRaw.toLowerCase()] || countryRaw;
  // Brak kategorii to BRAK DANYCH, nie „trzy gwiazdki" — ta sama zasada co w
  // mapStars() z hotelbeds.js. Domyślne 3★ trafiały wprost na kartę i do filtra
  // kategorii jako fakt o hotelu, którego nikt nie potwierdził.
  const starsRaw = Number(String(pick(o, "stars", "category", "kategoria", "gwiazdki") || "").replace(/\D/g, ""));
  const stars = starsRaw >= 1 && starsRaw <= 5 ? starsRaw : undefined;
  const rating = Number(pick(o, "rating", "ocena", "opinion")) || 0;
  const photo = pick(o, "photo", "image", "zdjecie", "imageUrl", "photoUrl") || "";

  return {
    id: `tl-${pick(o, "id", "offerId", "code") || name.replace(/\W/g, "").slice(0, 24)}`,
    source: pick(o, "operator", "tourOperator", "organizator") || "Wakacje.pl",
    type: "package",
    name: String(name),
    country,
    region: String(pick(o, "region", "resort", "city", "miasto", "destination") || ""),
    stars,
    // Ocena szacowana z kategorii tylko wtedy, gdy kategorię ZNAMY. Przy reviews:0
    // panel i tak opisze to jako „brak danych o opiniach" (patrz ranking.js:trustLabel).
    rating: rating || (stars ? Math.min(9.5, 6 + stars * 0.6) : 0),
    reviews: Number(pick(o, "reviews", "reviewsCount", "opinie")) || 0,
    freshDays: null,
    price: Math.round(priceRaw),
    board: mapBoard(pick(o, "board", "wyzywienie", "boardType", "maintenance")),
    // Pojemność: gdy feed jej nie podaje, mówimy o tym wprost (capUnknown), zamiast
    // zgadywać z gwiazdek — konsultant sadza po tej liczbie realną rodzinę.
    cap: Number(pick(o, "maxPax", "maxPersons")) || Math.max(2, Number(pick(o, "adults")) || 4),
    capUnknown: !Number(pick(o, "maxPax", "maxPersons")),
    tags: [],
    // Odległość od plaży: BRAK danych zostaje brakiem. Domyślne 300 m pokazywało się
    // na karcie jako „🏖 plaża 300 m" — liczba wzięta z powietrza, którą konsultant
    // powtarzał klientowi i na której podstawie działał filtr „przy plaży".
    beach: Number(pick(o, "beachDistance", "odlegloscOdPlazy")) || null,
    operator: String(pick(o, "operator", "tourOperator", "organizator") || "Wakacje.pl"),
    departureCity: String(pick(o, "departureCity", "departure", "wylotZ", "airport") || ""),
    transport: mapTransport(pick(o, "transport", "transportType", "dojazd")),
    // Transfer: „w cenie" tylko wtedy, gdy feed to potwierdza. Domyślne `true`
    // dokładało klientowi do oferty usługę, za którą realnie płaci osobno.
    transferIncluded: pick(o, "transferIncluded", "transfer") === true || undefined,
    // Długość pobytu: BRAK danych zostaje brakiem, tak jak plaża i transfer wyżej.
    // Domyślne 7 nocy trafiało na kartę i do wydruku dla klienta jako fakt, a przy
    // filtrze „długość pobytu" działało odwrotnie, niż się wydaje: oferta o NIEZNANEJ
    // długości cicho ODPADAŁA przy każdej wartości innej niż 6–8 nocy.
    nights: Number(pick(o, "nights", "duration", "liczbaNocy", "days")) || undefined,
    departDate: String(pick(o, "departureDate", "dateFrom", "dataWyjazdu", "termin") || ""),
    bookingUrl: affiliateUrl(String(pick(o, "url", "link", "deeplink", "offerUrl") || "")),
    photo: photo || "linear-gradient(135deg,#0F6B68,#3FB0AB)",
    photos: photo ? [photo] : [],
  };
}

function mapBoard(v) {
  const s = String(v || "").toLowerCase();
  if (/ultra/.test(s)) return "Ultra All Inclusive";
  if (/all/.test(s) || /\bai\b/.test(s)) return "All Inclusive";
  if (/hb|half|2 posiłki|obiadokolacj/.test(s)) return "HB";
  if (/bb|śniadani|sniadani|breakfast/.test(s)) return "BB";
  // Brak informacji o wyżywieniu NIE jest śniadaniem — ta sama zasada co w
  // mapBoard() z hotelbeds.js (3d5cc3f). Panel pokaże wtedy „brak danych",
  // a filtr wyżywienia takiej oferty nie odsieje.
  return v ? String(v) : undefined;
}

function mapTransport(v) {
  const s = String(v || "").toLowerCase();
  if (/bus|autokar/.test(s)) return "Autokar";
  if (/own|własny|wlasny|dojazd/.test(s)) return "Własny dojazd";
  return "Samolot";
}
