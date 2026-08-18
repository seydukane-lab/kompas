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

// Kod wyżywienia Hotelbeds -> nasza etykieta.
//
// Tablica wyprowadzona z OFICJALNEGO słownika dostawcy
// (GET /hotel-content-api/1.0/types/boards — 54 kody, pobrane 11.08.2026),
// a nie z domysłów. Mapujemy WYŁĄCZNIE kody, których opis jest jednoznaczny.
//
// Dlaczego to jest ważniejsze niż wygląda — zmierzone 11.08.2026 na 13 196
// realnych stawkach (Majorka, Barcelona, Malaga): stary kod kończył się
// `return "BB"`, więc 34,7% stawek dostawało wymyślone „Śniadania". W tym
// 3418 stawek `RO` (ROOM ONLY — wyżywienia NIE MA) i 743 `SC` (SELF CATERING).
// Konsultant sprzedawał klientowi śniadania, których w rezerwacji nie było —
// a wyżywienie to element umowy, nie kosmetyka. Błąd działał też w drugą
// stronę: `AS` (All Inclusive Premium) i `MB` (HB z napojami) schodziły do „BB",
// czyli zaniżały ofertę, którą konsultant miał do sprzedania.
//
// Kody NIEjednoznaczne (np. CE „DINNER INCLUDED", CO „LUNCH INCLUDED" — jeden
// posiłek, który nie jest ani HB, ani BB) celowo NIE są mapowane: zwracamy
// `undefined`, czyli „nie wiemy", zamiast zgadywać. Tak samo każdy kod, który
// dostawca doda po tej dacie.
const BOARD_MAP = {
  // Bez wyżywienia
  RO: "Bez wyżywienia", SC: "Bez wyżywienia", DR: "Bez wyżywienia",
  // Śniadanie w dowolnej postaci
  BB: "BB", AB: "BB", CB: "BB", DB: "BB", GB: "BB", IB: "BB", KO: "BB",
  LB: "BB", SB: "BB", B1: "BB", B2: "BB", DA: "BB", DV: "BB", QB: "BB",
  // Dwa posiłki
  HB: "HB", MB: "HB", DC: "HB", DE: "HB", DI: "HB", DS: "HB",
  HL: "HB", HR: "HB", HS: "HB",
  // Pełne wyżywienie
  FB: "FB", PB: "FB", DF: "FB", DG: "FB", DH: "FB", DJ: "FB",
  FE: "FB", FL: "FB", FR: "FB", FS: "FB",
  // All inclusive
  AI: "All Inclusive", TL: "All Inclusive", AS: "Ultra All Inclusive",
};

export function mapBoard(code, name) {
  const c = (code || "").toUpperCase();
  // Nazwa stawki bywa dokładniejsza niż kod (dostawcy opisują „Ultra All
  // Inclusive" tekstem, mając w kodzie zwykłe AI) — ale tylko doprecyzowuje
  // to, co kod już potwierdza. Sama nazwa bez znanego kodu nie wystarcza.
  if (/ultra/i.test(name || "") && (c === "AI" || c === "AS" || c === "TL")) {
    return "Ultra All Inclusive";
  }
  const etykieta = BOARD_MAP[c];
  if (etykieta) return etykieta;
  // Nieznany kod = BRAK DANYCH. Nigdy nie zgadujemy wyżywienia:
  // filtr i karta oferty muszą to rozróżnić od potwierdzonego „BB".
  return undefined;
}

// Kategoria Hotelbeds (np. "4EST", "5EST") -> liczba gwiazdek.
// Zmierzone 11.08.2026 na 582 hotelach: 32 z nich (5,5%) mają kategorię bez
// żadnej cyfry — SUP, HS, SPC, AG, BOU, ALBER. Stary kod dawał im po cichu
// 3 gwiazdki, więc `minStars: 3` traktował nieznaną kategorię jak potwierdzone
// trzy gwiazdki. Teraz zwracamy `undefined` — nie wiemy, więc nie twierdzimy.
export function mapStars(categoryCode) {
  const m = /(\d)/.exec(categoryCode || "");
  return m ? Number(m[1]) : undefined;
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
  let bledy = 0;
  let lastErr = null;
  const perDest = await Promise.all(
    targets.map(async (dest) => {
      try {
        const avail = await availability({ dest, from, to, adults, children, ages: crit.childAges });
        // Bierzemy górę listy — sandbox potrafi zwrócić setki hoteli.
        const hotels = (avail?.hotels?.hotels || []).slice(0, 40);
        if (!hotels.length) return [];

        // Wzbogacenie o treści statyczne (nazwa, zdjęcia, gwiazdki, plaża).
        const codes = hotels.map((h) => h.code);
        const content = await fetchContent(codes);

        return hotels.map((h) => normalize(h, content[h.code] || {}, cheapestRate(h), pax));
      } catch (err) {
        bledy++;
        lastErr = err;
        console.warn(`[hotelbeds] błąd dla destynacji ${dest}:`, err.message);
        return [];
      }
    })
  );
  // Jeśli KAŻDA odpytana destynacja padła, to nie jest uczciwe zero wyników —
  // to awaria dostawcy (np. wyczerpana pula availability w sandboksie: HTTP 403 na
  // wszystkie zapytania, zaobserwowane 31.07.2026). Rzucamy dalej, żeby
  // warstwa wyżej (providers/index.js) mogła odróżnić to od "nic nie ma"
  // zamiast po cichu zwracać pustą listę.
  if (bledy > 0 && bledy === targets.length) throw lastErr;
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
  // Tryb "compare" liczy DOKŁADNIE te same dwie opcje, ale nie wybiera za
  // konsultanta — zwraca obie obok siebie (dwa pokoje 2-os. kontra jeden
  // 4-osobowy to realne pytanie klienta, nie coś do cichego rozstrzygnięcia).
  const mode = crit.roomsMode === "any" ? "any" : crit.roomsMode === "compare" ? "compare" : "split";
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
  let limitPrzekroczony = false;
  let dostepOdmowiony = false;

  const availMap = (dest, adults, children, ages) =>
    availability({ dest, from, to, adults, children, ages })
      .then((a) => {
        const map = {};
        for (const h of a?.hotels?.hotels || []) map[h.code] = cheapestRate(h);
        return map;
      })
      .catch((err) => {
        bledy++;
        if (err.status === 429) limitPrzekroczony = true;
        // Hotelbeds odpowiada 403 nie tylko na zły klucz, ale też po wyczerpaniu
        // limitu dobowego — zmierzone 29.07.2026 na sandboksie po serii testów.
        if (err.status === 403) dostepOdmowiony = true;
        console.warn(`[hotelbeds][multiroom] ${dest} (${adults} dor. + ${children} dz.):`, err.message);
        return {};
      });

  const perDest = await Promise.all(
    targets.map(async (dest) => {
      try {
        // Osobne pokoje: zapytanie per skład -> przecięcie hoteli dostępnych dla WSZYSTKICH.
        const perRoom = await Promise.all(rooms.map((r) => availMap(dest, r.adults, r.children, r.ages)));
        let common = Object.keys(perRoom[0] || {});
        for (let i = 1; i < perRoom.length; i++) common = common.filter((code) => perRoom[i][code]);
        const splitByCode = {};
        for (const code of common) splitByCode[code] = perRoom.map((m) => m[code]);

        // Jeden duży pokój na cały skład (trybu "any" i "compare" — obu
        // potrzebna jest ta sama druga opcja, różni je tylko to, co robimy z nią później).
        let bigByCode = {};
        // Jeden duży pokój: wiek wszystkich dzieci z całej grupy, po kolei.
        if (mode === "any" || mode === "compare") {
          const wszystkieWieki = rooms.flatMap((r) => r.ages || []);
          bigByCode = await availMap(dest, totalAdults, totalChildren, wszystkieWieki);
        }

        const codes = Array.from(new Set([...Object.keys(splitByCode), ...Object.keys(bigByCode)])).slice(0, 40);
        if (!codes.length) return [];
        const content = await fetchContent(codes);

        return codes
          .map((code) => {
            const c = content[code] || {};
            const split = splitByCode[code] ? normalizeMultiroom(code, c, splitByCode[code], rooms, totalPax) : null;
            const big = bigByCode[code] ? normalizeSingleRoom(code, c, bigByCode[code], totalAdults, totalChildren, totalPax) : null;
            if (mode === "compare") {
              const configs = [split, big].filter(Boolean);
              if (!configs.length) return null;
              // Reprezentant do sortowania/wyświetlenia karty = tańsza z opcji;
              // obie zostają dostępne w `compareConfigs` dla widoku obok siebie.
              const cheapest = configs.reduce((a, b) => (b.priceTotal < a.priceTotal ? b : a));
              return { ...cheapest, id: "hb-mr-cmp-" + code, compareConfigs: configs };
            }
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
    // Komunikat czyta konsultant w trakcie rozmowy z klientem, nie programista
    // w logach — musi od razu wiedzieć, czy czekać, czy szukać inaczej.
    let komunikat;
    if (limitPrzekroczony) {
      komunikat = "Przekroczono limit zapytań do dostawcy. Odczekaj chwilę i spróbuj ponownie — to nie znaczy, że nie ma wolnych miejsc.";
    } else if (dostepOdmowiony) {
      komunikat = "Wyczerpana pula zapytań o dostępność u dostawcy. To NIE jest brak wolnych miejsc ani problem z kluczem — pula odnawia się po stronie dostawcy (nie z dnia na dzień). Pozostałe źródła działają normalnie.";
    } else {
      komunikat = "Dostawca nie odpowiedział na zapytanie o dostępność. Wynik byłby niepełny, więc go nie pokazujemy — spróbuj ponownie za chwilę.";
    }
    const err = new Error(komunikat);
    err.providerFailure = true;
    err.rateLimited = limitPrzekroczony;
    err.accessDenied = dostepOdmowiony;
    throw err;
  }

  offers.sort((a, b) => a.priceTotal - b.priceTotal); // od najtańszych za grupę
  return offers;
}

// Składy pokoi z kryteriów (fallback: jeden pokój z ogólnej liczby gości).
// Ile pokoi wolno objąć jednym wyszukiwaniem. Każdy pokój to OSOBNE zapytanie
// do dostawcy, mnożone jeszcze przez liczbę destynacji — bez tego limitu jedno
// kliknięcie potrafi wysłać kilkadziesiąt płatnych zapytań. Sześć pokoi pokrywa
// realne wspólne wyjazdy (dwie–trzy rodziny); więcej to już grupa zorganizowana,
// której i tak nie obsługuje się przez wyszukiwarkę.
export const MAX_POKOI = Number(process.env.MULTIROOM_MAX_ROOMS) || 6;

export function normalizeRoomsInput(crit) {
  if (Array.isArray(crit.rooms) && crit.rooms.length) {
    return crit.rooms.slice(0, MAX_POKOI).map((r) => ({
      adults: Math.max(1, +r.adults || 1),
      children: Math.max(0, +r.children || 0),
      ages: r.ages || [],
    }));
  }
  return [{ adults: crit.adults || 2, children: crit.kids || 0, ages: crit.childAges || [] }];
}

// Cele destynacji: zaznaczone regiony -> ich kody, inaczej kod kraju, inaczej sandbox.
// Eksportowane wyłącznie na potrzeby testów — to czysta funkcja, a błąd w niej
// jest niewidoczny gołym okiem: zapytanie się udaje, tylko pyta o zły kierunek.
export function resolveTargets(crit) {
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
    // Dla ILU OSÓB jest ta suma. Tu policzona z realnych stawek za wszystkie pokoje
    // składu, więc dotyczy całej grupy — inaczej niż w źródłach pakietowych, gdzie
    // „cena razem" to standardowo cena za dwie osoby (patrz ranking.js:offerGroupTotal).
    priceTotalPax: totalPax,
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
/**
 * Buduje listę osób dla zapytania o dostępność.
 *
 * Wiek dziecka NIE jest szczegółem: decyduje o cenie (progi „dziecko gratis"
 * i zniżki bywają przy 2, 6, 12 latach) oraz o tym, czy pokój w ogóle jest
 * dostępny dla takiego składu. Do 29.07.2026 w kodzie siedziała stała 8 lat,
 * więc system pytał o ośmiolatka niezależnie od tego, czy klient miał
 * niemowlę, czy nastolatka — a konsultant podawał klientowi cenę dla kogoś
 * innego niż jego dziecko.
 *
 * Gdy wieku nie podano, wracamy do 8 lat jako wartości środkowej — lepsze
 * niż odrzucenie zapytania, ale to przybliżenie, nie fakt.
 */
/**
 * Wiek dzieci z zapytania HTTP ("", "10", "0,,7") na tablicę, w której POZYCJA
 * odpowiada dziecku. Puste pole zostaje pustym miejscem (null), a nie znika -
 * odfiltrowanie pustych przesuwałoby wiek na sąsiednie dziecko: przy dzieciach
 * [brak, 10 lat] pierwsze dostawałoby 10 lat, a drugie zgadywane 8.
 * Uwaga: Number("") daje 0, czyli niemowlę - stąd jawne sprawdzenie.
 */
export function parseChildAges(raw) {
  if (raw === undefined || raw === null || raw === "") return [];
  return String(raw)
    .split(",")
    .map((s) => {
      const t = s.trim();
      if (t === "") return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    });
}

export function buildPaxes(children, ages = []) {
  if (!(children > 0)) return undefined;
  return Array.from({ length: children }, (_, i) => {
    const surowy = ages?.[i];
    // Uwaga: Number(null) i Number("") dają 0, więc bez tego sprawdzenia
    // „nie podano wieku" udawałoby niemowlę — a to inna cena i inny pokój.
    const podano = surowy !== null && surowy !== undefined && surowy !== "";
    const wiek = podano ? Number(surowy) : NaN;
    return {
      type: "CH",
      age: Number.isFinite(wiek) && wiek >= 0 && wiek <= 17 ? Math.round(wiek) : 8,
    };
  });
}

async function availability({ dest, from, to, adults, children, ages }) {
  const body = {
    stay: { checkIn: from, checkOut: to },
    occupancies: [
      {
        rooms: 1,
        adults,
        children,
        paxes: buildPaxes(children, ages),
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

export function normalize(h, c, rate, pax) {
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
    //
    // Szacunek MA SENS tylko przy znanej kategorii. Odkąd mapStars zwraca undefined
    // dla kodów spoza słownika (3d5cc3f), `6 + undefined * 0.6` dawało NaN, które
    // w JSON staje się `null` — a taka oferta wypadała z KAŻDEGO progu oceny
    // (`null < 9` to prawda) i traciła punkty w rankingu. Czyli brak danych był
    // karany jak zła ocena, wbrew zasadzie obowiązującej w całym projekcie.
    rating: stars ? Math.min(9.5, 6 + stars * 0.6) : undefined,
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
    amenities: mapAmenities(facilities), // basen/spa/wifi/... lub undefined (brak danych)
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

// Osiem atrybutów kolumn "Obiekt"/"Aktywność" z ranking.js (ATTR_AMENITY):
// basen, spa, wifi, niepelnosprawni, animacje, sporty-wodne, klub-dzieci, silownia.
// APItude NIE dokumentuje publicznie facilityGroupCode/facilityCode akurat dla tej
// ósemki (w przeciwieństwie do grup 10/40/85/160 użytych wyżej, które są
// zweryfikowane na sandboksie) — a bez klucza produkcyjnego nie da się ich
// zgadnąć i zweryfikować przez /types/facilities. Dlatego, tak jak deriveTags()
// niżej, czytamy tekst opisu facility (description.content), który Content API
// i tak zwraca dla każdej pozycji. To bezpieczniejsze niż wpisanie niesprawdzonych
// numerów kodów, które po cichu nie dopasowałyby niczego — dokładnie ten sam
// błąd, który już raz uśpił te filtry.
const AMENITY_PATTERNS = {
  basen: /\bpool\b/,
  spa: /\bspa\b|wellness|massage/,
  wifi: /wi-?fi|internet (access|connection)/,
  niepelnosprawni: /disabled|wheelchair|handicap|accessib/,
  animacje: /animation|entertainment|evening show/,
  "sporty-wodne": /water sport|diving|snorkel|jet ski|windsurf/,
  "klub-dzieci": /kids?['’]? ?club|children'?s club|mini ?club/,
  silownia: /\bgym\b|fitness/,
};

// Zwraca tablicę pasujących kluczy, albo undefined gdy Content API nie dało w ogóle
// żadnych danych o obiekcie. ANTY-PRZEKOLORYZACJA: brak danych to NIE to samo, co
// pusta tablica — pusta tablica znaczy "sprawdziliśmy, hotel nie ma żadnego z ośmiu",
// a przy braku facilities w ogóle nie sprawdziliśmy niczego. Pomylenie tych dwóch
// przypadków odsiałoby po cichu każdy hotel bez treści ze WSZYSTKICH ośmiu filtrów.
export function mapAmenities(facilities) {
  if (!facilities || !facilities.length) return undefined;
  const txt = facilities.map((f) => (f.description?.content || "").toLowerCase()).join(" ");
  return Object.keys(AMENITY_PATTERNS).filter((key) => AMENITY_PATTERNS[key].test(txt));
}

function deriveTags(facilities, board) {
  const tags = [];
  const txt = facilities.map((f) => (f.description?.content || "").toLowerCase()).join(" ");
  if (/spa|wellness|massage/.test(txt)) tags.push("spa");
  if (/family|kids|children/.test(txt)) tags.push("rodzina");
  if (/beach/.test(txt)) tags.push("plaza");
  if (/disco|club|nightlife/.test(txt)) tags.push("impreza");
  if (/adults only|romantic/.test(txt)) tags.push("para");
  // Bez fallbacku: hotel, o którym nie mamy danych, NIE dostaje tagu „plaza".
  // Domyślne doklejanie „przy plaży" każdemu obiektowi bez opisu było
  // przekoloryzacją — profil „przy plaży" pokazywał hotele, o których nic nie wiemy.
  return tags;
}
