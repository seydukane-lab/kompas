// ============================================================
//  Hotelbeds: wybór destynacji i składu grupy
//
//  Test regresyjny do błędu z 29.07.2026: `resolveTargets` nie obsługiwał
//  pola `countries`, więc wybór kraju w Multiroomie był po cichu ignorowany
//  i system pytał o destynacje sandboxa. Zapytanie kończyło się sukcesem —
//  tylko dotyczyło zupełnie innego kierunku, niż zaznaczył konsultant.
//  Takiego błędu nie widać w logach ani w interfejsie; widać go dopiero
//  wtedy, gdy klient pyta, czemu dostał oferty z Majorki zamiast z Turcji.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { resolveTargets, normalizeRoomsInput, MAX_POKOI, mapAmenities } from "../src/providers/hotelbeds.js";

function facility(text, extra = {}) {
  return { description: { content: text }, ...extra };
}

test("wybór jednego kraju trafia w kod jego destynacji", () => {
  assert.deepEqual(resolveTargets({ countries: ["Turcja"] }), ["AYT"]);
  assert.deepEqual(resolveTargets({ countries: ["Egipt"] }), ["SSH"]);
  assert.deepEqual(resolveTargets({ countries: ["Hiszpania"] }), ["PMI"]);
});

test("wybór kilku krajów naraz daje kilka destynacji", () => {
  const cele = resolveTargets({ countries: ["Egipt", "Turcja", "Grecja"] });
  assert.deepEqual(cele, ["SSH", "AYT", "CHQ"]);
});

test("kraj bez zmapowanego kodu jest pomijany, a nie wysyłany jako śmieć", () => {
  const cele = resolveTargets({ countries: ["Egipt", "Wakanda"] });
  assert.deepEqual(cele, ["SSH"]);
});

test("liczba destynacji na jedno wyszukiwanie jest ograniczona", () => {
  const cele = resolveTargets({ countries: ["Hiszpania", "Grecja", "Egipt", "Turcja", "Włochy", "Tunezja"] });
  assert.ok(cele.length <= 4, `poszło ${cele.length} destynacji — to mnoży zapytania do dostawcy`);
});

test("zaznaczone regiony mają pierwszeństwo przed krajem", () => {
  const cele = resolveTargets({ countries: ["Egipt"], regions: ["Kreta"] });
  assert.ok(!cele.includes("SSH"), "skoro konsultant wskazał region, nie pytamy o cały inny kraj");
});

test("pojedynczy kierunek ze starego pola `dest` nadal działa", () => {
  assert.deepEqual(resolveTargets({ dest: "Turcja" }), ["AYT"]);
});

test("brak kierunku spada na destynacje z danymi, a nie na pustkę", () => {
  const cele = resolveTargets({});
  assert.ok(cele.length > 0, "puste cele oznaczałyby ciche zero wyników");
});

test("pusta lista krajów zachowuje się jak brak wyboru", () => {
  assert.deepEqual(resolveTargets({ countries: [] }), resolveTargets({}));
});

test("skład grupy z panelu jest przepisywany wiernie", () => {
  const rooms = normalizeRoomsInput({
    rooms: [
      { adults: 2, children: 2, ages: [5, 8] },
      { adults: 2, children: 0, ages: [] },
    ],
  });
  assert.equal(rooms.length, 2);
  assert.deepEqual(rooms[0], { adults: 2, children: 2, ages: [5, 8] });
  assert.deepEqual(rooms[1], { adults: 2, children: 0, ages: [] });
});

test("pokój bez dorosłych jest niemożliwy — zawsze co najmniej jedna osoba", () => {
  const rooms = normalizeRoomsInput({ rooms: [{ adults: 0, children: 2 }] });
  assert.equal(rooms[0].adults, 1, "zapytanie o pokój dla zera dorosłych nie ma sensu");
});

test("ujemne i śmieciowe wartości nie idą do dostawcy", () => {
  const rooms = normalizeRoomsInput({ rooms: [{ adults: -3, children: -1 }] });
  assert.equal(rooms[0].adults, 1);
  assert.equal(rooms[0].children, 0);

  const smieci = normalizeRoomsInput({ rooms: [{ adults: "dwa", children: null }] });
  assert.equal(smieci[0].adults, 1);
  assert.equal(smieci[0].children, 0);
});

test("brak listy pokoi spada na zwykły skład z formularza", () => {
  const rooms = normalizeRoomsInput({ adults: 3, kids: 1, childAges: [7] });
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].adults, 3);
  assert.equal(rooms[0].children, 1);
  assert.deepEqual(rooms[0].ages, [7]);
});

test("liczba pokoi w jednym wyszukiwaniu jest ograniczona", () => {
  // Każdy pokój to osobne, płatne zapytanie do dostawcy, mnożone przez liczbę
  // destynacji — bez limitu jedno kliknięcie wysyła kilkadziesiąt zapytań.
  const duzo = Array.from({ length: 30 }, () => ({ adults: 2, children: 0 }));
  assert.equal(normalizeRoomsInput({ rooms: duzo }).length, MAX_POKOI);
});

test("typowy wspólny wyjazd mieści się w limicie", () => {
  const trzyRodziny = Array.from({ length: 3 }, () => ({ adults: 2, children: 1, ages: [7] }));
  assert.equal(normalizeRoomsInput({ rooms: trzyRodziny }).length, 3);
});

test("domyślnie pytamy o dwie osoby", () => {
  const rooms = normalizeRoomsInput({});
  assert.deepEqual(rooms, [{ adults: 2, children: 0, ages: [] }]);
});

// Test regresyjny do błędu z 30.07.2026: filtry "Obiekt"/"Aktywność" były
// zbudowane, ale amenities nigdzie się nie liczyło — 241 ofert przed filtrem
// i 241 po. Ten zestaw testów pilnuje, żeby mapAmenities() naprawdę rozpoznawało
// udogodnienia z opisu facility, ORAZ żeby brak danych nigdy nie stawał się
// milczącą pustą tablicą (ANTY-PRZEKOLORYZACJA).

test("brak facilities w ogóle daje undefined, nie pustą tablicę", () => {
  assert.equal(mapAmenities(undefined), undefined);
  assert.equal(mapAmenities([]), undefined);
});

test("facilities bez trafień to legalna pusta tablica — sprawdziliśmy, nic nie pasuje", () => {
  const out = mapAmenities([facility("Free parking on site")]);
  assert.deepEqual(out, []);
});

test("mapAmenities rozpoznaje realne udogodnienia z opisu", () => {
  const out = mapAmenities([
    facility("Outdoor swimming pool"),
    facility("Wellness & Spa centre"),
    facility("Free WiFi in lobby"),
    facility("Fully accessible for wheelchair users"),
    facility("Daily animation programme"),
    facility("Water sports centre nearby"),
    facility("Kids' club for 4-12 years"),
    facility("Fitness / gym room"),
  ]);
  assert.deepEqual(out.sort(), [
    "animacje", "basen", "klub-dzieci", "niepelnosprawni",
    "silownia", "sporty-wodne", "spa", "wifi",
  ].sort());
});

test("mapAmenities nie zgaduje udogodnień, których opis nie wspomina", () => {
  const out = mapAmenities([facility("Outdoor swimming pool")]);
  assert.deepEqual(out, ["basen"]);
});
