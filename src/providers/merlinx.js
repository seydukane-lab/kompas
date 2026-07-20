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
const EUR_PLN = 4.3; // MerlinX zwraca zwykle PLN; przelicznik na wypadek innej waluty.

// ----------------------------------------------------------------
//  Główna funkcja providera — kontrakt jak u pozostałych źródeł.
// ----------------------------------------------------------------
export async function search(crit) {
  const payload = buildRequest(crit);

  // TODO(docs): potwierdzić metodę (POST/GET), nagłówki i Content-Type
  // (XML/SOAP: text/xml + SOAPAction; REST: application/json).
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`merlinx HTTP ${res.status}`);

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
function normalize(o) {
  if (!o) return null;
  const priceRaw = Number(o.price ?? o.priceTotal ?? 0);
  const currency = o.currency || "PLN";
  const pricePerPerson = Math.round(currency === "PLN" ? priceRaw : priceRaw * EUR_PLN);

  return {
    id: `mx-${o.id || o.offerId || o.code}`,
    source: o.operator || o.tourOperator || "MerlinX",
    type: "package",
    name: o.hotelName || o.name || "",
    country: o.country || "",
    region: o.region || o.resort || o.city || "",
    stars: Number(o.stars || o.category || 3),
    // Oceny gości: MerlinX zwykle nie dostarcza wiarygodnych recenzji —
    // reviews:0 sprawia, że wskaźnik wiarygodności pokaże „brak opinii"
    // (spójne z Hotelbeds; recenzje dopinamy osobnym źródłem — patrz README).
    rating: Number(o.rating || 0) || Math.min(9.5, 6 + Number(o.stars || 3) * 0.6),
    reviews: Number(o.reviewsCount || 0),
    freshDays: o.reviewsFreshDays ?? null,
    price: pricePerPerson,
    board: mapBoard(o.board || o.boardCode),
    cap: Number(o.maxPax || o.roomCapacity || (Number(o.stars || 3) >= 4 ? 4 : 3)),
    tags: Array.isArray(o.tags) ? o.tags : [],
    beach: Number(o.beachDistance || 300),
    operator: o.operator || o.tourOperator || "",
    departureCity: o.departureCity || o.departureAirport || "",
    transport: o.transport || "Samolot",
    transferIncluded: o.transferIncluded !== false,
    nights: Number(o.nights || o.duration || 7),
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
  return code || "BB";
}
