// ============================================================
//  Kontrolowany sabotaż — `npm run sabotaz`
//
//  Psuje JEDNO miejsce w kodzie, uruchamia testy i sprawdza, czy któryś spadł.
//  Potem przywraca plik i potwierdza, że repo wróciło do stanu wyjściowego.
//
//  Po co osobne narzędzie na coś, co robiłem ręcznie: sabotaż jest jedynym
//  dowodem, że test czegokolwiek pilnuje, a sabotaż, który CICHO NIE ZASZEDŁ,
//  wygląda identycznie jak sukces — zielone testy i spokojne sumienie. Zdarzyło
//  się to w tym projekcie kilka razy: raz przez gołe `\n` we wzorcu przy pliku
//  z CRLF (całe repo jest edytowane na Windows), raz przez wzorzec, który po
//  prostu nie trafił. Za każdym razem wynik wyglądał na potwierdzenie.
//
//  Dlatego ten skrypt ODMAWIA startu, gdy wzorzec nie występuje albo występuje
//  kilka razy, i potwierdza podmianę odczytem Z DYSKU, zanim uruchomi testy.
//  Reguły: src/sabotaz.js.
//
//  Użycie:
//    npm run sabotaz -- --plik src/ranking.js --z "A === B" --na "true"
//    npm run sabotaz -- --plik src/x.js --z "..." --na "..." --test test/x.test.js
//
//  Kody wyjścia: 0 = sabotaż złapany (dobrze), 1 = przeszedł niezauważony,
//  2 = nie dało się przeprowadzić (wzorzec, przywracanie, czerwone repo).
// ============================================================

import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { przygotujPodmiane, potwierdzPodmiane, werdykt } from "../src/sabotaz.js";

function argi(lista) {
  const out = {};
  for (let i = 0; i < lista.length; i++) {
    if (!lista[i].startsWith("--")) continue;
    out[lista[i].slice(2)] = lista[i + 1] && !lista[i + 1].startsWith("--") ? lista[++i] : true;
  }
  return out;
}

const a = argi(process.argv.slice(2));
if (!a.plik || !a.z || !a.na) {
  console.error(`
Kontrolowany sabotaż — psuje jedno miejsce i sprawdza, czy testy to złapią.

  npm run sabotaz -- --plik <ścieżka> --z "<fragment>" --na "<zamiennik>" [--test <plik>]

  --plik   plik do zepsucia (przywracany na koniec)
  --z      fragment, który ma zniknąć — musi występować DOKŁADNIE RAZ
  --na     czym go zastąpić
  --test   ograniczenie do jednego pliku testów (domyślnie: całe npm test)

Przykład:
  npm run sabotaz -- --plik src/ranking.js --z "v.departDate < from" --na "false"
`);
  process.exit(2);
}

const PLIK = String(a.plik);
const KOPIA = PLIK + ".sabotaz-kopia";
if (!existsSync(PLIK)) { console.error(`\n✖ Nie ma pliku ${PLIK}\n`); process.exit(2); }
if (existsSync(KOPIA)) {
  console.error(`\n✖ Istnieje ${KOPIA} — poprzedni przebieg nie posprzątał.`);
  console.error("Sprawdź zawartość, przywróć plik ręcznie i usuń kopię, zanim spróbujesz ponownie.\n");
  process.exit(2);
}

const polecenieTestow = a.test ? ["--test", String(a.test)] : ["--test"];
function testy(etykieta) {
  const r = spawnSync(process.execPath, polecenieTestow, { encoding: "utf8", cwd: process.cwd() });
  const wynik = (r.stdout || "") + (r.stderr || "");
  const bledne = Number((wynik.match(/^# fail (\d+)$/m) || wynik.match(/fail (\d+)/) || [])[1] ?? -1);
  if (bledne < 0) {
    console.error(`\n✖ Nie umiem odczytać liczby błędów z wyniku testów (${etykieta}).`);
    console.error(wynik.slice(-800));
    return null;
  }
  console.log(`   ${etykieta.padEnd(26)} testów czerwonych: ${bledne}`);
  return bledne;
}

const oryginal = readFileSync(PLIK, "utf8");
const podmiana = przygotujPodmiane(oryginal, a.z, a.na);
if (!podmiana.ok) {
  console.error(`\n✖ ODMAWIAM: ${podmiana.powod}.`);
  console.error("To jest ta sytuacja, dla której powstał ten skrypt: sabotaż, który nie zachodzi,");
  console.error("daje zielone testy wyglądające jak dowód, choć niczego nie sprawdzono.\n");
  process.exit(2);
}

console.log(`\nSabotaż — ${PLIK}\n`);
const blednePrzed = testy("stan wyjściowy");
if (blednePrzed === null) process.exit(2);

// Kopia zapasowa POWSTAJE PRZED zapisem i jest jedynym źródłem przywrócenia.
copyFileSync(PLIK, KOPIA);
writeFileSync(PLIK, podmiana.tresc, "utf8");

// Dowodem jest odczyt z dysku, nie zmienna w pamięci.
const poZapisie = readFileSync(PLIK, "utf8");
const potwierdzenie = potwierdzPodmiane(poZapisie, podmiana.szukany, podmiana.docelowy, oryginal);
if (!potwierdzenie.ok) {
  copyFileSync(KOPIA, PLIK);
  unlinkSync(KOPIA);
  console.error(`\n✖ ODMAWIAM: ${potwierdzenie.powod}. Plik przywrócony.\n`);
  process.exit(2);
}
console.log("   podmiana potwierdzona w pliku ✓");

// Składnia — zepsuty sabotaż ma badać LOGIKĘ, a nie wywalać parser: test, który
// pada na SyntaxError, „łapie" każdą zmianę i nie mówi nic o badanej gałęzi.
if (/\.(mjs|js)$/.test(PLIK)) {
  const check = spawnSync(process.execPath, ["--check", PLIK], { encoding: "utf8" });
  if (check.status !== 0) {
    copyFileSync(KOPIA, PLIK);
    unlinkSync(KOPIA);
    console.error("\n✖ ODMAWIAM: po podmianie plik nie jest poprawny składniowo. Plik przywrócony.");
    console.error("Testy padłyby na błędzie parsera, a nie na badanym warunku.\n");
    process.exit(2);
  }
  console.log("   składnia po podmianie ✓");
}

const blednePo = testy("po sabotażu");

// Przywracamy ZAWSZE, także gdy testów nie dało się odczytać.
copyFileSync(KOPIA, PLIK);
unlinkSync(KOPIA);
const plikPrzywrocony = readFileSync(PLIK, "utf8") === oryginal;
console.log(`   plik przywrócony ${plikPrzywrocony ? "✓" : "✖"}`);

const blendePoPrzywroceniu = testy("po przywróceniu");
const w = werdykt({
  blednePrzed,
  blednePo: blednePo ?? 0,
  blendePoPrzywroceniu: blendePoPrzywroceniu ?? 0,
  plikPrzywrocony,
});

console.log("\n" + "=".repeat(60));
console.log(w.ok ? `✔ ${w.tekst}` : `✖ ${w.tekst}`);
console.log("");
process.exit(w.kod);
