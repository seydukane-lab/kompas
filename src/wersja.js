// ============================================================
//  Która wersja kodu naprawdę stoi pod danym adresem
//
//  Auto-deploy jest WYŁĄCZONY celowo, więc push na main NIE jest wdrożeniem.
//  Przez to „co widać na produkcji" i „co jest w repo" to dwie różne rzeczy,
//  które już raz rozjechały się kosztownie: 29.07.2026 mail do partnera opierał
//  się na tym, jak zachowuje się publiczny adres, a adres serwował wersję sprzed
//  tygodnia. Kliknięcie „Deploy" też nie jest dowodem — wdrożenie potrafi paść.
//
//  Dotąd jedynym sposobem sprawdzenia była lista wdrożeń w panelu hostingu, czyli
//  logowanie. Teraz mówi to samo środowisko uruchomieniowe, w /healthz.
//
//  Skąd hash: Render wystawia RENDER_GIT_COMMIT każdemu wdrożeniu. Lokalnie
//  czytamy `.git/HEAD` — bez wołania gita, żeby działało też tam, gdzie gita nie
//  ma w PATH. Gdy nie wiadomo, zwracamy `null` i NIE zgadujemy: fałszywa wersja
//  jest gorsza niż jej brak, bo na jej podstawie ktoś ogłosi, że poprawka jest
//  już u konsultanta.
//
//  Hash nie jest sekretem — repo jest publiczne, a bez niego nie da się odróżnić
//  działającej produkcji od produkcji sprzed dziesięciu commitów.
// ============================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Skrócony hash commita albo null, gdy środowisko go nie zna. */
export function wersjaKodu(env = process.env, katalog = process.cwd()) {
  const zHostingu = env.RENDER_GIT_COMMIT || env.GIT_COMMIT || env.SOURCE_VERSION;
  if (zHostingu) return String(zHostingu).trim().slice(0, 7) || null;

  // Lokalnie: `.git/HEAD` wskazuje albo wprost na hash (odłączony HEAD), albo na
  // plik gałęzi. Oba przypadki występują realnie — kontener nocnego agenta startuje
  // w odłączonym HEAD, maszyna właściciela na gałęzi.
  try {
    const head = readFileSync(join(katalog, ".git", "HEAD"), "utf8").trim();
    if (!head.startsWith("ref:")) return head.slice(0, 7) || null;
    const ref = head.slice(4).trim();
    return readFileSync(join(katalog, ".git", ref), "utf8").trim().slice(0, 7) || null;
  } catch {
    return null; // brak .git (np. wdrożenie z archiwum) — nie zgadujemy
  }
}

// ODCZYT RAZ, PRZY STARCIE — nie przy każdym żądaniu.
//
// Wpadka złapana 28.08.2026 zaraz po wdrożeniu tego modułu: lokalny serwer chodził
// od blisko trzech godzin, a `/healthz` podawał hash commita zrobionego minutę
// wcześniej. Bo `.git/HEAD` czytany per żądanie mówi, co jest W REPO TERAZ, a nie
// co wykonuje uruchomiony proces. Czyli endpoint stworzony po to, żeby nie dać się
// okłamać co do wdrożonej wersji, sam zaczynał kłamać — i to w najgorszy sposób,
// bo zawsze na korzyść „najnowszego" kodu.
//
// Na produkcji problem nie występuje (hash idzie ze zmiennej ustawionej przy
// wdrożeniu), ale to właśnie lokalnie i u nocnego agenta sprawdza się „czy na pewno
// uruchomiłem to, co myślę". Wartość zamrażamy w chwili importu modułu.
const PRZY_STARCIE = wersjaKodu();

/** Wersja kodu, z którą wystartował TEN proces. Nie zmienia się w trakcie życia serwera. */
export function wersjaUruchomienia() {
  return PRZY_STARCIE;
}
