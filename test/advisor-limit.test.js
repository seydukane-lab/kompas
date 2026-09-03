// ============================================================
//  Hamulec wydatków na doradcę (ETA)
//
//  Do 03.09.2026 advisor.js liczył wydatki, ale nic ich nie ograniczało.
//  Zmierzone tego dnia na realnym rejestrze: 13 wywołań = 3,44 USD, czyli
//  ~0,265 USD za raport. Kredyt 85 € przepada 19.09.2026, a po tej dacie każde
//  kliknięcie ETA to pieniądze z karty właściciela — przy panelu wdrożonym
//  w biurze, gdzie klika kilku konsultantów naraz.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { czyWolnoWydac, ostrzezenieBudzetu, dzienKluczem } from "../src/advisor-limit.js";

const DZIS = Date.UTC(2026, 8, 3, 12, 0, 0); // 2026-09-03
const dzis = dzienKluczem(DZIS);
const rejestr = (over = {}) => ({ totalUsd: 0, calls: 0, days: {}, ...over });

test("pod limitem wolno wydawać", () => {
  const stan = czyWolnoWydac(
    rejestr({ totalUsd: 3.44, days: { [dzis]: { usd: 1.2 } } }),
    { teraz: DZIS, limitDzienUsd: 5, limitLacznyUsd: 0 },
  );
  assert.equal(stan.wolno, true);
  assert.equal(stan.wydaneDzisUsd, 1.2);
  assert.equal(stan.zostaloDzisUsd, 3.8);
  assert.equal(stan.zostaloLacznieUsd, null, "brak limitu łącznego musi znaczyć null, nie zero");
});

test("dzienny limit zatrzymuje kolejne wywołanie i mówi, kiedy się odnowi", () => {
  const stan = czyWolnoWydac(
    rejestr({ totalUsd: 9, days: { [dzis]: { usd: 5.01 } } }),
    { teraz: DZIS, limitDzienUsd: 5 },
  );
  assert.equal(stan.wolno, false);
  assert.match(stan.powod, /Dzienny limit/);
  assert.match(stan.powod, /jutro/, "komunikat nie mówi, że limit sam się odnowi — konsultant nie wie, co robić");
  assert.match(stan.powod, /ADVISOR_LIMIT_DZIEN_USD/, "brak nazwy ustawienia, którym można to podnieść");
});

test("łączny limit ma pierwszeństwo przed dziennym", () => {
  // Gdy skończył się CAŁY budżet, zdanie o dziennym limicie tylko myli:
  // jutro nic się samo nie odblokuje.
  const stan = czyWolnoWydac(
    rejestr({ totalUsd: 92, days: { [dzis]: { usd: 0.1 } } }),
    { teraz: DZIS, limitDzienUsd: 5, limitLacznyUsd: 92 },
  );
  assert.equal(stan.wolno, false);
  assert.match(stan.powod, /łączny budżet/i);
  assert.doesNotMatch(stan.powod, /jutro/, "obiecuje odnowienie, którego nie będzie");
  assert.match(stan.powod, /pamięci podręcznej/, "nie mówi, że gotowe raporty dalej działają");
});

test("limit ustawiony na zero znaczy BRAK limitu, nie zakaz", () => {
  // Inaczej wyłączenie hamulca przez wpisanie 0 zablokowałoby narzędzie całkowicie.
  const stan = czyWolnoWydac(
    rejestr({ totalUsd: 1000, days: { [dzis]: { usd: 999 } } }),
    { teraz: DZIS, limitDzienUsd: 0, limitLacznyUsd: 0 },
  );
  assert.equal(stan.wolno, true);
  assert.equal(stan.zostaloDzisUsd, null);
});

test("nowy dzień zeruje licznik dzienny, ale nie łączny", () => {
  const wczoraj = dzienKluczem(DZIS - 86400e3);
  const stan = czyWolnoWydac(
    rejestr({ totalUsd: 20, days: { [wczoraj]: { usd: 9 } } }),
    { teraz: DZIS, limitDzienUsd: 5, limitLacznyUsd: 92 },
  );
  assert.equal(stan.wolno, true, "wczorajsze wydatki dalej blokują dzisiejszą pracę");
  assert.equal(stan.wydaneDzisUsd, 0);
  assert.equal(stan.wydaneLacznieUsd, 20, "licznik łączny nie może się zerować razem z dziennym");
});

test("pusty albo brakujący rejestr nie wywraca hamulca", () => {
  // Pierwsze uruchomienie na czystej maszynie: pliku ze stanem jeszcze nie ma.
  assert.equal(czyWolnoWydac(null, { teraz: DZIS, limitDzienUsd: 5 }).wolno, true);
  assert.equal(czyWolnoWydac({}, { teraz: DZIS, limitDzienUsd: 5 }).wydaneDzisUsd, 0);
});

test("ostrzeżenie pojawia się PRZED zatrzymaniem, nie po", () => {
  // Właściciel ma się dowiedzieć, że budżet się kończy, zanim narzędzie przestanie
  // działać w środku rozmowy z klientem.
  const blisko = czyWolnoWydac(
    rejestr({ totalUsd: 4, days: { [dzis]: { usd: 4.2 } } }),
    { teraz: DZIS, limitDzienUsd: 5 },
  );
  assert.equal(blisko.wolno, true);
  assert.match(ostrzezenieBudzetu(blisko), /Dzienny budżet.*wyczerpani/i);

  const spokojnie = czyWolnoWydac(
    rejestr({ days: { [dzis]: { usd: 1 } } }),
    { teraz: DZIS, limitDzienUsd: 5 },
  );
  assert.equal(ostrzezenieBudzetu(spokojnie), null, "ostrzeżenie przy 20% wykorzystania to hałas");
});

test("po zatrzymaniu nie ostrzegamy — wtedy mówi już sam powód", () => {
  const stop = czyWolnoWydac(
    rejestr({ days: { [dzis]: { usd: 9 } } }),
    { teraz: DZIS, limitDzienUsd: 5 },
  );
  assert.equal(ostrzezenieBudzetu(stop), null);
});
