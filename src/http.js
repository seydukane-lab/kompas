// ============================================================
//  Wspólne wywołania HTTP do zewnętrznych dostawców
//
//  Każde zapytanie na zewnątrz MUSI mieć limit czasu. Bez niego jeden
//  zamilkły dostawca (a to się zdarza w sezonie) zawiesza wyszukiwanie
//  na amen: konsultant patrzy w kręcące się kółko, połączenie wisi,
//  a przy kilkudziesięciu osobach na zmianie zapycha to serwer.
// ============================================================

export const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS) || 15000;

/** fetch z twardym limitem czasu — po jego przekroczeniu zrywa połączenie. */
export function fetchWithTimeout(url, opts = {}, ms = HTTP_TIMEOUT_MS) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

/**
 * Ogranicza czas dowolnej obietnicy. W przeciwieństwie do fetchWithTimeout
 * nie przerywa pracy w tle — służy jako ostatnia zapora dla dostawcy, który
 * robi kilka wywołań po kolei i mimo limitów na każdym z nich łącznie
 * przekracza rozsądny czas odpowiedzi.
 */
export function withDeadline(promise, ms, label = "dostawca") {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: przekroczono limit ${ms} ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/**
 * Kolejka ograniczająca tempo zapytań do jednego dostawcy.
 *
 * Powód jest bardzo konkretny: Multiroom pyta o dostępność osobno dla każdego
 * pokoju i każdej destynacji, więc jedno kliknięcie konsultanta potrafi wysłać
 * kilkanaście zapytań naraz. Hotelbeds odpowiada wtedy 429 („za dużo zapytań"),
 * a wyszukiwanie kończy się pustą listą, choć wolne miejsca są.
 *
 * `concurrency` — ile zapytań może lecieć równocześnie.
 * `minIntervalMs` — minimalny odstęp między startami kolejnych zapytań.
 */
export function createLimiter({ concurrency = 2, minIntervalMs = 0 } = {}) {
  let aktywne = 0;
  let ostatniStart = 0;
  const kolejka = [];

  function nastepne() {
    if (aktywne >= concurrency || !kolejka.length) return;
    const czekaj = Math.max(0, ostatniStart + minIntervalMs - Date.now());
    if (czekaj > 0) {
      setTimeout(nastepne, czekaj);
      return;
    }
    const { fn, resolve, reject } = kolejka.shift();
    aktywne++;
    ostatniStart = Date.now();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        aktywne--;
        nastepne();
      });
  }

  return function run(fn) {
    return new Promise((resolve, reject) => {
      kolejka.push({ fn, resolve, reject });
      nastepne();
    });
  };
}

/**
 * Ponawia zapytanie, gdy dostawca odpowiedział „za dużo zapytań" albo chwilowo
 * padł. Odstęp rośnie wykładniczo, bo natychmiastowe ponowienie tylko dokłada
 * do kolejki, która i tak jest przepełniona.
 */
export async function withRetry(fn, { retries = 2, baseDelayMs = 700, isRetryable } = {}) {
  const retryowalny = isRetryable || ((err) => err?.status === 429 || err?.status >= 500);
  let ostatni;
  for (let proba = 0; proba <= retries; proba++) {
    try {
      return await fn();
    } catch (err) {
      ostatni = err;
      if (proba === retries || !retryowalny(err)) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** proba));
    }
  }
  throw ostatni;
}
