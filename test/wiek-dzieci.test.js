// ============================================================
//  Wiek dzieci w zapytaniu o dostępność
//
//  Do 29.07.2026 w kodzie siedziała stała: każde dziecko szło do dostawcy
//  jako ośmiolatek. Konsultant wpisywał w formularz wiek, system go zbierał,
//  a potem cicho wyrzucał — i pytał o cenę dla kogoś innego niż dziecko
//  klienta. Progi cenowe (dziecko gratis, zniżki) chodzą zwykle koło 2, 6
//  i 12 lat, więc różnica bywa liczona w setkach złotych.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { buildPaxes, parseChildAges } from "../src/providers/hotelbeds.js";

test("wiek z formularza trafia do dostawcy", () => {
  assert.deepEqual(buildPaxes(2, [3, 14]), [
    { type: "CH", age: 3 },
    { type: "CH", age: 14 },
  ]);
});

test("brak dzieci to brak listy osób", () => {
  assert.equal(buildPaxes(0, []), undefined);
  assert.equal(buildPaxes(undefined), undefined);
});

test("brak podanego wieku spada na wartość środkową, nie wywala zapytania", () => {
  const p = buildPaxes(2, []);
  assert.equal(p.length, 2);
  for (const x of p) assert.equal(x.age, 8);
});

test("wieku podanego dla części dzieci nie gubimy", () => {
  // Konsultant wpisał wiek tylko pierwszego dziecka.
  assert.deepEqual(buildPaxes(2, [4]), [
    { type: "CH", age: 4 },
    { type: "CH", age: 8 },
  ]);
});

test("niemowlę to zero lat, a nie brak wieku", () => {
  assert.deepEqual(buildPaxes(1, [0]), [{ type: "CH", age: 0 }]);
});

test("wartości bez sensu nie idą do dostawcy", () => {
  for (const zly of [[-3], ["pięć"], [null], [999], [18]]) {
    const p = buildPaxes(1, zly);
    assert.equal(p[0].age, 8, `wiek ${JSON.stringify(zly[0])} powinien wpaść na wartość zastępczą`);
  }
});

test("ułamkowy wiek jest zaokrąglany", () => {
  assert.equal(buildPaxes(1, [4.6])[0].age, 5);
});

test("liczba osób zawsze zgadza się z liczbą dzieci", () => {
  for (const n of [1, 2, 3, 4]) {
    assert.equal(buildPaxes(n, [5]).length, n);
  }
});

// ------------------------------------------------------------
//  Droga z zapytania HTTP do listy wieków
//
//  Formularz wysyła wiek każdego dziecka po przecinku, a puste pole zostawia
//  pustym. Serwer do 18.08.2026 wycinał puste wpisy — i przy dzieciach
//  [brak, 10 lat] pierwsze dziecko dostawało 10 lat, a drugie zgadywane 8.
//  Wiek wędrował na niewłaściwe dziecko, cicho i bez śladu w wyniku.
// ------------------------------------------------------------

test("brak zapytania o wiek to pusta lista, nie lista z zerem", () => {
  assert.deepEqual(parseChildAges(undefined), []);
  assert.deepEqual(parseChildAges(""), []);
  assert.deepEqual(parseChildAges(null), []);
});

test("puste pole zostaje dziurą na swoim miejscu, a nie znika z listy", () => {
  assert.deepEqual(parseChildAges(",10"), [null, 10]);
  assert.deepEqual(parseChildAges("10,"), [10, null]);
  assert.deepEqual(parseChildAges("0,,7"), [0, null, 7]);
});

test("wiek nie przenosi się na inne dziecko, gdy wcześniejsze pole jest puste", () => {
  const paxes = buildPaxes(2, parseChildAges(",10"));
  assert.equal(paxes[0].age, 8, "pierwsze dziecko ma być przybliżeniem, bo wieku nie podano");
  assert.equal(paxes[1].age, 10, "drugie dziecko ma dostać wiek, który wpisał konsultant");
});

test("niemowlę przechodzi jako zero, a śmieć jako brak wieku", () => {
  assert.deepEqual(parseChildAges("0"), [0]);
  assert.deepEqual(parseChildAges("abc,5"), [null, 5]);
  assert.equal(buildPaxes(1, parseChildAges("0"))[0].age, 0);
});
