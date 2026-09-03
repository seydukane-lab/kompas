// ============================================================
//  Hamulec wydatków na API doradcy (ETA)
//
//  Do 03.09.2026 advisor.js LICZYŁ wydatki, ale nic ich nie ograniczało.
//  Zmierzone tego dnia: 13 wywołań = 3,44 USD, czyli ~0,265 USD (~1 zł) za raport.
//
//  Dlaczego to jest hamulec, a nie ciekawostka:
//   - kredyt 85 € przepada 19.09.2026, więc do tego czasu wydatek jest „darmowy",
//     ale PO tej dacie każde kliknięcie ETA to pieniądze z karty właściciela;
//   - panel ma trafić do biura, gdzie klikać będzie kilku konsultantów naraz —
//     jeden intensywny dzień potrafi wydać więcej niż cały miesięczny abonament,
//     który za to narzędzie planujemy pobierać (widełki 150–300 zł/stanowisko);
//   - awaria po stronie panelu (pętla, podwójne kliknięcie, odświeżanie) kosztuje
//     tu realne pieniądze, a nie tylko czas.
//
//  Zasada: hamulec zatrzymuje TYLKO realne wywołania API. Raport z cache nic nie
//  kosztuje, więc nie ma powodu, żeby go blokować — konsultant ma dostać to, za co
//  już zapłacono.
// ============================================================

/** Ile dolarów wolno wydać w ciągu doby. 0 albo brak = bez ograniczenia dziennego. */
export const LIMIT_DZIEN_USD = Number(process.env.ADVISOR_LIMIT_DZIEN_USD ?? 5);

/**
 * Ile dolarów wolno wydać ŁĄCZNIE, odkąd liczymy. Domyślnie bez ograniczenia:
 * właściciel zna stan swojego kredytu lepiej niż kod, a limit wpisany na sztywno
 * zatrzymałby narzędzie w środku pracy z klientem. Włącza się go świadomie.
 */
export const LIMIT_LACZNY_USD = Number(process.env.ADVISOR_LIMIT_LACZNY_USD ?? 0);

/** Dzień w formacie, w jakim advisor trzyma rejestr wydatków (YYYY-MM-DD, UTC). */
export function dzienKluczem(teraz = Date.now()) {
  return new Date(teraz).toISOString().slice(0, 10);
}

/**
 * Czy wolno wykonać KOLEJNE płatne wywołanie API.
 *
 * @param spend  rejestr z advisor.js: { totalUsd, calls, days: { "YYYY-MM-DD": { usd } } }
 * @param opcje  { teraz, limitDzienUsd, limitLacznyUsd } — wstrzykiwane w testach
 *
 * Zwraca `{ wolno, powod, wydaneDzisUsd, wydaneLacznieUsd, zostaloDzisUsd, zostaloLacznieUsd }`.
 * `powod` jest zdaniem DLA CZŁOWIEKA — trafia do panelu, więc musi mówić, co się
 * stało i co z tym zrobić, a nie tylko „limit przekroczony".
 */
export function czyWolnoWydac(spend, opcje = {}) {
  const teraz = opcje.teraz ?? Date.now();
  const limitDzien = Number(opcje.limitDzienUsd ?? LIMIT_DZIEN_USD) || 0;
  const limitLaczny = Number(opcje.limitLacznyUsd ?? LIMIT_LACZNY_USD) || 0;

  const s = spend || {};
  const dzis = dzienKluczem(teraz);
  const wydaneDzis = Number(s.days?.[dzis]?.usd || 0);
  const wydaneLacznie = Number(s.totalUsd || 0);

  const wynik = {
    wolno: true,
    powod: null,
    wydaneDzisUsd: wydaneDzis,
    wydaneLacznieUsd: wydaneLacznie,
    // `null` znaczy „bez limitu", a nie „zero" — to dwie różne wiadomości dla panelu.
    zostaloDzisUsd: limitDzien ? Math.max(0, limitDzien - wydaneDzis) : null,
    zostaloLacznieUsd: limitLaczny ? Math.max(0, limitLaczny - wydaneLacznie) : null,
  };

  // Łączny sprawdzamy PIERWSZY: gdy skończył się cały budżet, informacja o dziennym
  // limicie tylko myli — jutro nic się samo nie odblokuje.
  if (limitLaczny && wydaneLacznie >= limitLaczny) {
    wynik.wolno = false;
    wynik.powod =
      `Wyczerpany łączny budżet na doradcę: wydano ${wydaneLacznie.toFixed(2)} USD ` +
      `z limitu ${limitLaczny.toFixed(2)} USD. Raporty z pamięci podręcznej działają dalej; ` +
      `nowe wymagają podniesienia ADVISOR_LIMIT_LACZNY_USD.`;
    return wynik;
  }

  if (limitDzien && wydaneDzis >= limitDzien) {
    wynik.wolno = false;
    wynik.powod =
      `Dzienny limit doradcy wyczerpany: ${wydaneDzis.toFixed(2)} USD z ${limitDzien.toFixed(2)} USD. ` +
      `Odnowi się jutro; wcześniej można podnieść ADVISOR_LIMIT_DZIEN_USD w .env.`;
    return wynik;
  }

  return wynik;
}

/**
 * Krótkie ostrzeżenie, gdy budżet się kończy — żeby właściciel dowiedział się
 * o tym PRZED zatrzymaniem narzędzia, a nie w momencie, gdy przestanie działać
 * przy kliencie. `null`, gdy nie ma o czym mówić.
 */
export function ostrzezenieBudzetu(stan, prog = 0.8) {
  if (!stan || !stan.wolno) return null;
  const blisko = (wydane, zostalo) => {
    if (zostalo === null) return false;
    const limit = wydane + zostalo;
    return limit > 0 && wydane / limit >= prog;
  };
  if (blisko(stan.wydaneLacznieUsd, stan.zostaloLacznieUsd)) {
    return `Łączny budżet doradcy na wyczerpaniu — zostało ${stan.zostaloLacznieUsd.toFixed(2)} USD.`;
  }
  if (blisko(stan.wydaneDzisUsd, stan.zostaloDzisUsd)) {
    return `Dzienny budżet doradcy na wyczerpaniu — zostało ${stan.zostaloDzisUsd.toFixed(2)} USD.`;
  }
  return null;
}

/**
 * Od kiedy liczy się ten rejestr — najstarszy dzień z wydatkami albo `null`,
 * gdy jeszcze niczego nie wydano.
 *
 * ⚠️ TO NIE JEST OZDOBNIK. Rejestr leży w `data/`, a na planie free Rendera dysk
 * jest EFEMERYCZNY: znika przy każdym wdrożeniu. Limit łączny liczony od pustego
 * pliku nie chroni przed niczym — po deployu licznik wraca do zera, choć pieniądze
 * zostały wydane naprawdę. Panel i log muszą więc mówić, OD KIEDY liczą, zamiast
 * podawać sumę jako pełną prawdę o wydatkach.
 *
 * Trwały limit łączny wymaga dysku trwałego (Render Disk / VPS) — tak samo jak
 * baza kont, patrz render.yaml.
 */
export function liczoneOd(spend) {
  const dni = Object.keys(spend?.days || {}).sort();
  return dni.length ? dni[0] : null;
}
