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

// ============================================================
//  Bezpieczny push nocnego (npm run nocny-push)
//
//  Nocny agent pracuje w kontenerze, ktory znika po sesji. Od 06.09.2026 ma prawo
//  pushu, ale JEDNA droga i na wlasna galaz — jego commity maja czekac na przejrzenie,
//  a nie ladowac na main. Te testy pilnuja zabezpieczen, bo skrypt uruchamia sie
//  wylacznie w chmurze i nikt nie zobaczy, gdy ktos je po cichu usunie.
// ============================================================

test("skrypt pushu nocnego odmawia na glownej galezi", () => {
  const kod = readFileSync(join(ROOT, "scripts/nocny-push.mjs"), "utf8");
  assert.match(kod, /biezaca === "main" \|\| biezaca === "master"/,
    "brak zabezpieczenia przed pushem na main — praca nocnego moglaby wyladowac na glownej galezi");
  assert.match(kod, /nightwork-\$\{dzien\}|nightwork-/, "galaz docelowa nie jest wlasna galezia nocnego");
});

test("skrypt pushu nocnego nie nadpisuje historii i nie pcha w ciemno", () => {
  const kod = readFileSync(join(ROOT, "scripts/nocny-push.mjs"), "utf8");
  // Komentarze odcinamy: opisuja, ze pushujemy BEZ --force, wiec dopasowanie do calego
  // pliku lapaloby wlasny komentarz zamiast realnego wywolania.
  const bezKomentarzy = kod.split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(bezKomentarzy, /--force/, "push z wymuszeniem — historia czlowieka przestaje byc nietykalna");
  assert.match(kod, /bledne > 0/, "brak odmowy przy czerwonych testach");
  assert.match(kod, /status --porcelain/, "brak sprawdzenia, czy drzewo robocze jest czyste");
});

test("skrypt pushu nocnego nie wypisuje tokenu", () => {
  // Komunikat gita potrafi zawierac adres z poswiadczeniem. Raport nocnego trafia
  // do rozmowy, wiec token nie ma prawa sie tam znalezc.
  const kod = readFileSync(join(ROOT, "scripts/nocny-push.mjs"), "utf8");
  assert.ok(kod.includes('"https://***@"'), "brak maskowania adresu z poswiadczeniem w komunikacie bledu");
  assert.doesNotMatch(kod, /console\.(log|error)\([^)]*GITHUB_TOKEN/, "skrypt wypisuje token");
});

test("nocny ma instrukcje i kolejke zadan w repo", () => {
  // Agent startuje z czystego klonu i nie pamieta poprzednich nocy — jesli zadania
  // sa tylko w konfiguracji w chmurze, to on ich nie widzi, a my nie mamy jak ich
  // zmienic bez wchodzenia do panelu. Dlatego oba pliki leza w repozytorium.
  const instrukcja = readFileSync(join(ROOT, "docs/nocny-instrukcja.md"), "utf8");
  const kolejka = readFileSync(join(ROOT, "docs/nocny-kolejka.md"), "utf8");

  assert.match(instrukcja, /npm run nocny-push/, "instrukcja nie mowi, jak wypchnac prace");
  assert.match(instrukcja, /nigdy na `main`|NIGDY na `main`|nigdy na .main./i, "instrukcja nie zabrania pushu na main");
  assert.match(instrukcja, /npm run sabotaz/, "instrukcja nie wymaga sabotazu przy nowych testach");
  assert.ok((kolejka.match(/^## \d+\./gm) || []).length >= 5,
    "kolejka ma mniej niz piec zadan — to za malo na tydzien bez wlasciciela");
  assert.match(kolejka, /ZROBIONE/, "brak sposobu oznaczania zadan jako wykonane");
});
