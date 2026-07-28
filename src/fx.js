// ============================================================
//  Kurs walut — EUR → PLN z API NBP
//
//  Ceny z Hotelbeds przychodzą w EUR i do tej pory mnożyliśmy je przez
//  stałą 4,3 wpisaną w kod. Przy wahaniu kursu o kilka procent oferta
//  za 3000 zł potrafi się rozjechać o ponad stówę — a konsultant podaje
//  tę liczbę klientowi. Kurs musi być prawdziwy.
//
//  Źródło: api.nbp.pl, tabela A (kursy średnie), publikowana raz dziennie
//  w dni robocze. Kurs trzymamy w pamięci i odświeżamy co kilka godzin;
//  gdy NBP nie odpowiada, zostajemy przy ostatnim znanym, a przy zimnym
//  starcie przy wartości awaryjnej — lepiej pokazać cenę sprzed dnia niż
//  nie pokazać żadnej.
// ============================================================

import { fetchWithTimeout } from "./http.js";

const NBP_URL = "https://api.nbp.pl/api/exchangerates/rates/a/eur/?format=json";
const REFRESH_MS = Number(process.env.FX_REFRESH_MS) || 6 * 3600 * 1000; // 6 h

// Wartość awaryjna na wypadek, gdyby NBP nie odpowiedziało przy starcie.
const FALLBACK_EUR_PLN = Number(process.env.EUR_PLN_FALLBACK) || 4.3;

// Narzut na kurs średni NBP. Kurs średni to kurs referencyjny, nie kurs
// sprzedaży — organizator przelicza po swoim. Domyślnie 0, bo nie zgadujemy
// cudzej polityki cenowej; do ustawienia, gdy poznamy realny przelicznik.
const MARKUP = Number(process.env.FX_MARKUP) || 0;

let current = { rate: FALLBACK_EUR_PLN, at: 0, source: "awaryjny", date: null };
let inFlight = null;

async function fetchRate() {
  const res = await fetchWithTimeout(NBP_URL, { headers: { Accept: "application/json" } }, 8000);
  if (!res.ok) throw new Error(`NBP HTTP ${res.status}`);
  const data = await res.json();
  const mid = data?.rates?.[0]?.mid;
  if (!(mid > 0)) throw new Error("NBP: brak kursu w odpowiedzi");
  return { mid, date: data.rates[0].effectiveDate, table: data.rates[0].no };
}

/**
 * Odświeża kurs, jeśli jest przeterminowany. Nie rzuca wyjątkiem —
 * awaria NBP nie może wywrócić wyszukiwania ofert.
 */
export async function refreshRate(force = false) {
  if (!force && Date.now() - current.at < REFRESH_MS) return current;
  if (inFlight) return inFlight; // kilka równoległych wyszukiwań = jedno zapytanie do NBP

  inFlight = fetchRate()
    .then(({ mid, date, table }) => {
      current = { rate: mid, at: Date.now(), source: `NBP ${table}`, date };
      console.log(`[fx] kurs EUR/PLN = ${mid} (NBP, tabela z ${date})`);
      return current;
    })
    .catch((err) => {
      console.warn("[fx] nie udało się pobrać kursu z NBP:", err.message,
        `— zostaję przy ${current.rate} (${current.source})`);
      // Nie zerujemy `at`: przy trwałej awarii NBP nie chcemy dobijać się co żądanie.
      current = { ...current, at: Date.now() };
      return current;
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}

/** Aktualny przelicznik EUR→PLN wraz z narzutem. Synchroniczny — nie blokuje wyszukiwania. */
export function eurPln() {
  return current.rate * (1 + MARKUP);
}

/** Przelicza kwotę w EUR na złotówki. */
export function eurToPln(amount) {
  return amount * eurPln();
}

/** Informacja o kursie do panelu/diagnostyki. */
export function fxStatus() {
  return {
    eurPln: Number(eurPln().toFixed(4)),
    base: current.rate,
    markup: MARKUP,
    source: current.source,
    date: current.date,
    ageMinutes: current.at ? Math.round((Date.now() - current.at) / 60000) : null,
  };
}
