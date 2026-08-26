// ============================================================
//  Reguły audytu — wydzielone, żeby dało się je przetestować
//
//  scripts/audyt.js jest skryptem z top-level await: import w teście odpaliłby
//  cały przebieg razem z próbą połączenia z serwerem. Reguły, które muszą być
//  weryfikowalne, mieszkają więc tutaj, a skrypt je tylko woła.
// ============================================================

/** Domyślny próg „ciszy" dostawcy — patrz podejrzaneZero(). */
export const PROG_CISZY_MS = Number(process.env.AUDYT_PROG_CISZY_MS) || 10000;

/**
 * Czy wpis w `sources[]` wygląda na błąd POŁKNIĘTY przez dostawcę.
 *
 * Kontrakt (patrz providers/index.js): `ok:true` z zerem ofert znaczy
 * „odpytaliśmy, nic nie ma", a awaria daje `ok:false` z powodem. Provider, który
 * łapie własny wyjątek i zwraca pustą listę, obchodzi to rozróżnienie — dla panelu
 * wygląda jak uczciwe zero, więc konsultant mówi klientowi „w tym terminie nic nie
 * ma", choć źródło po prostu nie odpowiedziało.
 *
 * Sygnał, po którym to poznać: uczciwe zero przychodzi SZYBKO (katalog PL: 4–7 ms),
 * a połknięty timeout zajmuje tyle, ile limit HTTP (domyślnie 15 s, patrz
 * http.js:HTTP_TIMEOUT_MS). Zero po kilkunastu sekundach to prawie na pewno awaria
 * przebrana za brak wyników.
 *
 * Zmierzone 26.08.2026 na lokalnym źródle wakacje.pl: 25 timeoutów w jednym
 * przebiegu audytu, wszystkie raportowane jako ok:true / 0 ofert — panel milczał,
 * a konsultant czekał 15 s na każde wyszukiwanie.
 *
 * ⚠️ To heurystyka diagnostyczna, nie twierdzenie o stanie dostawcy — dlatego
 * mieszka w audycie, a nie w odpowiedzi /api/search. Wpis Z CACHE jest z niej
 * wyłączony: `ms` znaczy tam czas odczytu z pamięci, nie czas odpytania źródła.
 */
export function podejrzaneZero(zrodlo, progMs = PROG_CISZY_MS) {
  if (!zrodlo) return false;
  if (zrodlo.ok !== true) return false;      // ok:false ma już swój powód, skipped nie był pytany
  if (zrodlo.cached) return false;           // czas z cache nie mówi nic o dostawcy
  if (zrodlo.count !== 0) return false;      // źródło coś zwróciło — nie ma o czym mówić
  return typeof zrodlo.ms === "number" && zrodlo.ms >= progMs;
}
