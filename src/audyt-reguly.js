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

/**
 * Czy filtr dotrzymał tego, co obiecał konsultantowi.
 *
 * Dzieli zwrócone oferty na trzy rozłączne kubełki i NIE ocenia ich sam —
 * ocenę zostawia wołającemu, bo dwa z tych stanów znaczą co innego:
 *
 *  - `potwierdza` — wiemy, że oferta kryterium spełnia,
 *  - `bezDanych`  — dostawca nie podał tej informacji; oferta przeszła, bo brak
 *                   danych świadomie NIE odsiewa (patrz ranking.js:applyFilters).
 *                   Sam w sobie nie jest błędem, ale gdy jest ich 100%, filtr
 *                   niczego nie gwarantuje, a lista wygląda na zawężoną,
 *  - `lamie`      — wiemy, że oferta kryterium NIE spełnia. To przeciek filtra:
 *                   ta oferta nie miała prawa znaleźć się w wynikach.
 *
 * Po co osobna funkcja: w nocy 26/27.08.2026 wyszło, że filtr o nieznanej nazwie
 * klucza przepuszczał cały katalog, a panel liczył go jako aktywny. Znalezione
 * przypadkiem — więc pytanie „czy ten filtr w ogóle filtruje" musi być zadawane
 * maszynowo dla każdego filtra, a nie przy okazji.
 *
 * @param oferty lista z /api/search
 * @param znane  czy dla TEJ oferty odpowiedź jest w ogóle znana
 * @param spelnia czy oferta spełnia kryterium (wołane tylko gdy `znane`)
 */
export function ocenObietnice(oferty, znane, spelnia) {
  const wynik = { razem: 0, potwierdza: 0, bezDanych: 0, lamie: 0, przyklady: [] };
  for (const o of oferty || []) {
    wynik.razem++;
    if (!znane(o)) { wynik.bezDanych++; continue; }
    if (spelnia(o)) { wynik.potwierdza++; continue; }
    wynik.lamie++;
    if (wynik.przyklady.length < 3) wynik.przyklady.push(o);
  }
  return wynik;
}

/** Czy filtr przecieka: są oferty, o których WIEMY, że kryterium nie spełniają. */
export function filtrPrzecieka(ocena) {
  return !!ocena && ocena.lamie > 0;
}

/**
 * Czy filtr niczego nie potwierdza — same niewiadome. Pusta lista NIE liczy się:
 * zero wyników to uczciwa odpowiedź „nic nie pasuje", a nie cicha obietnica.
 */
export function filtrBezPotwierdzen(ocena) {
  return !!ocena && ocena.razem > 0 && ocena.potwierdza === 0 && ocena.lamie === 0;
}
