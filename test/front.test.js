// ============================================================
//  Składnia i higiena frontu
//
//  Cały panel to jeden plik z wielkim inline'owym skryptem. Pojedynczy zły
//  cudzysłów wywalił już kiedyś CAŁĄ stronę przy zdrowym backendzie — i żaden
//  test serwera tego nie widzi, bo serwer działa bez zarzutu, tylko przeglądarka
//  nie umie wykonać skryptu. Ten plik zamyka tę dziurę.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRONY = ["public/index.html", "public/login.html", "public/o-serwisie.html"];

function wczytaj(plik) {
  return readFileSync(join(ROOT, plik), "utf8");
}

function skrypty(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

test("inline'owe skrypty na każdej stronie są poprawne składniowo", () => {
  const dir = mkdtempSync(join(tmpdir(), "kompas-front-"));
  try {
    for (const plik of STRONY) {
      const bloki = skrypty(wczytaj(plik));
      for (const [i, kod] of bloki.entries()) {
        const sciezka = join(dir, `${plik.replace(/[\/.]/g, "_")}_${i}.js`);
        writeFileSync(sciezka, kod, "utf8");
        try {
          execFileSync(process.execPath, ["--check", sciezka], { stdio: "pipe" });
        } catch (err) {
          const opis = (err.stderr || Buffer.from("")).toString().split("\n").slice(0, 6).join("\n");
          assert.fail(`błąd składni w ${plik}, blok ${i + 1}:\n${opis}`);
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("każda strona ma dokładnie tyle otwarć co zamknięć tagu script", () => {
  for (const plik of STRONY) {
    const html = wczytaj(plik);
    const otwarcia = (html.match(/<script[\s>]/g) || []).length;
    const zamkniecia = (html.match(/<\/script>/g) || []).length;
    assert.equal(otwarcia, zamkniecia, `${plik}: ${otwarcia} otwarć i ${zamkniecia} zamknięć`);
  }
});

test("reguła chroniąca atrybut hidden nie zniknęła", () => {
  // Element z atrybutem `hidden` ORAZ regułą display:flex/grid jest widoczny
  // mimo hidden — ta pułapka wystąpiła w tym projekcie już dwa razy
  // (rozwijane regiony, modal porównywarki). Globalna reguła to naprawia.
  const html = wczytaj("public/index.html");
  assert.match(html, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/,
    "brak globalnej reguły [hidden]{display:none!important} — modale zaczną się pokazywać same");
});

test("panel nie odwołuje się do zewnętrznych skryptów", () => {
  // Panel ma działać w biurze bez zależności od cudzych serwerów — i bez
  // wysyłania czegokolwiek o ofertach klienta na zewnątrz.
  for (const plik of STRONY) {
    const html = wczytaj(plik);
    const zewnetrzne = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map((m) => m[1]);
    const obce = zewnetrzne.filter((s) => /^https?:\/\//.test(s));
    assert.deepEqual(obce, [], `${plik} ładuje obce skrypty: ${obce.join(", ")}`);
  }
});

test("front woła API przez wrapper obsługujący wygaśnięcie sesji", () => {
  // Gołe fetch("/api/...") ominęłoby przekierowanie na ekran logowania i przy
  // wygasłej sesji konsultant zobaczyłby po prostu „nic się nie dzieje".
  const html = wczytaj("public/index.html");
  const gole = [...html.matchAll(/fetch\("\/api\/([a-z/-]+)/g)].map((m) => m[1]);
  const dozwolone = gole.filter((s) => s.startsWith("auth/"));
  assert.deepEqual(
    gole.filter((s) => !dozwolone.includes(s)),
    [],
    "znaleziono gołe fetch do /api poza endpointami logowania — użyj api()"
  );
});

test("ekran logowania nie zdradza, czy konto istnieje", () => {
  const html = wczytaj("public/login.html");
  assert.ok(!/nie ma takiego konta|konto nie istnieje|nieprawid[łl]owy login/i.test(html),
    "komunikat rozróżniający zły login od złego hasła ułatwia zgadywanie kont");
});

test("strona „O serwisie” nie obiecuje prowizji ani afiliacji", () => {
  // Po odmowie TravelLead (28.07.2026) Kompas nie jest serwisem afiliacyjnym.
  // Deklaracja o prowizji byłaby nieprawdziwa i szkodziłaby rozmowie w firmie.
  const html = wczytaj("public/o-serwisie.html");
  assert.ok(!/prowizj/i.test(html), "strona nadal deklaruje prowizję za polecenie");
});
