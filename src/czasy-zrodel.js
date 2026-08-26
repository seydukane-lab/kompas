// ============================================================
//  Analiza czasów odpowiedzi źródeł — dobór miękkiego limitu
//
//  PROVIDER_SOFT_TIMEOUT_MS mówi, ile konsultant czeka, zanim oddamy mu to,
//  co już dojechało (patrz providers/index.js). Dobór tej jednej liczby był
//  początkowo na wyczucie: 6000 ms „żeby Hotelbeds mieścił się z zapasem".
//
//  Pomiar z 26.08.2026 pokazał, dlaczego wyczucie tu nie wystarcza. Czasy
//  źródeł nie są rozłożone równomiernie — są w dwóch skupiskach:
//      pl-packages   3-10 ms      (katalog z dysku)
//      hotelbeds     577-677 ms   (jedno wywołanie, dziś 403)
//      wakacje       7894-9473 ms (kilka zapytań po kolei)
//  Między 0,7 s a 7,9 s NIE MA ŻADNEGO ŹRÓDŁA. Każdy próg z tego przedziału
//  daje DOKŁADNIE ten sam wynik — te same oferty, te same stany źródeł —
//  i różni się wyłącznie tym, ile konsultant czeka przy ekranie. Zmierzone:
//  próg 6000 i próg 2000 dały po 126 ofert w pięciu scenariuszach, ale 30,0 s
//  wobec 10,1 s łącznego czekania. Po tym pomiarze domyślny próg zszedł na 2500 ms.
//
//  Stąd ten moduł. Nie zgaduje progu — liczy, gdzie leży najbliższa przerwa
//  między skupiskami, i pokazuje, ile kosztuje trzymanie progu wyżej niż to
//  konieczne. Decyzja zostaje przy człowieku, bo zapas nad najwolniejszym
//  źródłem, które ma zdążyć, to kwestia ryzyka, nie arytmetyki.
// ============================================================

/**
 * Rozkłada pomiary względem progu.
 *
 * @param {{id:string, ms:number}[]} pomiary  czasy odpowiedzi źródeł
 * @param {number} prog                       miękki limit w ms
 */
export function analizaProgu(pomiary, prog) {
  const lista = (pomiary || []).filter((p) => p && Number.isFinite(p.ms));
  const zdazyly = lista.filter((p) => p.ms <= prog).sort((a, b) => a.ms - b.ms);
  const nieZdazyly = lista.filter((p) => p.ms > prog).sort((a, b) => a.ms - b.ms);

  // Ile konsultant realnie czeka: najwolniejsze ze źródeł, które zdążyły —
  // a gdy któreś nie zdążyło, dokładnie tyle, ile wynosi próg (na nim się urywa).
  const najwolniejszyZdazyl = zdazyly.length ? zdazyly[zdazyly.length - 1].ms : 0;
  const czekanie = nieZdazyly.length ? prog : najwolniejszyZdazyl;

  // Przedział progów dających IDENTYCZNY podział. Dolna granica to czas
  // najwolniejszego źródła, które ma zdążyć (niżej wypadłoby z wyniku),
  // górna — czas najszybszego z tych, które nie zdążyły (wyżej weszłoby do wyniku).
  const dol = najwolniejszyZdazyl;
  const gora = nieZdazyly.length ? nieZdazyly[0].ms : Infinity;

  return {
    prog,
    zdazyly: zdazyly.map((p) => p.id),
    nieZdazyly: nieZdazyly.map((p) => p.id),
    czekanie,
    // Ile czekania da się uciąć BEZ zmiany wyniku — zejściem do dolnej granicy
    // przedziału równoważnego. Zero, gdy próg już przy niej stoi albo gdy to
    // nie próg jest wąskim gardłem, tylko realna praca źródeł.
    doUciecia: Math.max(0, czekanie - Math.max(dol, 0)),
    rownowazne: { od: dol, do: gora },
  };
}

/**
 * Największa przerwa w czasach źródeł — tam, gdzie próg jest najbezpieczniejszy,
 * bo najdalej mu do jakiegokolwiek zmierzonego czasu w obie strony.
 *
 * Zwraca null przy mniej niż dwóch pomiarach: jedno źródło nie tworzy przerwy,
 * a wtedy nie ma czego szukać i lepiej powiedzieć to wprost niż zwrócić liczbę
 * wyglądającą na wynik pomiaru.
 */
export function najwiekszaPrzerwa(pomiary) {
  const ms = (pomiary || []).filter((p) => p && Number.isFinite(p.ms)).map((p) => p.ms).sort((a, b) => a - b);
  if (ms.length < 2) return null;
  let best = null;
  for (let i = 1; i < ms.length; i++) {
    const szerokosc = ms[i] - ms[i - 1];
    if (!best || szerokosc > best.szerokosc) best = { od: ms[i - 1], do: ms[i], szerokosc };
  }
  return best;
}
