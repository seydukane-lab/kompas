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
