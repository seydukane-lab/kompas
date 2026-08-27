// ============================================================
//  Wdrożenie produkcji jedną komendą — `npm run wdroz`
//
//  Auto-deploy na Renderze jest WYŁĄCZONY i ma taki zostać: to on chroni
//  produkcję przed każdym commitem, który trafia na main w nocy. Ten skrypt
//  niczego w tym nie zmienia — jest ręcznym spustem, tyle że z konsoli
//  zamiast z panelu, bo klikanie w panelu kończyło się produkcją stojącą
//  po kilkanaście commitów wstecz.
//
//  Adres hooka to SEKRET klasy „kto go ma, ten wdraża". Siedzi w .env
//  (gitignorowanym) i nie jest tu nigdzie wypisywany — ani w logu, ani przy
//  błędzie. Klucz API wyciekł już raz do transkryptu rozmowy i trzeba go było
//  wymieniać; ten sam błąd drugi raz jest do uniknięcia.
// ============================================================

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ADRES = process.env.KOMPAS_URL || "https://kompas-2tax.onrender.com";

function hookZEnv() {
  if (process.env.RENDER_DEPLOY_HOOK) return process.env.RENDER_DEPLOY_HOOK.trim();
  try {
    const linia = readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith("RENDER_DEPLOY_HOOK="));
    return linia ? linia.slice(linia.indexOf("=") + 1).trim() : "";
  } catch {
    return "";
  }
}

const hook = hookZEnv();
if (!hook) {
  console.error(`
Brak RENDER_DEPLOY_HOOK w .env — nie ma czym wdrożyć.

Jak go zdobyć (2 minuty, robisz to sam — ten adres nie ma przechodzić
przez czyjekolwiek ręce ani przez zapis rozmowy):

  1. dashboard.render.com → usługa "kompas" → Settings
  2. zjedź na dół do sekcji "Deploy Hooks", skopiuj adres
  3. wklej go do .env jako jedną linię:

     RENDER_DEPLOY_HOOK=<wklejony adres>

Gdyby kiedykolwiek wyciekł — w tym samym miejscu jest "Regenerate Hook".
`);
  process.exit(2);
}

// Co realnie pojedzie na produkcję: hook wdraża czubek gałęzi podpiętej
// w Renderze, więc lokalne commity bez pusha NIE trafią tam mimo zielonego
// komunikatu. Lepiej powiedzieć to przed, niż tłumaczyć po.
let lokalny = "?", zdalny = "?";
try {
  lokalny = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  execSync("git fetch -q origin", { stdio: "ignore" });
  zdalny = execSync("git rev-parse --short origin/main", { encoding: "utf8" }).trim();
} catch { /* brak gita nie jest powodem, żeby blokować wdrożenie */ }

if (lokalny !== "?" && lokalny !== zdalny) {
  console.error(`\n⚠ HEAD (${lokalny}) różni się od origin/main (${zdalny}).`);
  console.error("Render wdraża to, co jest na origin — wypchnij zmiany albo wdrażasz nie to, co myślisz.\n");
  process.exit(3);
}

console.log(`\nWdrażam ${zdalny} na ${ADRES} …`);

const r = await fetch(hook, { method: "POST" });
if (!r.ok) {
  // Bez treści odpowiedzi i bez adresu — w obu potrafi siedzieć klucz.
  console.error(`\n✖ Render odrzucił żądanie (HTTP ${r.status}).`);
  console.error("Najczęstszy powód: hook został przegenerowany, a .env ma stary.\n");
  process.exit(1);
}

console.log(`
✔ Wdrożenie zlecone.

To NIE znaczy jeszcze, że kod jest na produkcji — wdrożenie potrafi paść już
po zleceniu. Sprawdzenie (build trwa zwykle 1-3 min):

  curl -s ${ADRES}/healthz

Pole "wersja" ma pokazać ${zdalny}. Jeśli pokazuje starszy hash, wdrożenie
jeszcze trwa albo się nie powiodło; jeśli pola nie ma w ogóle, produkcja jest
starsza niż commit 2af085e.
`);
