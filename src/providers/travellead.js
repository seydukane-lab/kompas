// ============================================================
//  Provider: TRAVELLEAD.PL  (program afiliacyjny Wakacje.pl)
//  Feed produktowy XML z ofertami pakietowymi (lot+hotel+transfer)
//  + deep-linki afiliacyjne do rezerwacji na Wakacje.pl.
//
//  Włącza się TYLKO gdy w .env jest TRAVELLEAD_FEED_URL
//  (dostępny w panelu wydawcy po akceptacji konta).
//
//  Mapowanie pól jest TOLERANCYJNE (obsługuje typowe nazwy PL/EN);
//  po otrzymaniu próbki prawdziwego feedu doprecyzować pick()-i
//  w normalize() — reszta (cache, parser, kształt) jest gotowa.
// ============================================================

import { XMLParser } from "fast-xml-parser";

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
  const res = await fetch(FEED_URL, { headers: { Accept: "application/xml,text/xml" } });
  if (!res.ok) throw new Error(`travellead feed HTTP ${res.status}`);
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

function normalize(o) {
  const name = pick(o, "hotelName", "hotel", "nazwa", "name", "title");
  const priceRaw = Number(pick(o, "price", "cena", "priceTotal", "pricePerPerson")) || 0;
  if (!name || !priceRaw) return null; // bez nazwy/ceny oferta jest bezużyteczna

  const countryRaw = String(pick(o, "country", "kraj", "destinationCountry") || "");
  const country = COUNTRY_PL[countryRaw.toLowerCase()] || countryRaw;
  const stars = Number(String(pick(o, "stars", "category", "kategoria", "gwiazdki") || "3").replace(/\D/g, "")) || 3;
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
    rating: rating || Math.min(9.5, 6 + stars * 0.6),
    reviews: Number(pick(o, "reviews", "reviewsCount", "opinie")) || 0,
    freshDays: null,
    price: Math.round(priceRaw),
    board: mapBoard(pick(o, "board", "wyzywienie", "boardType", "maintenance")),
    cap: Number(pick(o, "maxPax", "maxPersons")) || (stars >= 4 ? 4 : 3),
    tags: [],
    beach: Number(pick(o, "beachDistance", "odlegloscOdPlazy")) || 300,
    operator: String(pick(o, "operator", "tourOperator", "organizator") || "Wakacje.pl"),
    departureCity: String(pick(o, "departureCity", "departure", "wylotZ", "airport") || ""),
    transport: mapTransport(pick(o, "transport", "transportType", "dojazd")),
    transferIncluded: true,
    nights: Number(pick(o, "nights", "duration", "liczbaNocy", "days")) || 7,
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
  return v ? String(v) : "BB";
}

function mapTransport(v) {
  const s = String(v || "").toLowerCase();
  if (/bus|autokar/.test(s)) return "Autokar";
  if (/own|własny|wlasny|dojazd/.test(s)) return "Własny dojazd";
  return "Samolot";
}
