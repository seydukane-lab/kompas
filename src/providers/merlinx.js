// ============================================================
//  Provider: MERLINX  (pakiety czarterowe z polskiego rynku)
//  System agencyjny eTravel — agreguje oferty touroperatorów
//  (TUI, Itaka, Coral Travel, Rainbow, Grecos…): lot + hotel + transfer.
//
//  To ŹRÓDŁO DOCELOWE dla „ofert jak z wakacje.pl".
//
//  STATUS: SZKIELET. Włącza się dopiero, gdy w .env są dane
//  agencyjne ORAZ potwierdzony endpoint. Dopóki ich nie ma,
//  isEnabled() = false i provider jest pomijany (jak Hotelbeds bez kluczy).
//
//  DO UZUPEŁNIENIA z oficjalnej dokumentacji MerlinX (patrz TODO):
//    1) dokładny URL i wersja interfejsu (XML/SOAP vs REST),
//    2) format uwierzytelniania (login agencyjny / system id / token),
//    3) schemat zapytania wyszukiwania i parsowanie odpowiedzi.
//  Reszta (kształt oferty, mapowanie, ranking) jest już gotowa.
// ============================================================

import { fetchWithTimeout } from "../http.js";
import { eurToPln } from "../fx.js";

const URL = process.env.MERLINX_URL || "";
const LOGIN = process.env.MERLINX_LOGIN || "";
const PASSWORD = process.env.MERLINX_PASSWORD || "";
const SYSTEM = process.env.MERLINX_SYSTEM || ""; // id systemu / agencji, jeśli wymagane

export const meta = { id: "merlinx", label: "MerlinX", needsKeys: true };

// Bezpieczna bramka: uruchamia się TYLKO z kompletem danych agencyjnych
// i jawnie podanym endpointem — nigdy przez przypadek.
export function isEnabled() {
  return Boolean(URL && LOGIN && PASSWORD);
}

// Kurort/miasto -> miasto wylotu itd. mapujemy z odpowiedzi MerlinX (ma te pola).

// ----------------------------------------------------------------
//  Główna funkcja providera — kontrakt jak u pozostałych źródeł.
// ----------------------------------------------------------------
export async function search(crit) {
  const payload = buildRequest(crit);

  // TODO(docs): potwierdzić metodę (POST/GET), nagłówki i Content-Type
  // (XML/SOAP: text/xml + SOAPAction; REST: application/json).
  const res = await fetchWithTimeout(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = new Error(`merlinx HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const raw = await res.json(); // TODO(docs): jeśli XML — sparsować przez parser XML
  const offers = parseResponse(raw);
  return offers.map(normalize).filter(Boolean);
}

// --- Uwierzytelnianie ---
// TODO(docs): MerlinX bywa uwierzytelniany loginem/hasłem w ciele zapytania,
// nagłówkiem Basic albo tokenem sesji. Dostosować po otrzymaniu dokumentacji.
function authHeaders() {
  const basic = Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64");
  return { Authorization: `Basic ${basic}`, ...(SYSTEM ? { "X-System": SYSTEM } : {}) };
}

// --- Budowa zapytania wyszukiwania z naszych kryteriów ---
// TODO(docs): zmapować nazwy pól na schemat MerlinX (kody krajów/regionów,
// lotnisk wylotu, zakres dat, obłożenie pokoju, typ wyżywienia).
function buildRequest(crit) {
  return {
    country: crit.dest || undefined,
    regions: crit.regions && crit.regions.length ? crit.regions : undefined,
    departureCity: crit.departureCity || undefined,
    dateFrom: crit.from || undefined,
    dateTo: crit.to || undefined,
    adults: crit.adults || 2,
    children: crit.kids || 0,
    nights: crit.nights || undefined,
    boards: crit.boards && crit.boards.length ? crit.boards : undefined,
    priceMax: crit.budget || undefined,
  };
}

// --- Wydobycie listy ofert z odpowiedzi (kształt zależny od API) ---
// TODO(docs): wskazać właściwą ścieżkę do tablicy ofert w odpowiedzi.
function parseResponse(raw) {
  if (!raw) return [];
  return raw.offers || raw.results || raw.tours || [];
}

// --- Mapowanie oferty MerlinX -> nasz znormalizowany kształt (pakiet) ---
// GOTOWE: dostosuj tylko nazwy pól źródłowych (o) do faktycznej odpowiedzi.
export function normalize(o) {
  if (!o) return null;
  const priceRaw = Number(o.price ?? o.priceTotal ?? 0);
  const currency = o.currency || "PLN";
  // Waluta inna niż PLN idzie przez ŻYWY kurs NBP (fx.js), nie przez stałą w kodzie.
  // Do 02.09.2026 siedziało tu `priceRaw * 4.3` — kurs wpisany ręcznie, który starzeje
  // się po cichu i nigdy nie krzyknie. Ta sama mina była w hotelbeds.js i została
  // rozbrojona 24.08; tutaj przetrwała, bo bez kluczy MerlinX ta gałąź się nie wykonuje.
  // Konsultant podaje klientowi kwotę policzoną tym przelicznikiem, więc kurs z kodu
  // znaczy cenę cicho rozjeżdżającą się z rzeczywistością.
  const pricePerPerson = Math.round(currency === "PLN" ? priceRaw : eurToPln(priceRaw));

  return {
    id: `mx-${o.id || o.offerId || o.code}`,
    source: o.operator || o.tourOperator || "MerlinX",
    type: "package",
    name: o.hotelName || o.name || "",
    country: o.country || "",
    region: o.region || o.resort || o.city || "",
    // Brak kategorii to BRAK DANYCH, nie „trzy gwiazdki" — jak mapStars() w hotelbeds.js.
    stars: Number(o.stars || o.category) || undefined,
    // Oceny gości: MerlinX zwykle nie dostarcza wiarygodnych recenzji —
    // reviews:0 sprawia, że wskaźnik wiarygodności pokaże „brak opinii"
    // (spójne z Hotelbeds; recenzje dopinamy osobnym źródłem — patrz README).
    // Ocena szacowana z kategorii wyłącznie wtedy, gdy kategorię znamy — inaczej
    // zgadnięte 3★ rodziły „ocenę" 7,8, której nikt nigdy nie wystawił.
    rating: Number(o.rating || 0) || (Number(o.stars || o.category) ? Math.min(9.5, 6 + Number(o.stars || o.category) * 0.6) : 0),
    reviews: Number(o.reviewsCount || 0),
    freshDays: o.reviewsFreshDays ?? null,
    price: pricePerPerson,
    board: mapBoard(o.board || o.boardCode),
    // Pojemność zgadywana z gwiazdek to liczba, po której konsultant sadza realną
    // rodzinę — gdy jej nie znamy, mówimy o tym wprost (capUnknown ukrywa plakietkę).
    cap: Number(o.maxPax || o.roomCapacity) || 4,
    capUnknown: !Number(o.maxPax || o.roomCapacity),
    tags: Array.isArray(o.tags) ? o.tags : [],
    // Domyślne 300 m trafiało na kartę jako „🏖 plaża 300 m" i zasilało filtr
    // „przy plaży" — twierdzenie o hotelu, którego nikt nie sprawdził.
    beach: Number(o.beachDistance) || null,
    operator: o.operator || o.tourOperator || "",
    departureCity: o.departureCity || o.departureAirport || "",
    transport: o.transport || "Samolot",
    // „Transfer w cenie" tylko na potwierdzenie z feedu. Zapis `!== false` sprawiał,
    // że BRAK informacji stawał się obietnicą usługi, za którą klient płaci osobno.
    transferIncluded: o.transferIncluded === true || undefined,
    // Długość pobytu: patrz komentarz w travellead.js — zmyślone 7 nocy odsiewało
    // oferty o nieznanej długości przy filtrze innym niż 6–8 nocy.
    nights: Number(o.nights || o.duration) || undefined,
    departDate: o.departureDate || o.dateFrom || "",
    photo: o.image || o.photo || "linear-gradient(135deg,#0F6B68,#3FB0AB)",
    photos: Array.isArray(o.images) ? o.images.slice(0, 8) : [],
  };
}

function mapBoard(code) {
  const c = String(code || "").toUpperCase();
  if (/UAI|ULTRA/.test(c)) return "Ultra All Inclusive";
  if (/AI|ALL/.test(c)) return "All Inclusive";
  if (/HB|FB/.test(c)) return "HB";
  if (/BB/.test(c)) return "BB";
  // Nieznany kod wyżywienia zostaje nieznany — „BB" byłoby obietnicą śniadań,
  // których nikt nie potwierdził (ta sama zasada co mapBoard w hotelbeds.js).
  return code || undefined;
}
