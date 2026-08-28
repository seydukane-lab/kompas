// ============================================================
//  Co stoi na produkcji
//
//  28.08.2026 zgłoszenie „suwaki dalej nie działają" dotyczyło naprawy, która
//  leżała w repo z własnym testem od dwóch dni — tyle że produkcja stała trzy
//  commity wstecz. Diagnoza poszła w kod, w którym błędu już nie było.
//  Rozjazd repo–produkcja jest w tym projekcie stanem NORMALNYM (auto-deploy
//  wyłączony celowo), więc musi być widoczny na żądanie, a nie odkrywany.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { stanProdukcji, tenSamCommit, wymagaUwagi, odmianaCommitow, odmianaCommitowDop } from "../src/wersje.js";

const c = (hash, tytul) => ({ hash, tytul });
// Historia od NAJNOWSZEGO, tak jak zwraca `git log`.
const HISTORIA = [
  c("3489ea2", "CI: testy i audyt na kazdy push"),
  c("d572249", "Wdrozenie produkcji jedna komenda"),
  c("d7c58cd", "Wersja w /healthz zamrozona przy starcie"),
  c("c26c375", "Nietkniety suwak przestal wygladac jak ustawiony filtr"),
  c("2af085e", "/healthz mowi, ktora wersja stoi pod danym adresem"),
];

test("produkcja na starszym commicie wymienia to, czego pod adresem NIE MA", () => {
  // Dokładnie sytuacja z 28.08: pod adresem 2af085e, a naprawa suwaka wyżej.
  const stan = stanProdukcji("2af085e", HISTORIA, []);

  assert.equal(stan.status, "zalega");
  assert.equal(stan.zalegle.length, 4, "lista zaległości nie zgadza się z odległością od czubka");
  assert.deepEqual(stan.zalegle.map((x) => x.hash), ["3489ea2", "d572249", "d7c58cd", "c26c375"]);
  assert.ok(stan.zalegle.some((x) => /suwak/i.test(x.tytul)),
    "raport nie nazywa po imieniu zmiany, której konsultant nie widzi — a to jedyny powód, dla którego się go czyta");
  assert.equal(wymagaUwagi(stan), true);
});

test("czubek gałęzi to jedyny stan bez alarmu", () => {
  const stan = stanProdukcji("3489ea2", HISTORIA, []);
  assert.equal(stan.status, "aktualna");
  assert.deepEqual(stan.zalegle, []);
  assert.equal(wymagaUwagi(stan), false, "aktualna produkcja zgłoszona jako problem — narzędzie, które zawsze krzyczy, przestaje coś znaczyć");
});

test("wersja spoza gałęzi nie jest myloną z zaległością", () => {
  // Groźniejsze niż zaległość: nie wiadomo, jaki kod obsługuje klientów. Zaległość
  // umiemy nazwać co do commita, tego nie — więc te dwa stany nie mogą się zlewać.
  const stan = stanProdukcji("beefbee", HISTORIA, []);

  assert.equal(stan.status, "nieznana");
  assert.deepEqual(stan.zalegle, [], "obcemu commitowi dorobiono listę zaległości, której nie da się policzyć");
  assert.equal(wymagaUwagi(stan), true);
});

test("brak pola wersji znaczy produkcję starszą niż to pole, a nie produkcję aktualną", () => {
  // /healthz zaczęło podawać wersję dopiero w 2af085e. Milczenie starszej produkcji
  // nie może wyglądać jak potwierdzenie, że wszystko wdrożone.
  const stan = stanProdukcji("", HISTORIA, []);
  assert.equal(stan.status, "brak");
  assert.equal(wymagaUwagi(stan), true, "milcząca produkcja uznana za aktualną — cisza znaczyłaby dwie sprzeczne rzeczy naraz");
});

test("commity bez pusha są zgłaszane OSOBNO, nie jako zaległość produkcji", () => {
  // Hook wdraża czubek gałęzi ZDALNEJ (patrz scripts/wdroz.mjs), więc lokalny commit
  // nie pojedzie mimo wdrożenia. Ta sama skarga („moja poprawka nie działa"),
  // zupełnie inna naprawa — zsumowanie ich wysłałoby człowieka w złą stronę.
  const lokalne = [c("4622cf7", "Audyt sprawdza teraz tez filtry wariantowe")];
  const stan = stanProdukcji("3489ea2", HISTORIA, lokalne);

  assert.equal(stan.status, "aktualna", "niewypchnięty commit policzony jako zaległość produkcji");
  assert.deepEqual(stan.niewypchniete, lokalne);
  assert.equal(wymagaUwagi(stan), false,
    "praca w toku na lokalnym repo podniosła alarm o produkcji — to normalny stan, nie awaria");
});

test("krótki hash z /healthz dopasowuje się do pełnego z gita", () => {
  // /healthz podaje 7 znaków, `git log --format=%H` czterdzieści. Porównanie wprost
  // dawałoby „nieznana" przy poprawnie wdrożonej produkcji.
  assert.equal(tenSamCommit("3489ea2", "3489ea2f1c9d4b7a"), true);
  assert.equal(tenSamCommit("3489ea2f1c9d4b7a", "3489ea2"), true);
  assert.equal(tenSamCommit("3489ea2", "d572249"), false);
  assert.equal(tenSamCommit("", "3489ea2"), false, "pusta wersja dopasowana do commita — brak danych udawałby trafienie");
});

test("raport odmienia slowo commit przez liczbę — inaczej narzędzie wygląda na zepsute", () => {
  // Czyta to człowiek, który ma na tej podstawie zdecydować o wdrożeniu. „NIE MA
  // 1 commitów" podważa zaufanie do liczby stojącej obok, a to jedyna treść raportu.
  assert.equal(odmianaCommitow(1), "commit");
  assert.equal(odmianaCommitow(3), "commity");
  assert.equal(odmianaCommitow(5), "commitów");
  assert.equal(odmianaCommitow(0), "commitów", "zero policzone jak jedynka");
  // 12-14 mimo końcówki 2-4 idą jak „wiele" — najczęstszy błąd w takich funkcjach.
  assert.equal(odmianaCommitow(12), "commitów");
  assert.equal(odmianaCommitow(22), "commity");
});

test("po nie ma idzie dopelniacz, przy wyliczeniu mianownik", () => {
  // „na produkcji NIE MA 3 commity" to ten sam rodzaj usterki co „NIE MA 1 commitów":
  // narzędzie, które kaleczy zdanie obok liczby, przestaje wyglądać na policzone.
  assert.equal(odmianaCommitowDop(1), "commita");
  assert.equal(odmianaCommitowDop(3), "commitów", "dopelniacz mnogi zastapiony mianownikiem po nie ma");
  assert.equal(odmianaCommitowDop(5), "commitów");
  // Mianownik zostaje mianownikiem tam, gdzie stoi bez czasownika przeczącego.
  assert.equal(odmianaCommitow(3), "commity");
});
