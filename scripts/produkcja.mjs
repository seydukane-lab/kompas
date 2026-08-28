// ============================================================
//  Co stoi na produkcji — `npm run produkcja`
//
//  Pyta /healthz o wersję i mówi, KTÓRYCH commitów pod tym adresem nie ma.
//  Nic nie wdraża i niczego nie zmienia; od wdrażania jest `npm run wdroz`.
//
//  Powód powstania: 28.08.2026 zgłoszenie „suwaki dalej nie działają" przy
//  naprawie, która od dwóch dni leżała w repo z testem. Produkcja stała trzy
//  commity wstecz i nie było jak tego zobaczyć inaczej niż ręcznym porównaniem
//  hasha z git logiem. Reguły: src/wersje.js.
//
//  Użycie:
//    npm run produkcja
//    KOMPAS_URL=https://inny-adres npm run produkcja
// ============================================================

import { execSync } from "node:child_process";
import { stanProdukcji, wymagaUwagi, odmianaCommitow, odmianaCommitowDop } from "../src/wersje.js";

const ADRES = process.env.KOMPAS_URL || "https://kompas-2tax.onrender.com";
// Render usypia darmowe instancje — pierwsze żądanie budzi kontener i potrafi
// czekać kilkanaście sekund. Krótki timeout raportowałby to jako padniętą produkcję.
const LIMIT_MS = Number(process.env.KOMPAS_TIMEOUT_MS) || 90000;

const git = (cmd, awaryjne = "") => {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return awaryjne; }
};
// Format w cudzysłowie: bez tego powłoka bierze `|` za potok i git dostaje
// samo `--format=%h`, a lista commitów wraca pusta — czyli „wersja nieznana"
// przy poprawnie wdrożonej produkcji.
const commity = (zakres) =>
  git(`git log --format="%h|%s" -n 40 ${zakres}`, "")
    .split("\n").filter(Boolean)
    .map((l) => { const i = l.indexOf("|"); return { hash: l.slice(0, i), tytul: l.slice(i + 1) }; });

console.log(`\nProdukcja — ${ADRES}`);

let wersjaProd = "";
try {
  const r = await fetch(ADRES + "/healthz", { signal: AbortSignal.timeout(LIMIT_MS) });
  const b = await r.json().catch(() => ({}));
  wersjaProd = b.wersja || "";
  console.log(`odpowiada: HTTP ${r.status}${b.uptime != null ? `, uptime ${b.uptime}s` : ""}`);
} catch (e) {
  console.error(`\n✖ Brak odpowiedzi z ${ADRES}/healthz (${e.name === "TimeoutError" ? `cisza ponad ${LIMIT_MS / 1000}s` : e.message}).`);
  console.error("To NIE znaczy jeszcze awarii: darmowa instancja Rendera budzi się kilkanaście sekund.");
  console.error("Spróbuj ponownie albo podnieś limit: KOMPAS_TIMEOUT_MS=180000 npm run produkcja\n");
  process.exit(2);
}

git("git fetch -q origin");
const historia = commity("origin/main");
const niewypchniete = commity("origin/main..HEAD");
const stan = stanProdukcji(wersjaProd, historia, niewypchniete);

console.log("");
if (stan.status === "brak") {
  console.log("Wersja: NIE PODANA. Produkcja jest starsza niż commit 2af085e,");
  console.log("w którym /healthz zaczęło mówić, co pod danym adresem stoi.");
} else if (stan.status === "nieznana") {
  console.log(`Wersja: ${stan.wersjaProd} — NIE MA jej w ostatnich ${historia.length} commitach origin/main.`);
  console.log("Pod tym adresem stoi kod spoza tej gałęzi albo znacznie starszy niż historia wyżej.");
} else if (stan.status === "aktualna") {
  console.log(`Wersja: ${stan.wersjaProd} — czubek origin/main. Produkcja ma wszystko, co wypchnięte.`);
} else {
  console.log(`Wersja: ${stan.wersjaProd} — na produkcji NIE MA ${stan.zalegle.length} ${odmianaCommitowDop(stan.zalegle.length)}:`);
  for (const c of stan.zalegle) console.log(`   ${c.hash}  ${c.tytul}`);
  console.log("\nTo są zmiany, których konsultant pod tym adresem nie zobaczy.");
  console.log("Wdrożenie: npm run wdroz");
}

// Osobno, bo to inna przyczyna tego samego objawu „moja poprawka nie działa":
// hook wdraża czubek gałęzi ZDALNEJ, więc lokalny commit nie pojedzie mimo wdrożenia.
if (stan.niewypchniete.length) {
  console.log(`\nDodatkowo, poza zasięgiem wdrożenia — ${stan.niewypchniete.length} ${odmianaCommitow(stan.niewypchniete.length)} tylko lokalnie:`);
  for (const c of stan.niewypchniete) console.log(`   ${c.hash}  ${c.tytul}`);
  console.log("Najpierw: git push origin main");
}

console.log("");
process.exit(wymagaUwagi(stan) ? 1 : 0);
