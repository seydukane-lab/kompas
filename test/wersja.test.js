// ============================================================
//  Wersja kodu pod danym adresem
//
//  Auto-deploy jest wyłączony celowo, więc push na main NIE jest wdrożeniem.
//  „Co widać na produkcji" i „co jest w repo" rozjechały się już raz kosztownie
//  (29.07.2026 — mail do partnera opierał się na zachowaniu publicznego adresu,
//  który serwował wersję sprzed tygodnia). Ten moduł zamyka tę dziurę, więc jego
//  najważniejsza własność to NIE ZGADYWAĆ: lepiej powiedzieć „nie wiem" niż podać
//  wersję, na podstawie której ktoś ogłosi, że poprawka jest już u konsultanta.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wersjaKodu } from "../src/wersja.js";

const PELNY = "a3044de1c2b3a4958677f0d3fdf32efce5b0bf7";

test("hash od hostingu wygrywa i jest skracany", () => {
  assert.equal(wersjaKodu({ RENDER_GIT_COMMIT: PELNY }), "a3044de",
    "wersja z Rendera nie została odczytana — produkcja przestanie mówić, co na niej stoi");
  // Inne hostingi nazywają to inaczej; kolejność jest deterministyczna.
  assert.equal(wersjaKodu({ GIT_COMMIT: PELNY }), "a3044de");
  assert.equal(wersjaKodu({ SOURCE_VERSION: PELNY }), "a3044de");
});

test("brak wiedzy o wersji zwraca null, a nie zmyśloną nazwę", () => {
  // Katalog bez .git — tak wygląda wdrożenie z archiwum.
  const pusty = mkdtempSync(join(tmpdir(), "kompas-wersja-"));
  try {
    assert.equal(wersjaKodu({}, pusty), null,
      "brak informacji o wersji zamienił się w jakąś wartość — panel zacznie twierdzić coś, czego nie wie");
  } finally {
    rmSync(pusty, { recursive: true, force: true });
  }
  // Pusta zmienna to też brak wiedzy, nie pusty string udający hash.
  const pustyKatalog = mkdtempSync(join(tmpdir(), "kompas-wersja2-"));
  try {
    assert.equal(wersjaKodu({ RENDER_GIT_COMMIT: "   " }, pustyKatalog), null,
      "pusta zmienna środowiskowa przeszła jako wersja");
  } finally {
    rmSync(pustyKatalog, { recursive: true, force: true });
  }
});

test("lokalnie czyta .git/HEAD w obu realnych postaciach", () => {
  // Postać 1: gałąź. Tak wygląda maszyna właściciela.
  const naGalezi = mkdtempSync(join(tmpdir(), "kompas-galaz-"));
  try {
    mkdirSync(join(naGalezi, ".git", "refs", "heads"), { recursive: true });
    writeFileSync(join(naGalezi, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(naGalezi, ".git", "refs", "heads", "main"), PELNY + "\n");
    assert.equal(wersjaKodu({}, naGalezi), "a3044de",
      "nie odczytano hasha z gałęzi — lokalny start przestanie raportować wersję");
  } finally {
    rmSync(naGalezi, { recursive: true, force: true });
  }

  // Postać 2: odłączony HEAD. Tak startuje kontener nocnego agenta — gdyby ta
  // gałąź nie działała, jego raporty mówiłyby „wersja nieznana" bez powodu.
  const odlaczony = mkdtempSync(join(tmpdir(), "kompas-odlaczony-"));
  try {
    mkdirSync(join(odlaczony, ".git"), { recursive: true });
    writeFileSync(join(odlaczony, ".git", "HEAD"), PELNY + "\n");
    assert.equal(wersjaKodu({}, odlaczony), "a3044de",
      "odłączony HEAD nie został rozpoznany — kontener nocnego nie poda wersji");
  } finally {
    rmSync(odlaczony, { recursive: true, force: true });
  }
});

test("uszkodzony wskaźnik gałęzi nie wywraca serwera", () => {
  // HEAD wskazuje na plik, którego nie ma. Serwer ma wtedy powiedzieć „nie wiem",
  // a nie przewrócić się na starcie — /healthz jest sondą żywotności hostingu.
  const zepsuty = mkdtempSync(join(tmpdir(), "kompas-zepsuty-"));
  try {
    mkdirSync(join(zepsuty, ".git"), { recursive: true });
    writeFileSync(join(zepsuty, ".git", "HEAD"), "ref: refs/heads/nie-ma-takiej\n");
    assert.equal(wersjaKodu({}, zepsuty), null, "uszkodzony HEAD powinien dać null");
  } finally {
    rmSync(zepsuty, { recursive: true, force: true });
  }
});

test("wersja jest zamrożona przy starcie, nie czytana przy każdym żądaniu", () => {
  // Wpadka z 28.08.2026: lokalny serwer chodził blisko trzy godziny, a /healthz
  // podawał hash commita zrobionego minutę wcześniej — bo `.git/HEAD` czytany przy
  // każdym żądaniu mówi, co jest W REPO, a nie co wykonuje proces. Endpoint mający
  // chronić przed pomyłką co do wdrożonej wersji sam zaczynał kłamać, i to zawsze
  // na korzyść najnowszego kodu, czyli w stronę „poprawka już działa".
  //
  // Test MUSI iść przez osobny proces z własnym katalogiem: w tym samym procesie
  // ponowny odczyt zwraca tę samą wartość, więc różnicy nie widać i sabotaż
  // (powrót do liczenia na żądanie) przechodzi. Pierwsza wersja tego testu
  // właśnie tak przeszła obok — wyglądała mocno i nie sprawdzała niczego.
  const A = "aaaaaaa1111111111111111111111111111111111";
  const B = "bbbbbbb2222222222222222222222222222222222";
  const dir = mkdtempSync(join(tmpdir(), "kompas-zamrozona-"));
  try {
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git", "HEAD"), A + "\n");

    const modul = pathToFileURL(join(ROOT, "src", "wersja.js")).href;
    const skrypt =
      `const { wersjaUruchomienia, wersjaKodu } = await import(${JSON.stringify(modul)});` +
      `const przed = wersjaUruchomienia();` +
      `require("fs").writeFileSync(".git/HEAD", ${JSON.stringify(B)});` +
      `console.log(JSON.stringify({ przed, po: wersjaUruchomienia(), swiezy: wersjaKodu() }));`;

    const r = spawnSync(process.execPath, ["--input-type=module", "-e",
      `const require = (await import("node:module")).createRequire(import.meta.url);` + skrypt],
      { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, `proces potomny padł: ${r.stderr}`);
    const d = JSON.parse(r.stdout.trim());

    assert.equal(d.przed, "aaaaaaa", "moduł nie odczytał wersji przy starcie");
    assert.equal(d.po, "aaaaaaa",
      "wersja zmieniła się w trakcie życia procesu — /healthz zacznie raportować stan repo zamiast uruchomionego kodu");
    // Kontrola, że plik NAPRAWDĘ się zmienił — inaczej test przechodziłby przez
    // nieudaną podmianę, a nie przez zamrożenie wartości.
    assert.equal(d.swiezy, "bbbbbbb",
      "podmiana .git/HEAD nie zaszła, więc test niczego nie dowodzi");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
