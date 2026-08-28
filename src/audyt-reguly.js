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

/**
 * Czy plakietka „terminy rozproszone" mówi prawdę o TEJ ofercie.
 *
 * Panel pisze przy ofercie, że żaden pojedynczy termin nie spełnia wszystkich
 * aktywnych filtrów naraz. To mocne zdanie handlowe — na jego podstawie konsultant
 * uprzedza klienta, że wyjazd trzeba będzie poskładać inaczej, niż wygląda na karcie.
 * Musi więc dać się sprawdzić NIEZALEŻNIE od kodu, który je wystawia.
 *
 * Dlatego ta funkcja liczy wszystko OD NOWA z danych, które wróciły z API, zamiast
 * wołać ranking.js — inaczej audyt potwierdzałby sam siebie i przespałby błąd
 * po obu stronach naraz.
 *
 * Zwraca: `true` (rozproszone), `false` (jest wariant spełniający komplet),
 * albo `null`, gdy nie ma czego sprawdzać (mniej niż dwa warianty lub mniej niż
 * dwa aktywne kryteria wariantowe — wtedy flaga z definicji nie powstaje).
 */
export function rozproszenieZWariantow(oferta, kryteria) {
  if (!oferta || oferta.type !== "package") return null;
  const warianty = (oferta.variants && oferta.variants.length) ? oferta.variants : [oferta];
  if (warianty.length < 2) return null;

  const k = kryteria || {};
  const testy = [];
  if (k.departures && k.departures.length) testy.push((v) => k.departures.includes(v.departureCity));
  if (k.transports && k.transports.length) testy.push((v) => k.transports.includes(v.transport));
  if (k.weekdays && k.weekdays.length) {
    testy.push((v) => !!v.departDate && k.weekdays.includes(new Date(v.departDate + "T00:00:00").getDay()));
  }
  if (testy.length < 2) return null;

  return !warianty.some((v) => testy.every((t) => t(v)));
}

/**
 * Oferty, przy których plakietka rozproszenia kłamie — w którąkolwiek stronę.
 * Obie pomyłki są szkodliwe, choć inaczej:
 *  - `brakujaca`: rozproszenie JEST, a panel milczy → konsultant obiecuje klientowi
 *    wyjazd, którego w tym układzie nie ma,
 *  - `nadmiarowa`: panel straszy rozproszeniem, którego nie ma → konsultant sam
 *    odradza dobrą ofertę albo przestaje ufać plakietce.
 */
export function plakietkiRozproszenia(oferty, kryteria) {
  const wynik = { sprawdzone: 0, zgodne: 0, brakujaca: [], nadmiarowa: [] };
  for (const o of oferty || []) {
    const oczekiwane = rozproszenieZWariantow(o, kryteria);
    if (oczekiwane === null) continue;
    wynik.sprawdzone++;
    const pokazane = !!o.filtrRozproszony;
    if (pokazane === oczekiwane) { wynik.zgodne++; continue; }
    (oczekiwane ? wynik.brakujaca : wynik.nadmiarowa).push(o.name || o.id);
  }
  return wynik;
}

/**
 * Czy filtr WARIANTOWY (pakietowy) trzyma to, co obiecał.
 *
 * Filtry z sekcji OBIETNICE pytają o pola samej oferty (gwiazdki, wyżywienie, cena).
 * Wylot z miasta, transport, dzień tygodnia i okno terminu działają inaczej: oferta
 * przechodzi, gdy KTÓRYKOLWIEK jej wariant spełnia kryterium (patrz ranking.js:
 * matchesAnyVariant) — bo jeden hotel niesie po kilkanaście terminów z różnych
 * lotnisk i od różnych operatorów. Reprezentant pokazany na karcie bywa innym
 * wariantem niż ten, który filtr przepuścił, więc sprawdzanie pól reprezentanta
 * odpowiadałoby na inne pytanie niż zadane.
 *
 * Liczymy OD NOWA z `offer.variants`, bez wołania matchesAnyVariant,
 * activeVariantPredicates ani variantWithinDates — tak samo jak przy plakietce
 * rozproszenia i z tego samego powodu: audyt wołający sprawdzany kod potwierdzałby
 * sam siebie i przespał błąd obecny po obu stronach naraz.
 *
 * Ocena jest BINARNA — nie ma tu stanu „bez danych". Wariant bez daty wylotu czy
 * bez miasta po prostu nie spełnia testu, dokładnie jak w applyFilters, gdzie brak
 * takiej danej odsiewa (inaczej niż przy atrybutach). Dzięki temu `filtrPrzecieka()`
 * działa na tym wyniku bez zmian, a `filtrBezPotwierdzen()` nie ma jak fałszywie
 * zapalić: każda policzona oferta ląduje w `potwierdza` albo w `lamie`.
 *
 * Oferty hotel-only są POMIJANE, nie liczone jako łamiące: przy aktywnym filtrze
 * pakietowym applyFilters odsiewa je z definicji, a Hotelbeds jest odpytywany po
 * datach już u dostawcy (patrz komentarz przy crit.from w applyFilters). Liczenie
 * ich jako przecieku zamieniłoby świadomą zasadę w co-przebiegowy fałszywy alarm.
 *
 * @param oferty lista z /api/search
 * @param test   warunek dla POJEDYNCZEGO wariantu, np. (v) => v.transport === "Samolot"
 */
export function ocenFiltrWariantowy(oferty, test) {
  const wynik = { razem: 0, potwierdza: 0, bezDanych: 0, lamie: 0, pominiete: 0, przyklady: [] };
  for (const o of oferty || []) {
    if (!o || o.type !== "package") { wynik.pominiete++; continue; }
    const warianty = (o.variants && o.variants.length) ? o.variants : [o];
    wynik.razem++;
    if (warianty.some((v) => test(v))) { wynik.potwierdza++; continue; }
    wynik.lamie++;
    if (wynik.przyklady.length < 3) wynik.przyklady.push(o);
  }
  return wynik;
}
