// ============================================================
//  Kolejkowanie i ponawianie zapytań do dostawców
//
//  Powód istnienia tych testów jest bardzo konkretny: Multiroom pyta
//  o dostępność osobno dla każdego pokoju i każdej destynacji, więc jedno
//  kliknięcie konsultanta wysyłało kilkanaście zapytań naraz. Hotelbeds
//  odpowiadał wtedy 429, a panel pokazywał „brak ofert" — mimo wolnych miejsc.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createLimiter, withRetry, withDeadline } from "../src/http.js";

test("limiter nie przepuszcza więcej zapytań naraz, niż wolno", async () => {
  const limit = createLimiter({ concurrency: 2 });
  let teraz = 0, szczyt = 0;
  const zadanie = () => limit(async () => {
    teraz++;
    szczyt = Math.max(szczyt, teraz);
    await new Promise((r) => setTimeout(r, 40));
    teraz--;
  });
  await Promise.all(Array.from({ length: 8 }, zadanie));
  assert.ok(szczyt <= 2, `w szczycie leciało ${szczyt} zapytań zamiast najwyżej 2`);
});

test("limiter zachowuje minimalny odstęp między zapytaniami", async () => {
  const limit = createLimiter({ concurrency: 1, minIntervalMs: 60 });
  const starty = [];
  await Promise.all(Array.from({ length: 3 }, () => limit(async () => { starty.push(Date.now()); })));
  for (let i = 1; i < starty.length; i++) {
    const odstep = starty[i] - starty[i - 1];
    assert.ok(odstep >= 50, `odstęp ${odstep} ms jest za krótki`);
  }
});

test("limiter przepuszcza wszystkie zadania i oddaje wyniki", async () => {
  const limit = createLimiter({ concurrency: 3 });
  const wyniki = await Promise.all([1, 2, 3, 4, 5].map((n) => limit(async () => n * 2)));
  assert.deepEqual(wyniki, [2, 4, 6, 8, 10]);
});

test("błąd jednego zadania nie blokuje kolejki", async () => {
  const limit = createLimiter({ concurrency: 1 });
  const pierwsze = limit(async () => { throw new Error("padło"); });
  const drugie = limit(async () => "działa dalej");
  await assert.rejects(pierwsze, /padło/);
  assert.equal(await drugie, "działa dalej");
});

test("ponawianie działa przy odpowiedzi „za dużo zapytań\"", async () => {
  let prob = 0;
  const wynik = await withRetry(async () => {
    prob++;
    if (prob < 3) {
      const err = new Error("HTTP 429");
      err.status = 429;
      throw err;
    }
    return "udało się za trzecim razem";
  }, { retries: 3, baseDelayMs: 10 });
  assert.equal(wynik, "udało się za trzecim razem");
  assert.equal(prob, 3);
});

test("ponawianie działa przy błędzie po stronie dostawcy (5xx)", async () => {
  let prob = 0;
  await withRetry(async () => {
    prob++;
    if (prob === 1) {
      const err = new Error("HTTP 503");
      err.status = 503;
      throw err;
    }
    return "ok";
  }, { retries: 2, baseDelayMs: 10 });
  assert.equal(prob, 2);
});

test("błąd nie do naprawienia ponowieniem nie jest ponawiany", async () => {
  let prob = 0;
  await assert.rejects(
    withRetry(async () => {
      prob++;
      const err = new Error("HTTP 401 — zły klucz");
      err.status = 401;
      throw err;
    }, { retries: 3, baseDelayMs: 10 }),
    /401/
  );
  assert.equal(prob, 1, "zły klucz nie naprawi się przez ponowienie — nie ma po co pytać drugi raz");
});

test("po wyczerpaniu prób błąd leci dalej", async () => {
  let prob = 0;
  await assert.rejects(
    withRetry(async () => {
      prob++;
      const err = new Error("HTTP 429");
      err.status = 429;
      throw err;
    }, { retries: 2, baseDelayMs: 10 }),
    /429/
  );
  assert.equal(prob, 3, "pierwsza próba + 2 ponowienia");
});

test("kolejne ponowienia czekają coraz dłużej", async () => {
  const czasy = [];
  let start = Date.now();
  await assert.rejects(
    withRetry(async () => {
      czasy.push(Date.now() - start);
      start = Date.now();
      const err = new Error("HTTP 429");
      err.status = 429;
      throw err;
    }, { retries: 2, baseDelayMs: 40 }),
    /429/
  );
  // Pierwsza próba natychmiast, druga po ~40 ms, trzecia po ~80 ms.
  assert.ok(czasy[2] > czasy[1], `odstępy nie rosną: ${czasy.join(", ")}`);
});

test("limiter i ponawianie działają razem bez zakleszczenia", async () => {
  const limit = createLimiter({ concurrency: 1, minIntervalMs: 5 });
  let prob = 0;
  const wyniki = await Promise.all(
    [1, 2, 3].map((n) =>
      limit(() =>
        withRetry(async () => {
          prob++;
          if (prob === 1) {
            const err = new Error("HTTP 429");
            err.status = 429;
            throw err;
          }
          return n;
        }, { retries: 2, baseDelayMs: 10 })
      )
    )
  );
  assert.deepEqual(wyniki.sort(), [1, 2, 3]);
});

test("withDeadline nie przecieka timerem po udanym zadaniu", async () => {
  // Gdyby timer nie był czyszczony, proces testowy nie mógłby się zakończyć.
  const wynik = await withDeadline(Promise.resolve("szybko"), 5000, "test");
  assert.equal(wynik, "szybko");
});

test("withDeadline PRZERYWA zadanie, ktore przekroczylo limit", async () => {
  // Luka znaleziona 03.09.2026 przez `npm run sabotaz`: zamiana calego ciala funkcji
  // na `return promise` (czyli calkowite wylaczenie limitu) nie wywracala ANI JEDNEGO
  // testu. Jedyny istniejacy test sprawdzal brak wycieku timera przy zadaniu, ktore
  // i tak konczylo sie szybko — czyli sciezke, ktora limitu w ogole nie dotyka.
  //
  // To jest ten sam mechanizm, ktory 26.08 skrocil czekanie konsultanta z 6 s do 2,5 s
  // (commit c4543e2). Bez niego jedno uspione zrodlo znowu zatrzymuje cale wyszukiwanie,
  // a panel nie ma jak powiedziec, ze lista jest niepelna.
  const wolne = new Promise((res) => setTimeout(() => res("za pozno"), 5000));

  await assert.rejects(
    () => withDeadline(wolne, 20, "wakacje.pl"),
    (e) => {
      assert.match(e.message, /wakacje\.pl/, "komunikat nie mowi, KTORE zrodlo nie zdazylo");
      assert.match(e.message, /20 ms/, "komunikat nie podaje limitu, ktory przekroczono");
      return true;
    },
    "zadanie ponad limit NIE zostalo przerwane — wolne zrodlo znowu zatrzyma cale wyszukiwanie"
  );
});

test("withDeadline nie rusza zadania, ktore zdazylo", async () => {
  // Limit ma odcinac wylacznie spoznionych. Zrodlo, ktore odpowiedzialo w czasie,
  // musi oddac swoja wartosc bez zmian — inaczej „ochrona" kosztowalaby oferty.
  const szybkie = new Promise((res) => setTimeout(() => res({ offers: 12 }), 5));
  assert.deepEqual(await withDeadline(szybkie, 200, "test"), { offers: 12 });
});

test("blad zrodla leci dalej jako blad zrodla, nie jako przekroczony limit", async () => {
  // Rozroznienie „padlo" od „nie zdazylo" jest w tym projekcie zasada (patrz trzy stany
  // zrodla): panel pisze co innego przy awarii, a co innego przy ciszy. Podmiana
  // komunikatu zatarlaby te roznice.
  await assert.rejects(
    () => withDeadline(Promise.reject(new Error("HTTP 403")), 500, "hotelbeds"),
    /HTTP 403/,
    "blad dostawcy zostal przebrany za przekroczenie limitu"
  );
});
