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
import { buildPaxes } from "../src/providers/hotelbeds.js";

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
