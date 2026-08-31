// ============================================================
//  Reguły kontrolowanego sabotażu — patrz scripts/sabotaz.mjs
//
//  Sabotaż jest w tym projekcie JEDYNYM dowodem, że test czegokolwiek pilnuje.
//  Dlatego sabotaż, który cicho nie zaszedł, jest gorszy niż jego brak: zielone
//  testy wyglądają wtedy dokładnie jak sukces, a w rzeczywistości nie sprawdzono
//  niczego. Zdarzyło się to w tym projekcie kilka razy — raz przez gołe `\n`
//  we wzorcu przy pliku z CRLF, raz przez wzorzec, który po prostu nie trafił.
//
//  Stąd zasada, którą wymuszają te funkcje: podmiana musi być POTWIERDZONA
//  w treści pliku, zanim ktokolwiek uruchomi testy.
// ============================================================

/**
 * Jakimi znakami plik kończy linie. Repo jest edytowane na Windows, więc pliki
 * w drzewie roboczym mają CRLF — a wzorzec podany w terminalu ma LF. Bez tego
 * rozpoznania każdy wielolinijkowy wzorzec chybia i sabotaż „przechodzi".
 */
export function koncowkaLinii(tresc) {
  return String(tresc || "").includes("\r\n") ? "\r\n" : "\n";
}

/** Sprowadza wzorzec do końcówek linii, jakich naprawdę używa plik. */
export function dopasujKoncowki(wzorzec, koncowka) {
  const czysty = String(wzorzec || "").replace(/\r\n/g, "\n");
  return koncowka === "\r\n" ? czysty.replace(/\n/g, "\r\n") : czysty;
}

/** Ile razy wzorzec występuje w treści (po dopasowaniu końcówek linii). */
export function ileWystapien(tresc, wzorzec) {
  const w = dopasujKoncowki(wzorzec, koncowkaLinii(tresc));
  if (!w) return 0;
  let n = 0, i = 0;
  for (;;) {
    const j = String(tresc).indexOf(w, i);
    if (j < 0) return n;
    n++;
    i = j + w.length;
  }
}

/**
 * Podmiana z twardymi warunkami — zwraca `{ ok, powod, tresc }`.
 *
 * Odmawia, gdy wzorca NIE MA (sabotaż by nie zaszedł) oraz gdy występuje WIĘCEJ
 * NIŻ RAZ (nie wiadomo, które miejsce badamy, a podmiana wszystkich naraz miesza
 * dwa eksperymenty w jeden). Odmawia też, gdy tekst docelowy jest identyczny
 * z wzorcem — to podmiana pozorna, po której testy nie mają prawa nic zauważyć.
 */
export function przygotujPodmiane(tresc, z, na) {
  const k = koncowkaLinii(tresc);
  const szukany = dopasujKoncowki(z, k);
  const docelowy = dopasujKoncowki(na, k);

  if (!szukany) return { ok: false, powod: "pusty wzorzec do podmiany" };
  if (szukany === docelowy) return { ok: false, powod: "wzorzec i zamiennik są identyczne — to nie jest sabotaż" };

  const ile = ileWystapien(tresc, szukany);
  if (ile === 0) return { ok: false, powod: "wzorzec NIE WYSTĘPUJE w pliku — sabotaż by nie zaszedł" };
  if (ile > 1) return { ok: false, powod: `wzorzec występuje ${ile} razy — doprecyzuj go, żeby trafiał w jedno miejsce` };

  return { ok: true, tresc: String(tresc).replace(szukany, docelowy), szukany, docelowy };
}

/**
 * Czy plik NAPRAWDĘ został zmieniony tak, jak chcieliśmy. Wołane po zapisie,
 * na treści wczytanej z dysku — bo tylko to jest dowodem, a nie zmienna w pamięci.
 */
export function potwierdzPodmiane(treschPoZapisie, szukany, docelowy, trescPrzed) {
  if (ileWystapien(treschPoZapisie, docelowy) === 0) {
    return { ok: false, powod: "po zapisie nie ma zmienionego fragmentu — podmiana nie weszła" };
  }
  if (trescPrzed !== undefined && String(treschPoZapisie) === String(trescPrzed)) {
    return { ok: false, powod: "plik jest bajt w bajt taki sam jak przed podmianą" };
  }
  // Sprawdzenie „oryginał zniknął" ma sens TYLKO wtedy, gdy zamiennik nie zawiera
  // wzorca w sobie. Przy rozszerzeniu w rodzaju `f() {` → `f() { return [];`
  // oryginał z definicji zostaje i odrzucanie tego było fałszywym alarmem —
  // znalezionym 31.08.2026 podczas pierwszego audytu pokrycia tym narzędziem.
  if (!dopasujKoncowki(docelowy, koncowkaLinii(treschPoZapisie)).includes(dopasujKoncowki(szukany, koncowkaLinii(treschPoZapisie)))
      && ileWystapien(treschPoZapisie, szukany) > 0) {
    return { ok: false, powod: "po zapisie oryginalny fragment nadal tam jest — podmiana weszła nie tam, gdzie trzeba" };
  }
  return { ok: true };
}

/**
 * Wynik całego przebiegu. `zlapany` znaczy, że po sabotażu SPADŁ choć jeden test —
 * czyli badana gałąź jest realnie chroniona.
 *
 * Osobno pilnujemy stanu po przywróceniu: zielone testy na końcu to warunek tego,
 * żeby całość dało się uznać za zamkniętą. Sabotaż, po którym repo zostaje czerwone
 * albo zmienione, jest gorszy niż brak sabotażu.
 */
export function werdykt({ blednePrzed, blednePo, blendePoPrzywroceniu, plikPrzywrocony }) {
  if (!plikPrzywrocony) {
    return { ok: false, kod: 2, tekst: "PLIK NIE ZOSTAŁ PRZYWRÓCONY — repo jest w stanie po sabotażu, napraw to ręcznie" };
  }
  if (blednePrzed > 0) {
    return { ok: false, kod: 2, tekst: `testy były czerwone JUŻ PRZED sabotażem (${blednePrzed}) — nie ma czego mierzyć` };
  }
  if (blendePoPrzywroceniu > 0) {
    return { ok: false, kod: 2, tekst: `po przywróceniu testy są czerwone (${blendePoPrzywroceniu}) — przywrócenie nie zadziałało` };
  }
  if (blednePo === 0) {
    return {
      ok: false, kod: 1,
      tekst: "SABOTAŻ PRZESZEDŁ NIEZAUWAŻONY — zepsuty kod nie wywrócił ANI JEDNEGO testu.\n" +
             "        Ta gałąź nie jest chroniona: albo brakuje testu, albo istniejący jej nie dotyka.",
    };
  }
  return { ok: true, kod: 0, tekst: `sabotaż złapany — spadło testów: ${blednePo}` };
}
