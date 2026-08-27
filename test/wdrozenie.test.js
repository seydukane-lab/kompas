// ============================================================
//  Skrypt wdrożenia nie może wygadać sekretu
//
//  Adres deploy hooka to poświadczenie: kto go ma, ten wdraża produkcję.
//  Klucz API wyciekł już raz do zapisu rozmowy i trzeba go było wymieniać —
//  dlatego skrypt ma go nigdzie nie wypisywać, także w komunikacie błędu,
//  gdzie najłatwiej o to przez odruchowe `console.error(url)` albo
//  wypisanie treści odpowiedzi serwera.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKRYPT = join(ROOT, "scripts", "wdroz.mjs");

test("adres hooka nie trafia do żadnego wypisu", () => {
  const kod = readFileSync(SKRYPT, "utf8");

  // Wypisy budowane z zmiennej `hook` — w każdej postaci, także w szablonie.
  const wypisy = [...kod.matchAll(/console\.(log|error)\(([\s\S]*?)\);/g)].map((m) => m[2]);
  // Szukamy WSTAWIENIA wartości, nie słowa „hook" — to samo słowo występuje
  // w polskiej treści komunikatu („hook został przegenerowany") i pierwsza wersja
  // tego testu blokowała własną dokumentację zamiast wycieku.
  const wstawienie = new RegExp("\\$\\{\\s*hook\\b|\\+\\s*hook\\b|\\bhook\\s*\\+|,\\s*hook\\s*[,)]");
  for (const w of wypisy) {
    assert.ok(!wstawienie.test(w),
      `wypis wstawia wartość zmiennej hook — adres wdrożenia trafi do logu i do zapisu rozmowy: ${w.slice(0, 80)}`);
  }

  // Kontrola, że sam wzorzec działa — inaczej asercja wyżej przechodziłaby zawsze.
  assert.ok(wstawienie.test("console.log(`adres: ${hook}`)"),
    "wzorzec nie wykrywa nawet jawnego wstawienia — asercja wyżej niczego nie pilnuje");

  // Treść odpowiedzi Rendera też potrafi nieść klucz, więc nie odbijamy jej do konsoli.
  assert.ok(!/await r\.text\(\)|r\.body/.test(kod),
    "skrypt odbija odpowiedź serwera do konsoli — tam też potrafi siedzieć klucz");
});

test("bez skonfigurowanego hooka skrypt mówi, czego brakuje, i nie wdraża", () => {
  // Katalog bez .env — tak wygląda świeży klon.
  const r = spawnSync(process.execPath, [SKRYPT], {
    cwd: tmpdir(), encoding: "utf8",
    env: { ...process.env, RENDER_DEPLOY_HOOK: "" },
  });

  assert.equal(r.status, 2, `oczekiwano kodu 2 (brak konfiguracji), dostałem ${r.status}`);
  assert.match(r.stderr, /RENDER_DEPLOY_HOOK/,
    "komunikat nie mówi, której zmiennej brakuje");
  assert.match(r.stderr, /Deploy Hooks/,
    "komunikat nie mówi, GDZIE ten adres zdobyć — bez tego jest bezużyteczny");
});
