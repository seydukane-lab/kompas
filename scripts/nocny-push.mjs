// ============================================================
//  Bezpieczny push pracy nocnego — `npm run nocny-push`
//
//  Po co to istnieje: nocny agent pracuje w kontenerze, który znika po sesji.
//  Do 06.09.2026 nie miał prawa pushu (403 celowe), więc jego commity przepadały
//  razem z kontenerem — trzy razy odtwarzałem jego pracę z opisu w raporcie,
//  a raz cała jego sesja poszła na napisanie drugi raz czegoś, co już istniało.
//
//  Ten skrypt daje mu jedną drogę wyjścia i pilnuje zasad, na których nam zależy:
//
//   1. NIGDY na `main`. Gałąź docelowa to zawsze `nightwork-RRRR-MM-DD`. Nawet gdy
//      instrukcja agenta się rozjedzie albo ktoś ją nadpisze, skrypt odmówi.
//   2. Nic nie nadpisuje. Push bez `--force`, na świeżą gałąź per noc — historia
//      człowieka jest nietykalna.
//   3. Odmawia, gdy testy są czerwone. Gałąź z pracą nocnego ma być czymś, co da
//      się przejrzeć rano, a nie zagadką „czy to w ogóle działało".
//   4. Odmawia, gdy nie ma czego wypchnąć — pusta gałąź to szum w liście gałęzi.
//
//  Token: fine-grained, TYLKO to repo, uprawnienie Contents: Read and write.
//  Trafia do zmiennej GITHUB_TOKEN w konfiguracji agenta w chmurze i nigdzie
//  indziej. Skrypt go NIE wypisuje — ani w logu, ani w komunikacie błędu.
// ============================================================

import { execSync, spawnSync } from "node:child_process";

const git = (cmd, opcje = {}) =>
  execSync(`git ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opcje }).trim();

function przerwij(powod, wskazowka) {
  console.error(`\n✖ NIE PUSZCZAM: ${powod}`);
  if (wskazowka) console.error(wskazowka);
  console.error("");
  process.exit(1);
}

// --- 1. Na jakiej gałęzi jesteśmy i czy wolno ---------------------------------
let biezaca;
try {
  biezaca = git("rev-parse --abbrev-ref HEAD");
} catch {
  przerwij("nie umiem odczytać bieżącej gałęzi — czy to na pewno repozytorium git?");
}

if (biezaca === "main" || biezaca === "master") {
  przerwij(
    `jesteś na „${biezaca}" — praca nocnego NIGDY nie idzie na główną gałąź.`,
    "Przełącz się na własną gałąź: git checkout -B nightwork origin/main",
  );
}

// --- 2. Czy jest co wypychać --------------------------------------------------
git("fetch -q origin");
const nowe = git("rev-list --count origin/main..HEAD");
if (Number(nowe) === 0) {
  przerwij(
    "brak commitów ponad origin/main — nie ma czego wypchnąć.",
    "To normalne, gdy noc zeszła na pomiar albo sprawdzenie. Wystarczy raport.",
  );
}

const brudne = git("status --porcelain");
if (brudne) {
  przerwij(
    "w drzewie roboczym są niezacommitowane zmiany.",
    "Zacommituj je albo wycofaj — wypychamy stan opisany w commitach, nie półprodukt:\n" + brudne,
  );
}

// --- 3. Testy MUSZĄ być zielone ----------------------------------------------
console.log("\nSprawdzam testy przed pushem…");
const testy = spawnSync(process.execPath, ["--test"], { encoding: "utf8", cwd: process.cwd() });
const wynik = (testy.stdout || "") + (testy.stderr || "");
// Node wypisuje podsumowanie raz w formacie TAP („# fail 0"), raz z symbolem
// („ℹ fail 0") — zależnie od wersji i tego, czy wyjście idzie na terminal.
// Bierzemy oba: nieodczytany wynik znaczy tu „nie wypycham", więc pomyłka
// we wzorcu zablokowałaby nocnego na głucho.
const bledne = Number((wynik.match(/^[#ℹ]\s*fail (\d+)\s*$/m) || wynik.match(/fail (\d+)/) || [])[1] ?? -1);
if (bledne < 0) przerwij("nie umiem odczytać wyniku testów — nie wypycham w ciemno.");
if (bledne > 0) {
  przerwij(
    `testy są czerwone (${bledne}).`,
    "Gałąź nocnego ma dać się przejrzeć rano bez zgadywania, czy to działało. Napraw albo opisz w raporcie i nie pushuj.",
  );
}
console.log(`   testy zielone (0 czerwonych) ✓`);

// --- 4. Nazwa gałęzi zdalnej: jedna na noc -----------------------------------
// Data z DZIŚ, bo nocna sesja kończy się nad ranem — dzięki temu gałąź nazywa się
// tak, jak dzień, w którym człowiek ją zobaczy.
const dzien = new Date().toISOString().slice(0, 10);
const zdalna = `nightwork-${dzien}`;

console.log(`   commitów do wypchnięcia: ${nowe}`);
console.log(`   gałąź docelowa: ${zdalna}\n`);

// Bez --force i bez --set-upstream: nic nie nadpisujemy i niczego nie przestawiamy.
const push = spawnSync("git", ["push", "origin", `HEAD:refs/heads/${zdalna}`], { encoding: "utf8" });
if (push.status !== 0) {
  // Komunikat gita bywa długi, ale NIE zawiera tokenu — mimo to przycinamy,
  // żeby przypadkowy adres z poświadczeniem nie wylądował w raporcie.
  const tresc = ((push.stderr || "") + (push.stdout || "")).replace(/https:\/\/[^@\s]+@/g, "https://***@");
  if (/403|denied|not authorized|Repository not found/i.test(tresc)) {
    przerwij(
      "GitHub odrzucił push (brak uprawnień).",
      "Sprawdź, czy w konfiguracji agenta jest GITHUB_TOKEN: fine-grained, to repo,\n" +
      "uprawnienie „Contents: Read and write\". Nie wklejaj tokenu do raportu ani do repo.",
    );
  }
  przerwij("push się nie powiódł.", tresc.slice(-600));
}

console.log(`✔ Wypchnięte: ${zdalna} (${nowe} commitów)`);
console.log(`   Rano: git fetch && git log --oneline origin/main..origin/${zdalna}`);
console.log(`   Scalenie po przejrzeniu: git cherry-pick albo git merge origin/${zdalna}\n`);
