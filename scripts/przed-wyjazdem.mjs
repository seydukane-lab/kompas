// ============================================================
//  Przygotowanie na tydzień bez właściciela — `npm run przed-wyjazdem`
//
//  Otwiera dokładnie te strony, na których trzeba coś kliknąć, sprawdza co jest
//  już zrobione i wypisuje gotowe teksty do wklejenia. Nic nie robi za człowieka
//  tam, gdzie w grę wchodzą sekrety — token i deploy hook mają nie przechodzić
//  przez kod ani przez zapis rozmowy.
// ============================================================

import { readFileSync, existsSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";

const otworz = (url) => {
  // `start` na Windows, `open` na macOS, `xdg-open` na Linuksie — puszczone
  // „na odczepnego": nieudane otwarcie przeglądarki nie ma zatrzymać reszty listy.
  try {
    if (process.platform === "win32") spawnSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
    else if (process.platform === "darwin") spawnSync("open", [url], { stdio: "ignore" });
    else spawnSync("xdg-open", [url], { stdio: "ignore" });
  } catch { /* trudno — adres i tak jest wypisany niżej */ }
};

const env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
const maHook = /^RENDER_DEPLOY_HOOK=.+/m.test(env);

let zakresyGh = "";
try {
  zakresyGh = execSync("gh auth status", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch { /* brak gh albo brak logowania — traktujemy jak brak zakresu */ }
const maWorkflow = /Token scopes:.*workflow/.test(zakresyGh);

let produkcja = "";
try {
  produkcja = execSync("node scripts/produkcja.mjs", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) { produkcja = (e.stdout || "") + ""; }
const zaProdukcja = (produkcja.match(/NIE MA (\d+) commit/) || [])[1] || "?";

const kreska = "─".repeat(64);
console.log(`\n${kreska}\n  PRZED WYJAZDEM — otwieram strony, resztę robisz klikając\n${kreska}`);

// --- 1. Token dla nocnego (jedyna rzecz KONIECZNA) ---------------------------
console.log(`
1. TOKEN DLA NOCNEGO  ← bez tego jego tydzień pracy przepadnie

   Otwieram: github.com/settings/personal-access-tokens/new

   Ustaw w formularzu:
     • Token name:        kompas-nocny
     • Expiration:        30 days
     • Repository access: Only select repositories → seydukane-lab/kompas
     • Permissions → Repository permissions → Contents → Read and write
       (reszta zostaje na "No access")

   Potem: Generate token → skopiuj → wklej w konfiguracji nocnego
   w chmurze jako zmienną  GITHUB_TOKEN`);
otworz("https://github.com/settings/personal-access-tokens/new");

// --- 2. Tekst do instrukcji nocnego ------------------------------------------
console.log(`
2. JEDNO ZDANIE DO INSTRUKCJI NOCNEGO (skopiuj poniższe trzy linie)
${kreska}
Zadanie na dziś bierz z docs/nocny-kolejka.md — pierwsza pozycja bez [ZROBIONE].
Zasady pracy: docs/nocny-instrukcja.md.
Na koniec, jeśli masz commity, uruchom: npm run nocny-push
${kreska}
   Dzięki temu przez cały tydzień nie musisz wracać do panelu — kolejka
   siedzi w repo i to ją nocny czyta.`);

// --- 3. Deploy hook (opcjonalny, ale skoro już siedzisz w ustawieniach) ------
if (maHook) {
  console.log(`\n3. DEPLOY HOOK — ✔ już jest w .env, nic nie robisz.
   Produkcja jest ${zaProdukcja} commitów w tyle; wdrożenie: npm run wdroz`);
} else {
  console.log(`
3. DEPLOY HOOK (opcjonalny) — produkcja jest ${zaProdukcja} commitów w tyle

   Otwieram panel Render → Settings. Zjedź na dół do "Deploy Hooks",
   skopiuj adres i wklej do .env jako jedną linię:

     RENDER_DEPLOY_HOOK=<wklejony adres>

   Potem wdrożenie to jedna komenda: npm run wdroz`);
  otworz("https://dashboard.render.com/web/srv-d9eqc4ernols73eoelj0/settings");
}

// --- 4. Zakres workflow dla gh (opcjonalny) ----------------------------------
if (maWorkflow) {
  console.log(`\n4. ZAKRES workflow — ✔ token gh już go ma.
   Zostało wciągnąć commit CI:  git cherry-pick ci-czeka-na-token; git push origin main`);
} else {
  console.log(`
4. ZAKRES workflow DLA gh (opcjonalny) — odblokowuje ostatni commit CI

   W tym oknie wpisz z wykrzyknikiem (otworzy się przeglądarka z kodem):

     ! gh auth refresh -h github.com -s workflow

   Potem:
     git cherry-pick ci-czeka-na-token
     git push origin main
     git branch -D ci-czeka-na-token`);
}

console.log(`
${kreska}
  Po powrocie:  git fetch  →  gałęzie nightwork-RRRR-MM-DD, jedna na noc.
  Na main nic nie wejdzie samo — skrypt pushu tego pilnuje.
${kreska}\n`);
