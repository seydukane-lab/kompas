// ============================================================
//  Rejestr dostawców danych.
//  Dodanie nowego źródła = dopisanie jednego importu tutaj.
//  Każdy dostawca implementuje: meta, isEnabled(), search(crit).
// ============================================================

import * as mock from "./mock.js";
import * as hotelbeds from "./hotelbeds.js";
import * as merlinx from "./merlinx.js";
import * as travellead from "./travellead.js";
import * as plPackages from "./packages.js";
import { normalizeName } from "../ranking.js";
import { withDeadline } from "../http.js";

// Provider wakacje.js jest LOKALNY (gitignored) — na publicznym wdrożeniu (Render)
// tego pliku nie ma. Ładujemy go OPCJONALNIE, żeby build nie padał przy jego braku;
// bez pliku wakacje po prostu nie startuje (strona publiczna zostaje czysta).
let wakacje = null;
try {
  wakacje = await import("./wakacje.js");
} catch {
  /* brak lokalnego providera — produkcja/publiczne repo */
}

// Kolejność = priorytet przy scalaniu duplikatów (niżej = ważniejsze).
// wakacje (jeśli obecne) = realne oferty+oceny+link, więc na czele realnych źródeł.
const ALL = [wakacje, travellead, merlinx, hotelbeds, plPackages, mock].filter(Boolean);

export function activeProviders() {
  return ALL.filter((p) => p.isEnabled());
}

export function providerStatus() {
  return ALL.map((p) => ({
    id: p.meta.id,
    label: p.meta.label,
    needsKeys: p.meta.needsKeys,
    enabled: p.isEnabled(),
  }));
}

// Ile czasu wolno zająć JEDNEMU dostawcy. Hotelbeds robi kilka wywołań po
// kolei (dostępność + treści), więc limit jest wyższy niż na pojedynczy fetch.
const PROVIDER_DEADLINE_MS = Number(process.env.PROVIDER_TIMEOUT_MS) || 25000;

// ---------------------------------------------------------------
//  Krótki cache wyników wyszukiwania
//
//  Konsultanci w jednym biurze pytają o to samo: te same kierunki, te same
//  terminy, w kółko przez cały dzień. Bez cache'u każde takie pytanie to
//  ponowne odpytanie wszystkich dostawców — a wąskim gardłem potrafi być
//  jedno wolne źródło (zmierzone: 8–10 s przy 0,5 s reszty).
//
//  TTL jest krótki celowo: ceny i dostępność realnie się zmieniają, a
//  konsultant nie może podać klientowi ceny sprzed pół godziny.
// ---------------------------------------------------------------
const CACHE_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MS) || 180000; // 3 minuty
const CACHE_MAX = Number(process.env.SEARCH_CACHE_MAX) || 200;
const searchCache = new Map();

function cacheKey(crit) {
  // Stabilny klucz: te same kryteria w innej kolejności pól to ten sam wynik.
  return JSON.stringify(Object.keys(crit).sort().map((k) => [k, crit[k]]));
}

// Klucz jest PER DOSTAWCA, nie na całą odpowiedź. Powód zmierzony 17.08.2026 na
// lokalnym zestawie źródeł: cache całościowy zapisywał się tylko wtedy, gdy ŻADNE
// źródło nie padło — a Hotelbeds w sandboxie pada regularnie (403, wyczerpana pula).
// Efekt: cache nie działał ANI RAZU w 24 wyszukiwaniach z rzędu, więc konsultant
// czekał 15 s na każde pytanie, bo tyle zajmuje najwolniejsze źródło. Rozbicie na
// dostawców zachowuje sens starej reguły (padnięte źródło NIE jest zamrażane
// i próbujemy go ponownie), ale zdrowe źródła przestają płacić za cudzą awarię.
function providerCacheKey(id, crit) {
  return id + " " + cacheKey(crit);
}

function cacheGet(key) {
  const hit = cacheEntry(key);
  return hit ? hit.data : null;
}

// Wpis z czasem zapisu — panel ma prawo wiedzieć, jak stare są dane, zamiast
// dostawać je bez oznaczenia i pokazywać cenę sprzed kilku minut jako świeżą.
function cacheEntry(key) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  // Odświeżenie pozycji — najdawniej używane wypadają pierwsze.
  searchCache.delete(key);
  searchCache.set(key, hit);
  return hit;
}

function cacheSet(key, data) {
  searchCache.set(key, { at: Date.now(), data });
  while (searchCache.size > CACHE_MAX) {
    searchCache.delete(searchCache.keys().next().value);
  }
}

/** Czyści cache — przydatne w testach i po zmianie konfiguracji dostawców. */
export function clearSearchCache() {
  searchCache.clear();
}

// Krótki, czytelny dla konsultanta powód awarii źródła. Bez tego "dostawca
// nie odpowiedział" i "nic nie ma w tym terminie" wyglądają identycznie —
// a to dwie zupełnie różne wiadomości do przekazania klientowi.
function reasonFor(err) {
  const status = err?.status;
  if (status === 429) return "przekroczono limit zapytań (429) — spróbuj ponownie za chwilę";
  // 403 z Hotelbeds to praktycznie zawsze wyczerpana pula zapytań o DOSTĘPNOŚĆ, nie zły klucz —
  // zdiagnozowane 07.08.2026: przy trwającym 403 na availability endpoint /status i całe
  // Content API odpowiadały 200 OK. Komunikat nie może wysyłać nikogo na fałszywy trop klucza.
  if (status === 403) return "wyczerpana pula zapytań o dostępność (403) — klucz działa, pula odnawia się po stronie dostawcy";
  if (typeof status === "number" && status >= 500) return `błąd serwera dostawcy (${status})`;
  if (typeof status === "number") return `dostawca odpowiedział błędem HTTP ${status}`;
  if (/przekroczono limit \d+ ms/.test(err?.message || "")) return "przekroczono limit czasu odpowiedzi";
  return "dostawca nie odpowiedział";
}

// Odpytuje wszystkich aktywnych dostawców równolegle i scala oferty.
// Wolne źródło nie może opóźniać reszty: każdy dostawca ma własny limit czasu,
// a wynik składamy z tych, które zdążyły. Lepiej pokazać oferty z trzech źródeł
// niż kazać konsultantowi czekać na czwarte, które akurat leży.
//
// `providers` jest parametrem (domyślnie aktywni dostawcy) głównie dla testów —
// pozwala podstawić atrapę dostawcy, żeby sprawdzić rozróżnienie
// odpowiedziało/odpowiedziało zerem/padło bez prawdziwej sieci.
export async function searchAll(crit, providers = activeProviders()) {
  const wyniki = await Promise.all(providers.map(async (prov) => {
    const key = providerCacheKey(prov.meta.id, crit);
    const hit = cacheEntry(key);
    // Świeży wpis tego dostawcy: bierzemy go i NIE ruszamy sieci. Wiek podajemy
    // dalej, bo „z cache sprzed 12 s" i „właśnie odpytane" to dwie różne wiadomości.
    if (hit) return { prov, offers: hit.data, ok: true, ms: 0, cached: true, wiek: Math.round((Date.now() - hit.at) / 1000) };

    const t0 = Date.now();
    try {
      const lista = await withDeadline(prov.search(crit), PROVIDER_DEADLINE_MS, prov.meta.id);
      const ms = Date.now() - t0;
      // Dostawca, który zwrócił coś innego niż tablicę, jest pomijany tak jak dotąd:
      // nie mamy z tego ofert i nie umiemy uczciwie nazwać takiego stanu.
      if (!Array.isArray(lista)) return null;
      cacheSet(key, lista);
      return { prov, offers: lista, ok: true, ms };
    } catch (err) {
      console.warn(`[${prov.meta.id}] search error:`, err?.message || err);
      // Padnięte źródło NIE trafia do cache — następne pytanie ma je odpytać ponownie.
      return { prov, offers: [], ok: false, ms: Date.now() - t0, reason: reasonFor(err) };
    }
  }));

  const offers = [];
  const sources = [];
  for (const w of wyniki) {
    if (!w) continue;
    if (w.ok) {
      // Priorytet dostawcy = pozycja w ALL (niższa = ważniejsza). Przyda się przy scalaniu.
      const prio = ALL.indexOf(w.prov);
      offers.push(...w.offers.map((o) => ({ ...o, __prio: prio })));
    }
    // ok:true niezależnie od count — uczciwe zero (dostawca odpytany, nic nie ma)
    // to inna sytuacja niż padnięcie, choć obie dają count:0.
    const wpis = { id: w.prov.meta.id, label: w.prov.meta.label, count: w.offers.length, ok: w.ok, ms: w.ms };
    if (w.reason) wpis.reason = w.reason;
    if (w.cached) { wpis.cached = true; wpis.wiek = w.wiek; }
    sources.push(wpis);
  }

  // Czas każdego źródła w logu — bez tego nie da się powiedzieć, które
  // z nich spowalnia wyszukiwanie, a to jest pytanie, które wróci przy pilotażu.
  console.log("[search] " + sources.map((s) => `${s.id} ${s.cached ? "cache/" + s.wiek + "s" : s.ms + "ms"}/${s.count}`).join("  "));

  const result = { offers: dedupeOffers(offers), sources };
  // `cached` na całej odpowiedzi znaczy: NIC nie poszło do sieci. Gdy choć jedno
  // źródło było odpytywane na żywo, odpowiedź nie jest „z cache" i tak ją opisujemy.
  if (sources.length && sources.every((s) => s.cached)) result.cached = true;
  return result;
}

// ---------------------------------------------------------------
//  Scalanie duplikatów między źródłami.
//  Gdy ten sam hotel przyjdzie z kilku źródeł (np. feed z bazy + pakiety
//  demo + Hotelbeds), łączymy go w JEDNĄ ofertę zamiast pokazywać kilka razy.
//  Reprezentanta wybiera priorytet dostawcy (realne źródła > demo), a brakujące
//  mocne pola (realne oceny, zdjęcia, link do rezerwacji) dobieramy z pozostałych.
// ---------------------------------------------------------------

// Tożsamość hotelu: znormalizowana nazwa + kraj. Region bywa różnie zapisany
// między źródłami ("Hurghada" vs "Hurghada, Sahl Hasheed"), więc go do klucza
// nie bierzemy — różnice regionu rozstrzyga wybór reprezentanta.
function identityKey(o) {
  return normalizeName(o.name) + "|" + normalizeName(o.country);
}

// Realne zdjęcie (URL) vs gradient-placeholder (CSS).
function hasRealPhoto(o) {
  const p = o.photo || (o.photos && o.photos[0]) || "";
  return /^https?:/i.test(p);
}

export function dedupeOffers(list) {
  const groups = new Map();
  for (const o of list) {
    const key = identityKey(o);
    if (!key.replace(/[|]/g, "").trim()) {
      // Brak nazwy/kraju — nie ryzykujemy scalania, przepuszczamy jako unikat.
      groups.set(Symbol(), [o]);
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }

  const out = [];
  for (const grp of groups.values()) {
    if (grp.length === 1) {
      out.push(strip(attachVariants(grp[0], grp)));
      continue;
    }
    // Reprezentant: najwyższy priorytet dostawcy (najniższy __prio).
    grp.sort((a, b) => (a.__prio ?? 99) - (b.__prio ?? 99));
    const primary = { ...grp[0] };
    const rest = grp.slice(1);

    // Realne oceny (reviews > 0) biją oszacowane — kluczowe dla anty-przekoloryzacji.
    if (!(primary.reviews > 0)) {
      const withReviews = rest.find((o) => o.reviews > 0);
      if (withReviews) {
        primary.rating = withReviews.rating;
        primary.reviews = withReviews.reviews;
        primary.freshDays = withReviews.freshDays;
      }
    }
    // Realne zdjęcia, jeśli reprezentant ma tylko placeholder.
    if (!hasRealPhoto(primary)) {
      const withPhoto = rest.find(hasRealPhoto);
      if (withPhoto) {
        primary.photo = withPhoto.photo;
        primary.photos = withPhoto.photos;
      }
    }
    // Link do rezerwacji (afiliacja) — bierzemy pierwszy dostępny.
    if (!primary.bookingUrl) {
      const withUrl = rest.find((o) => o.bookingUrl);
      if (withUrl) primary.bookingUrl = withUrl.bookingUrl;
    }
    // Fakty o obiekcie z bogatszego źródła (Hotelbeds): odległość od plaży,
    // typ pokoju, dystanse. Reprezentant (np. wakacje) ich nie ma — a to
    // dokładnie dane, których szuka doradca i klient. Nie nadpisujemy tego,
    // co reprezentant już zna.
    if (typeof primary.beach !== "number") {
      const withBeach = rest.find((o) => typeof o.beach === "number");
      if (withBeach) primary.beach = withBeach.beach;
    }
    if (!primary.roomType) {
      const withRoom = rest.find((o) => o.roomType);
      if (withRoom) primary.roomType = withRoom.roomType;
    }
    for (const k of ["airport", "centre", "yearBuilt", "yearRenov", "ski"]) {
      if (typeof primary[k] !== "number") {
        const src = rest.find((o) => typeof o[k] === "number");
        if (src) primary[k] = src[k];
      }
    }
    for (const k of ["adultsOnly", "newHotel"]) {
      if (!primary[k]) {
        const src = rest.find((o) => o[k]);
        if (src) primary[k] = true;
      }
    }
    // Amenities (basen/spa/wifi/...): jeśli reprezentant w ogóle nie ma o nich
    // wiedzy (undefined), bierzemy je z innego źródła, które je ma. Reprezentanta
    // z JUŻ znaną tablicą (nawet pustą — to legalne "sprawdziliśmy, nic nie pasuje")
    // nie nadpisujemy, żeby nie zgubić jego własnej odpowiedzi.
    if (!Array.isArray(primary.amenities)) {
      const withAmenities = rest.find((o) => Array.isArray(o.amenities));
      if (withAmenities) {
        primary.amenities = withAmenities.amenities;
        // Razem z tablicą przejmujemy deklarację pokrycia dawcy (albo jej BRAK) —
        // inaczej lista udogodnień z ograniczonego źródła (demo) czytałaby się jako
        // pełna wiedza i cechy spoza jego zakresu znowu wyszłyby jako "nie ma".
        primary.amenityCoverage = withAmenities.amenityCoverage;
      }
    }
    // Ślad, że oferta łączy kilka źródeł (do ewentualnej plakietki na karcie).
    primary.mergedFrom = grp.map((o) => o.source).filter((s, i, a) => s && a.indexOf(s) === i);
    out.push(strip(attachVariants(primary, grp)));
  }
  return out;
}

// Warianty oferty = wszystkie terminy/wyloty tego samego hotelu, które inaczej
// zniknęłyby przy scalaniu. Zasila „widok hotelu" (klik → lista wylotów z osobnymi
// cenami). Unikalne po (data|wylot|cena), rosnąco po cenie.
function variantOf(o) {
  return {
    departDate: o.departDate || "",
    nights: o.nights || 0,
    price: o.price,
    // Brak sumy zostaje BRAKIEM (undefined), nie zerem: „0 zł za grupę" to nieprawda,
    // a każdy odbiorca musiałby pamiętać, żeby to zero odsiać. Razem z sumą idzie
    // deklaracja, dla ilu osób jest liczona — bez niej wariant kłamie przy składzie
    // innym niż para (patrz ranking.js:offerGroupTotal).
    priceTotal: typeof o.priceTotal === "number" && o.priceTotal > 0 ? o.priceTotal : undefined,
    priceTotalPax: o.priceTotalPax,
    board: o.board || "",
    departureCity: o.departureCity || "",
    transport: o.transport || "",
    operator: o.operator || o.source || "",
    bookingUrl: o.bookingUrl || "",
    offerNumber: o.offerNumber || "",
    // Szczegóły przelotu i warunków — to są cechy WARIANTU, nie hotelu: ten sam
    // obiekt u innego operatora leci z innego lotniska, inną linią i bywa bez
    // transferu. Bez tych pól konsultant musiałby i tak wracać do systemu
    // operatora, czyli Kompas dokładałby krok zamiast go usuwać.
    // Konsekwentnie `undefined`, nie "" ani 0 — brak danych ma zostać brakiem
    // danych (np. wolne miejsca na powrót bywają nieznane).
    days: o.days,
    returnDate: o.returnDate,
    departureCode: o.departureCode,
    arrivalCode: o.arrivalCode,
    carrier: o.carrier,
    flightNo: o.flightNo,
    returnFlightNo: o.returnFlightNo,
    outboundDep: o.outboundDep,
    outboundArr: o.outboundArr,
    returnDep: o.returnDep,
    returnArr: o.returnArr,
    handLuggage: o.handLuggage,
    seatsLeft: o.seatsLeft,
    directFlight: o.directFlight,
    transferIncluded: o.transferIncluded,
    roomOptions: o.roomOptions,
    offerAttributes: o.offerAttributes,
    priceHistory: o.priceHistory,
    optionalUntil: o.optionalUntil,
  };
}
function attachVariants(primary, grp) {
  const seen = new Set();
  const vars = [];
  for (const o of grp) {
    const v = variantOf(o);
    const k = v.departDate + "|" + v.departureCity + "|" + v.price;
    if (!seen.has(k)) { seen.add(k); vars.push(v); }
  }
  vars.sort((a, b) => a.price - b.price);
  primary.variants = vars;
  return primary;
}

function strip(o) {
  const { __prio, ...rest } = o;
  return rest;
}
