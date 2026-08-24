// ============================================================
//  Kurs EUR→PLN
//
//  Konsultant podaje klientowi kwoty policzone tym kursem, więc
//  interesuje nas nie tylko to, czy pobranie działa, ale przede
//  wszystkim co się dzieje, gdy NBP nie odpowiada. Testy nie
//  wychodzą do sieci — podmieniają fetch.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

process.env.EUR_PLN_FALLBACK = "4.3";
process.env.FX_REFRESH_MS = "50";

const fx = await import("../src/fx.js");

const prawdziwyFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = prawdziwyFetch; });

function odpowiedzNBP(mid, date = "2026-07-28", no = "144/A/NBP/2026") {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ table: "A", currency: "euro", code: "EUR", rates: [{ no, effectiveDate: date, mid }] }),
  });
}

function awariaNBP(err = new Error("brak sieci")) {
  globalThis.fetch = async () => { throw err; };
}

test("przed pobraniem obowiązuje kurs awaryjny", () => {
  const s = fx.fxStatus();
  assert.equal(s.base, 4.3);
  assert.equal(s.source, "awaryjny");
});

test("kurs z NBP zastępuje wartość awaryjną", async () => {
  odpowiedzNBP(4.3242);
  await fx.refreshRate(true);
  const s = fx.fxStatus();
  assert.equal(s.base, 4.3242);
  assert.match(s.source, /^NBP/);
  assert.equal(s.date, "2026-07-28");
});

test("przeliczenie euro na złotówki używa aktualnego kursu", async () => {
  odpowiedzNBP(4.5);
  await fx.refreshRate(true);
  assert.equal(fx.eurToPln(100), 450);
  assert.equal(fx.eurPln(), 4.5);
});

test("awaria NBP zostawia ostatni znany kurs", async () => {
  odpowiedzNBP(4.4);
  await fx.refreshRate(true);
  const przed = fx.eurPln();

  awariaNBP();
  await fx.refreshRate(true);
  assert.equal(fx.eurPln(), przed, "kurs nie może zniknąć tylko dlatego, że NBP nie odpowiada");
});

test("odpowiedź bez kursu jest traktowana jak awaria", async () => {
  odpowiedzNBP(4.4);
  await fx.refreshRate(true);
  const przed = fx.eurPln();

  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ rates: [] }) });
  await fx.refreshRate(true);
  assert.equal(fx.eurPln(), przed);
});

test("błąd HTTP z NBP nie wywraca modułu", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await fx.refreshRate(true); // nie może rzucić
  assert.ok(fx.eurPln() > 0);
});

test("kilka równoległych wyszukiwań to jedno zapytanie do NBP", async () => {
  let wywolania = 0;
  globalThis.fetch = async () => {
    wywolania++;
    await new Promise((r) => setTimeout(r, 30));
    return { ok: true, status: 200, json: async () => ({ rates: [{ no: "1/A", effectiveDate: "2026-07-28", mid: 4.31 }] }) };
  };
  await Promise.all([fx.refreshRate(true), fx.refreshRate(true), fx.refreshRate(true)]);
  assert.equal(wywolania, 1, `NBP odpytany ${wywolania} razy zamiast raz`);
});

test("świeży kurs nie jest pobierany ponownie bez potrzeby", async () => {
  odpowiedzNBP(4.32);
  await fx.refreshRate(true);
  let wywolania = 0;
  globalThis.fetch = async () => { wywolania++; throw new Error("nie powinno pytać"); };
  await fx.refreshRate(); // bez force, kurs jest świeży
  assert.equal(wywolania, 0);
});

test("status kursu podaje komplet informacji dla panelu", async () => {
  odpowiedzNBP(4.3242, "2026-07-28", "144/A/NBP/2026");
  await fx.refreshRate(true);
  const s = fx.fxStatus();
  for (const pole of ["eurPln", "base", "markup", "source", "date", "ageMinutes", "checkedMinutes", "ok"]) {
    assert.ok(pole in s, `brak pola ${pole} w statusie kursu`);
  }
  assert.equal(s.ageMinutes, 0);
});

test("nieudana próba nie odmładza kursu sprzed awarii", async () => {
  // Do 24.08 nieudane pobranie przestawiało znacznik czasu kursu na „teraz",
  // żeby nie dobijać się do NBP co żądanie. Efekt uboczny: ageMinutes pokazywał
  // ~0 min także po wielodniowej awarii NBP, więc panel raportowałby kurs sprzed
  // tygodnia jako pobrany przed chwilą. Konsultant podaje klientowi kwoty
  // policzone tym kursem — status musi mówić, ile te dane naprawdę mają lat.
  odpowiedzNBP(4.4);
  await fx.refreshRate(true);
  const poPobraniu = fx.fxStatus();
  assert.equal(poPobraniu.ok, true, "udane pobranie nie oznaczyło się jako udane");

  // Kurs się starzeje (FX_REFRESH_MS w testach = 50 ms), a NBP przestaje odpowiadać.
  await new Promise((r) => setTimeout(r, 60));
  awariaNBP();
  await fx.refreshRate();

  const poAwarii = fx.fxStatus();
  assert.equal(poAwarii.base, 4.4, "awaria NBP zgubiła ostatni znany kurs");
  assert.equal(poAwarii.ok, false, "awaria NBP nie odznaczyła się w statusie");

  // Sedno: znacznik POBRANIA kursu musi zostać co do milisekundy taki sam.
  // ageMinutes jest tu bezużyteczne (test trwa milisekundy, więc zaokrągla się
  // do 0 w obu przypadkach) — dlatego status podaje surowy znacznik.
  assert.equal(poAwarii.at, poPobraniu.at,
    "nieudana próba przesunęła znacznik wieku kursu — status będzie podawał kurs sprzed dni jako świeży");
  assert.notEqual(poAwarii.checkedAt, poPobraniu.checkedAt,
    "moment ostatniej próby nie został odnotowany — grozi dobijaniem się do NBP co żądanie");
});

test("trwała awaria NBP nie odpytuje serwisu co żądanie", async () => {
  // Rozdzielenie at/checkedAt nie może zgubić throttlingu: to była pierwotna
  // przyczyna, dla której nieudana próba w ogóle dotykała znacznika czasu.
  odpowiedzNBP(4.5);
  await fx.refreshRate(true);
  await new Promise((r) => setTimeout(r, 60));

  let proby = 0;
  globalThis.fetch = async () => { proby++; throw new Error("NBP leży"); };
  await fx.refreshRate();          // ta próba ma pójść do NBP
  await fx.refreshRate();          // te dwie już NIE — świeżo pytaliśmy
  await fx.refreshRate();
  assert.equal(proby, 1, "po nieudanej próbie kod dobija się do NBP przy każdym żądaniu");
});

test("pierwsze żądanie po starcie czeka na kurs, kolejne już nie", async () => {
  // server.js woła refreshRate(true) przy starcie BEZ await (żeby nie opóźniać
  // healthchecku hostingu), więc żądania w pierwszych sekundach po wdrożeniu
  // liczyły ceny w EUR po wartości awaryjnej 4,3 zł — bez śladu na ofercie.
  // ensureRate() zamyka to okno, ale tylko dla pierwszego pytania w życiu
  // procesu: przy leżącym NBP nie może zamienić się w zastój na każdym żądaniu.
  const swiezy = await import(`../src/fx.js?ensure=${Date.now()}`);

  let wywolania = 0;
  globalThis.fetch = async () => {
    wywolania++;
    return {
      ok: true, status: 200,
      json: async () => ({ rates: [{ no: "1/A", effectiveDate: "2026-08-24", mid: 4.31 }] }),
    };
  };

  // Świeży moduł = stan jak tuż po starcie procesu: kurs awaryjny, zero pytań.
  assert.equal(swiezy.fxStatus().source, "awaryjny", "świeży moduł nie startuje z kursu awaryjnego");
  await swiezy.ensureRate();
  assert.equal(wywolania, 1, "pierwsze żądanie nie poczekało na kurs — cena poleci po wartości awaryjnej");
  assert.equal(swiezy.fxStatus().base, 4.31, "kurs nie został pobrany przed policzeniem ceny");

  await swiezy.ensureRate();
  await swiezy.ensureRate();
  assert.equal(wywolania, 1, "kolejne żądania też czekają na NBP — to zastój na każdym wyszukiwaniu");
});

test("leżące NBP nie blokuje każdego kolejnego wyszukiwania", async () => {
  const swiezy = await import(`../src/fx.js?awaria=${Date.now()}`);
  let wywolania = 0;
  globalThis.fetch = async () => { wywolania++; throw new Error("NBP leży"); };

  await swiezy.ensureRate();   // jedna próba wolno
  await swiezy.ensureRate();   // ale nie kolejne
  await swiezy.ensureRate();
  assert.equal(wywolania, 1,
    "przy awarii NBP każde wyszukiwanie czeka na timeout — konsultant siedzi przed pustą listą");
  assert.equal(swiezy.fxStatus().base, 4.3, "przy awarii nie został kurs awaryjny");
});

test("wyszukiwanie faktycznie czeka na ensureRate", async () => {
  // Sam ensureRate() nic nie daje, jeśli /api/search go nie awaituje — a to
  // dokładnie ten błąd, który naprawiamy (refreshRate wołane bez await).
  // Testujemy źródło, bo cały sens jest w obecności słowa `await`.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const zrodlo = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "server.js"), "utf8");

  assert.match(zrodlo, /await ensureRate\(\);/,
    "/api/search nie czeka na kurs — pierwsze żądanie po restarcie policzy ceny w EUR po wartości awaryjnej");
  assert.ok(!/^\s*refreshRate\(\);\s*$/m.test(zrodlo),
    "w server.js został gołe refreshRate() bez await — wraca ciche liczenie po kursie awaryjnym");
});
