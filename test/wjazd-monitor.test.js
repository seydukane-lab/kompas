// ============================================================
//  Monitor warunków wjazdowych
//
//  Warunki wjazdu konsultant czyta klientowi jako fakt i nikt ich nie sprawdzi
//  przed wyjazdem. Dane zbierane są ręcznie, więc bez przypomnienia po prostu
//  się starzeją — Egipt podniósł opłatę wizową w III 2026 i nic o tym nie wie
//  system, który tego nie pilnuje.
//
//  Świadome ograniczenie, którego te testy pilnują: automat NIE podmienia treści
//  przepisów. Wykrywa, że strona MSZ się ruszyła, i oznacza kraj do przeczytania
//  przez człowieka. Zły parse strony rządowej = błędna informacja prawna podana
//  jako pewnik, czyli dokładnie to, czego w tym projekcie nie robimy.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { slugKraju, urlKraju, monitorowaneKraje, sygnatura, odcisk, porownaj, nowyStan, doWeryfikacji } from "../src/wjazd-monitor.js";

test("monitorujemy dokładnie te kraje, które panel pokazuje konsultantowi", () => {
  const kraje = monitorowaneKraje();
  assert.ok(kraje.length >= 5, "za mało krajów pod obserwacją");
  for (const kraj of ["Egipt", "Grecja", "Turcja"]) {
    assert.ok(kraje.includes(kraj), `brak kraju ${kraj} — dane o wjeździe będą się starzeć niezauważone`);
  }
});

test("adres strony MSZ powstaje z nazwy kraju, także z polskimi znakami", () => {
  assert.equal(slugKraju("Egipt"), "egipt");
  assert.equal(slugKraju("Włochy"), "wlochy");
  assert.equal(slugKraju("Wyspy Zielonego Przylądka"), "wyspy-zielonego-przyladka");
  assert.match(urlKraju("Turcja"), /^https:\/\/www\.gov\.pl\/web\/dyplomacja\/turcja$/);
});

test("sygnatura wybiera najmocniejszy dostępny sygnał zmiany", () => {
  assert.equal(sygnatura({ etag: 'W/"abc123"', lastModified: "x", dlugosc: 10 }).rodzaj, "etag");
  assert.equal(sygnatura({ etag: 'W/"abc123"' }).wartosc, "abc123", "ETag musi być znormalizowany (W/ i cudzysłowy)");
  assert.equal(sygnatura({ lastModified: "Wed, 05 Aug 2026 22:04:18 GMT", dlugosc: 10 }).rodzaj, "last-modified");
  // Rozmiar to sygnał SŁABY (ta sama długość przy innej treści) — tylko w ostateczności.
  assert.equal(sygnatura({ dlugosc: 39473 }).rodzaj, "rozmiar");
  assert.equal(sygnatura({}).rodzaj, "brak");
});

test("ten sam ETag daje ten sam odcisk, inny — inny", () => {
  const a = odcisk(sygnatura({ etag: '"aaa"' }));
  const b = odcisk(sygnatura({ etag: '"aaa"' }));
  const c = odcisk(sygnatura({ etag: '"bbb"' }));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("zmiana strony MSZ jest wykrywana, brak zmiany nie hałasuje", () => {
  const stan = { kraje: { Egipt: { odcisk: "stary", sprawdzone: "2026-07-01" }, Grecja: { odcisk: "grecki", sprawdzone: "2026-07-01" } } };
  const wyniki = [
    { kraj: "Egipt", odcisk: "nowy", sygnatura: { rodzaj: "etag" } },
    { kraj: "Grecja", odcisk: "grecki", sygnatura: { rodzaj: "etag" } },
    { kraj: "Turcja", blad: "HTTP 503" },
  ];
  const w = porownaj(stan, wyniki);
  assert.deepEqual(w.zmienione.map((x) => x.kraj), ["Egipt"]);
  assert.deepEqual(w.bezZmian.map((x) => x.kraj), ["Grecja"]);
  assert.deepEqual(w.niedostepne.map((x) => x.kraj), ["Turcja"],
    "padnięta strona MSZ nie może udawać, że nic się nie zmieniło");
});

test("kraj widziany pierwszy raz trafia do weryfikacji, a nie po cichu do stanu", () => {
  const w = porownaj({ kraje: {} }, [{ kraj: "Egipt", odcisk: "x", sygnatura: { rodzaj: "etag" } }]);
  assert.equal(w.zmienione.length, 1);
  assert.match(w.zmienione[0].powod, /pierwsze sprawdzenie/);
});

test("automat nie udaje, że ktoś przeczytał treść przepisów", () => {
  const stan = { kraje: { Egipt: { odcisk: "stary", sprawdzone: "2026-07-01", zweryfikowane: "2026-07-01" } } };
  const wyniki = [{ kraj: "Egipt", odcisk: "nowy", sygnatura: { rodzaj: "etag" } }];
  const nowy = nowyStan(stan, wyniki, new Date("2026-08-18"));

  assert.equal(nowy.kraje.Egipt.odcisk, "nowy");
  assert.equal(nowy.kraje.Egipt.sprawdzone, "2026-08-18", "data automatycznego sprawdzenia ma się odświeżyć");
  assert.equal(nowy.kraje.Egipt.zweryfikowane, "2026-07-01",
    "automat podbił datę ludzkiej weryfikacji treści — a nikt tej treści nie przeczytał");
  assert.equal(nowy.kraje.Egipt.zmienioneOd, "2026-08-18");
});

test("kraj czeka na weryfikację dopóki człowiek jej nie potwierdzi", () => {
  const stan = {
    kraje: {
      Egipt: { odcisk: "n", zmienioneOd: "2026-08-18", zweryfikowane: "2026-07-01" },   // zmiana PO weryfikacji
      Grecja: { odcisk: "n", zmienioneOd: "2026-07-10", zweryfikowane: "2026-07-20" },  // weryfikacja PO zmianie
      Turcja: { odcisk: "n", zmienioneOd: "2026-08-01", zweryfikowane: null },          // nigdy nie weryfikowana
      Włochy: { odcisk: "n" },                                                          // nic się nie zmieniło
    },
  };
  const czekaja = doWeryfikacji(stan).map((x) => x.kraj).sort();
  assert.deepEqual(czekaja, ["Egipt", "Turcja"],
    "lista oczekujących na weryfikację nie zgadza się z historią zmian");
});

test("stan bez wpisów nie wywraca porównania ani listy do weryfikacji", () => {
  assert.deepEqual(doWeryfikacji({}), []);
  assert.deepEqual(porownaj({}, []).zmienione, []);
});
