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

// `at` i `checkedAt` to DWIE różne rzeczy i mylenie ich zatruwa diagnostykę:
//   at        — kiedy udało się pobrać TEN kurs (czyli ile mają lat dane),
//   checkedAt — kiedy ostatni raz PYTALIŚMY NBP (czyli kiedy wypada następna próba).
// Do 24.08 było jedno pole na oba znaczenia: nieudana próba przestawiała `at` na
// teraz, żeby nie dobijać się do NBP co żądanie — ale przy tym kasowała jedyny
// ślad wieku kursu. fxStatus().ageMinutes pokazywał ~0 min także po wielodniowej
// awarii NBP, więc panel raportowałby „kurs sprzed chwili" dla kursu sprzed
// tygodnia. Nic tego jeszcze nie wyświetla, ale to dokładnie ten rodzaj cichego
// kłamstwa, który ta seria zmian z Kompasa wypleniała.
let current = { rate: FALLBACK_EUR_PLN, at: 0, checkedAt: 0, source: "awaryjny", date: null, ok: false };
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
  // Odstęp między próbami liczymy od OSTATNIEJ PRÓBY (checkedAt), nie od wieku
  // kursu — inaczej przy trwałej awarii NBP dobijalibyśmy się co żądanie.
  if (!force && Date.now() - current.checkedAt < REFRESH_MS) return current;
  if (inFlight) return inFlight; // kilka równoległych wyszukiwań = jedno zapytanie do NBP

  inFlight = fetchRate()
    .then(({ mid, date, table }) => {
      const teraz = Date.now();
      current = { rate: mid, at: teraz, checkedAt: teraz, source: `NBP ${table}`, date, ok: true };
      console.log(`[fx] kurs EUR/PLN = ${mid} (NBP, tabela z ${date})`);
      return current;
    })
    .catch((err) => {
      console.warn("[fx] nie udało się pobrać kursu z NBP:", err.message,
        `— zostaję przy ${current.rate} (${current.source})`);
      // Przesuwamy WYŁĄCZNIE moment ostatniej próby. `at` zostaje nietknięte, bo
      // kurs jest dokładnie tak stary, jak był — nieudane pytanie go nie odmładza.
      current = { ...current, checkedAt: Date.now(), ok: false };
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
    // Wiek KURSU — null, gdy nigdy nie udało się go pobrać (jedziemy na awaryjnym).
    ageMinutes: current.at ? Math.round((Date.now() - current.at) / 60000) : null,
    // Surowe znaczniki czasu, nie tylko zaokrąglony wiek: bez nich nie da się
    // odróżnić „kurs pobrany przed chwilą" od „kurs sprzed dni, ale znacznik
    // przestawiła nieudana próba" — a to była dokładnie ta cicha awaria.
    at: current.at ? new Date(current.at).toISOString() : null,
    checkedAt: current.checkedAt ? new Date(current.checkedAt).toISOString() : null,
    // Wiek ostatniej PRÓBY i jej wynik. Rozdzielone, żeby dało się odróżnić
    // „kurs sprzed 3 dni, NBP milczy" od „kurs sprzed 3 dni, jeszcze nie pytaliśmy".
    checkedMinutes: current.checkedAt ? Math.round((Date.now() - current.checkedAt) / 60000) : null,
    ok: current.ok,
  };
}
