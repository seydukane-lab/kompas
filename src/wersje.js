// ============================================================
//  Co realnie stoi na produkcji — i czego tam NIE MA
//
//  28.08.2026: zgłoszenie „suwaki dalej nie działają". Naprawa (c26c375) była
//  w repo od dwóch dni i miała test, ale produkcja stała na 2af085e — dwa commity
//  wcześniej. Kod był zrobiony, adres, którego używa konsultant, o tym nie wiedział.
//  Godzina diagnozy poszła na szukanie błędu, którego w bieżącym kodzie nie było.
//
//  `npm run wdroz` odpowiada na pytanie „wdróż", a nie „co tam właściwie stoi".
//  Auto-deploy jest wyłączony CELOWO (chroni produkcję przed nocnymi commitami),
//  więc rozjazd repo–produkcja jest normalnym stanem tego projektu, nie awarią.
//  Skoro jest normalny, musi być WIDOCZNY na żądanie — inaczej cisza znaczy
//  jednocześnie „wszystko wdrożone" i „nic nie wdrożone".
// ============================================================

/** Czy dwa hashe wskazują ten sam commit (jeden bywa skrócony do 7 znaków). */
export function tenSamCommit(a, b) {
  if (!a || !b) return false;
  const x = String(a).trim().toLowerCase(), y = String(b).trim().toLowerCase();
  if (!x || !y) return false;
  return x.startsWith(y) || y.startsWith(x);
}

/**
 * Stan produkcji względem gałęzi, którą Render wdraża (origin/main).
 *
 * @param wersjaProd     hash z /healthz — to, co realnie stoi pod adresem
 * @param historia       commity origin/main od NAJNOWSZEGO: [{hash, tytul}]
 * @param niewypchniete  commity lokalne, których nie ma na origin: [{hash, tytul}]
 *
 * Zwraca `status`:
 *  - "brak"     — /healthz nie podał wersji (produkcja starsza niż 2af085e, gdzie
 *                 to pole wprowadzono; nie da się powiedzieć, co tam stoi),
 *  - "nieznana" — wersja jest, ale nie ma jej w historii origin/main: produkcja
 *                 stoi na czymś spoza tej gałęzi. To POWAŻNIEJSZE niż zaległość,
 *                 bo nie wiadomo, jaki kod obsługuje klientów,
 *  - "aktualna" — czubek origin/main,
 *  - "zalega"   — `zalegle` to commity, których na produkcji NIE MA, od najnowszego.
 *
 * `niewypchniete` przechodzi na wylot: te commity nie pojadą nawet po wdrożeniu,
 * bo hook wdraża czubek gałęzi zdalnej (patrz scripts/wdroz.mjs). Zaległość i brak
 * pusha to dwie różne przyczyny tego samego objawu „moja poprawka nie działa",
 * więc raport musi je rozdzielać, a nie sumować.
 */
export function stanProdukcji(wersjaProd, historia, niewypchniete) {
  const wynik = { status: "brak", wersjaProd: wersjaProd || "", zalegle: [], niewypchniete: niewypchniete || [] };
  if (!wersjaProd) return wynik;

  const lista = historia || [];
  const i = lista.findIndex((c) => tenSamCommit(c && c.hash, wersjaProd));
  if (i < 0) { wynik.status = "nieznana"; return wynik; }
  if (i === 0) { wynik.status = "aktualna"; return wynik; }

  wynik.status = "zalega";
  wynik.zalegle = lista.slice(0, i);
  return wynik;
}

/**
 * Czy stan wymaga reakcji człowieka. Świadomie NIE liczy samych niewypchniętych
 * commitów: praca w toku na lokalnym repo jest normalna i nie jest problemem
 * produkcji. Alarmem jest dopiero to, że pod adresem stoi coś innego, niż ludzie
 * myślą — albo coś, czego nie umiemy nazwać.
 */
export function wymagaUwagi(stan) {
  return !!stan && (stan.status === "zalega" || stan.status === "nieznana" || stan.status === "brak");
}

/**
 * Odmiana rzeczownika „commit" przez liczbę — bo raport czyta człowiek, a
 * „NIE MA 1 commitów" wygląda jak literówka w narzędziu, któremu ma zaufać.
 * Polska reguła: 1 → mianownik, 2–4 → liczba mnoga, reszta → dopełniacz;
 * wyjątek na 12–14, które mimo końcówki idą jak „wiele".
 */
export function odmianaCommitow(n) {
  const x = Math.abs(Math.trunc(n || 0));
  if (x === 1) return "commit";
  const dziesiatki = x % 100, jednosci = x % 10;
  if (jednosci >= 2 && jednosci <= 4 && !(dziesiatki >= 12 && dziesiatki <= 14)) return "commity";
  return "commitów";
}

/**
 * To samo słowo w DOPEŁNIACZU — po „nie ma" polszczyzna wymaga innego przypadka
 * niż przy zwykłym wyliczeniu: „nie ma 3 commitów", ale „3 commity tylko lokalnie".
 * Osobna funkcja, bo to osobna decyzja gramatyczna, nie wariant tej samej.
 */
export function odmianaCommitowDop(n) {
  return Math.abs(Math.trunc(n || 0)) === 1 ? "commita" : "commitów";
}
