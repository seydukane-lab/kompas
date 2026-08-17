// ============================================================
//  Hamulec na zgadywanie haseł
//
//  Kompas ma pracować w biurze, gdzie wszyscy wychodzą do internetu jednym
//  adresem IP. Limit liczony wyłącznie po adresie robi wtedy coś odwrotnego
//  od zamierzonego: nie tyle utrudnia atak, co pozwala jednej osobie mylącej
//  własne hasło zamknąć panel całemu zespołowi. Te testy pilnują, że obrona
//  działa na konto, a nie na biuro.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { utworzHamulec } from "../src/login-limit.js";

const IP = "192.0.2.10";

test("pięć pomyłek blokuje TO konto, ale nie pozostałych osób w biurze", () => {
  const h = utworzHamulec();
  for (let i = 0; i < 5; i++) h.nieudana({ email: "anna@biuro.pl", ip: IP });

  assert.equal(h.zablokowane({ email: "anna@biuro.pl", ip: IP }), true,
    "konto po pięciu pomyłkach powinno być zablokowane");
  assert.equal(h.zablokowane({ email: "marek@biuro.pl", ip: IP }), false,
    "kolega z tego samego biura stracił dostęp przez cudze pomyłki — dokładnie tego unikamy");
});

test("zgadywanie jednego konta z wielu adresów też się liczy", () => {
  const h = utworzHamulec();
  for (let i = 0; i < 5; i++) h.nieudana({ email: "anna@biuro.pl", ip: "198.51.100." + i });
  assert.equal(h.zablokowane({ email: "anna@biuro.pl", ip: "203.0.113.7" }), true,
    "licznik konta musi działać niezależnie od tego, skąd lecą próby");
});

test("spryskiwanie wielu kont z jednego adresu blokuje adres", () => {
  const h = utworzHamulec();
  for (let i = 0; i < 20; i++) h.nieudana({ email: `ktos${i}@biuro.pl`, ip: IP });
  assert.equal(h.zablokowane({ email: "nowy@biuro.pl", ip: IP }), true,
    "dwadzieścia prób na dwadzieścia kont z jednego adresu to atak, nie pomyłka");
  assert.equal(h.zablokowane({ email: "nowy@biuro.pl", ip: "203.0.113.9" }), false,
    "blokada adresu nie może objąć całego internetu");
});

test("udane wejście zeruje własne pomyłki, także w puli adresu", () => {
  const h = utworzHamulec();
  for (let i = 0; i < 4; i++) h.nieudana({ email: "anna@biuro.pl", ip: IP });
  assert.equal(h.stan({ email: "anna@biuro.pl", ip: IP }).adres, 4);

  h.udana({ email: "anna@biuro.pl", ip: IP });

  const po = h.stan({ email: "anna@biuro.pl", ip: IP });
  assert.equal(po.konto, 0, "po poprawnym wejściu licznik konta ma zniknąć");
  assert.equal(po.adres, 0, "własne pomyłki nie mogą dalej obciążać puli całego biura");
});

test("udane wejście nie kasuje prób na CUDZE konta z tego samego adresu", () => {
  const h = utworzHamulec();
  for (let i = 0; i < 8; i++) h.nieudana({ email: `ofiara${i}@biuro.pl`, ip: IP });
  for (let i = 0; i < 2; i++) h.nieudana({ email: "anna@biuro.pl", ip: IP });

  h.udana({ email: "anna@biuro.pl", ip: IP });

  assert.equal(h.stan({ email: "anna@biuro.pl", ip: IP }).adres, 8,
    "poprawne logowanie jednej osoby wymazało ślad trwającego ataku na inne konta");
});

test("okno jest przesuwne: po kwadransie próby przestają się liczyć", () => {
  let zegar = 1_000_000;
  const h = utworzHamulec({ teraz: () => zegar });
  for (let i = 0; i < 5; i++) h.nieudana({ email: "anna@biuro.pl", ip: IP });
  assert.equal(h.zablokowane({ email: "anna@biuro.pl", ip: IP }), true);

  zegar += 15 * 60 * 1000 + 1;
  assert.equal(h.zablokowane({ email: "anna@biuro.pl", ip: IP }), false,
    "blokada miała wygasnąć razem z oknem");
});

test("wielkość liter i spacje w adresie e-mail to wciąż to samo konto", () => {
  const h = utworzHamulec();
  for (const zapis of ["anna@biuro.pl", "Anna@Biuro.pl", " ANNA@BIURO.PL ", "anna@biuro.pl", "AnNa@biuro.pl"]) {
    h.nieudana({ email: zapis, ip: IP });
  }
  assert.equal(h.zablokowane({ email: "anna@biuro.pl", ip: IP }), true,
    "inny zapis tego samego adresu dawał osobną pulę prób do wyczerpania");
});

test("brak adresu e-mail nie wywraca licznika", () => {
  const h = utworzHamulec();
  for (let i = 0; i < 5; i++) h.nieudana({ ip: IP });
  assert.equal(h.zablokowane({ ip: IP }), true, "puste konto też musi mieć swój licznik");
  assert.equal(h.zablokowane({ email: "anna@biuro.pl", ip: IP }), false,
    "próby bez podanego e-maila nie mogą blokować konkretnego konta");
});

test("progi da się przestawić bez ruszania logiki", () => {
  const h = utworzHamulec({ maxNaKonto: 2, maxNaAdres: 3 });
  h.nieudana({ email: "anna@biuro.pl", ip: IP });
  assert.equal(h.zablokowane({ email: "anna@biuro.pl", ip: IP }), false);
  h.nieudana({ email: "anna@biuro.pl", ip: IP });
  assert.equal(h.zablokowane({ email: "anna@biuro.pl", ip: IP }), true);
});
