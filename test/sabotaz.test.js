// ============================================================
//  Kontrolowany sabotaż
//
//  Narzędzie, którego zadaniem jest pilnowanie wiarygodności innych testów, musi
//  samo być sprawdzone — inaczej dokładamy tylko kolejną warstwę zielonego koloru.
//  Każdy przypadek niżej odpowiada realnej wpadce z tego projektu.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import {
  koncowkaLinii, dopasujKoncowki, ileWystapien,
  przygotujPodmiane, potwierdzPodmiane, werdykt,
} from "../src/sabotaz.js";

test("wzorzec pisany z \\n trafia w plik z CRLF", () => {
  // TO JEST GŁÓWNY POWÓD POWSTANIA TEGO NARZĘDZIA. Całe repo jest edytowane na
  // Windows, więc pliki w drzewie roboczym mają CRLF, a wzorzec wpisany w terminalu
  // ma LF. Bez dopasowania końcówek wielolinijkowy sabotaż CICHO NIE ZACHODZI,
  // testy są zielone i wygląda to jak dowód, że gałąź jest chroniona.
  const plik = "linia A\r\nlinia B\r\nlinia C\r\n";

  assert.equal(koncowkaLinii(plik), "\r\n");
  assert.equal(ileWystapien(plik, "linia A\nlinia B"), 1,
    "wzorzec z LF nie trafił w plik z CRLF — dokładnie ta pomyłka dawała ciche sabotaże");

  const p = przygotujPodmiane(plik, "linia A\nlinia B", "linia A\nZEPSUTE");
  assert.equal(p.ok, true, p.powod);
  assert.equal(p.tresc, "linia A\r\nZEPSUTE\r\nlinia C\r\n",
    "podmiana rozjechała końcówki linii — plik zostałby zmieniony szerzej, niż chcieliśmy");
});

test("plik z LF zostaje przy LF", () => {
  const plik = "alfa\nbeta\n";
  assert.equal(koncowkaLinii(plik), "\n");
  assert.equal(dopasujKoncowki("alfa\r\nbeta", "\n"), "alfa\nbeta");
  const p = przygotujPodmiane(plik, "alfa\nbeta", "alfa\nGAMMA");
  assert.equal(p.tresc, "alfa\nGAMMA\n");
});

test("odmowa, gdy wzorzec nie występuje — to jest cały sens tego narzędzia", () => {
  const p = przygotujPodmiane("nic tu nie ma", "czegoTuNieMa()", "x");
  assert.equal(p.ok, false);
  assert.match(p.powod, /NIE WYSTĘPUJE/,
    "skrypt przepuściłby sabotaż, który nie zachodzi — a to gorsze niż brak sabotażu");
});

test("odmowa przy kilku trafieniach — inaczej mierzy się dwa eksperymenty naraz", () => {
  // Podmiana wszystkich wystąpień psuje kilka miejsc jednocześnie: test spada,
  // ale nie wiadomo, przez które. Wynik wygląda na dowód, a nim nie jest.
  const p = przygotujPodmiane("return true; ... return true;", "return true;", "return false;");
  assert.equal(p.ok, false);
  assert.match(p.powod, /2 razy/);
});

test("odmowa przy podmianie pozornej", () => {
  // Zamiennik identyczny z wzorcem to najczystszy przykład sabotażu, który
  // „przechodzi": plik się nie zmienia, testy są zielone, wniosek fałszywy.
  const p = przygotujPodmiane("if (a === b)", "if (a === b)", "if (a === b)");
  assert.equal(p.ok, false);
  assert.match(p.powod, /identyczne/);
});

test("potwierdzenie czyta stan PO zapisie, nie zamiar", () => {
  // Zmienna w pamięci nie jest dowodem — dowodem jest treść pliku z dysku.
  assert.equal(potwierdzPodmiane("nowa wersja", "stara", "nowa").ok, true);

  const nieweszla = potwierdzPodmiane("stara wersja", "stara", "nowa");
  assert.equal(nieweszla.ok, false);
  assert.match(nieweszla.powod, /nie weszła/);

  const obie = potwierdzPodmiane("stara i nowa", "stara", "nowa");
  assert.equal(obie.ok, false, "oryginalny fragment został, a mimo to uznano podmianę za udaną");
});

test("werdykt: brak spadku testów to OSTRZEŻENIE, nie sukces", () => {
  const w = werdykt({ blednePrzed: 0, blednePo: 0, blendePoPrzywroceniu: 0, plikPrzywrocony: true });
  assert.equal(w.ok, false, "sabotaż bez ani jednego czerwonego testu uznany za sukces");
  assert.equal(w.kod, 1, "kod wyjścia nie sygnalizuje problemu — CI by tego nie zauważyło");
  assert.match(w.tekst, /NIEZAUWAŻONY/);
});

test("werdykt: złapany sabotaż to jedyny wynik z kodem 0", () => {
  const w = werdykt({ blednePrzed: 0, blednePo: 2, blendePoPrzywroceniu: 0, plikPrzywrocony: true });
  assert.equal(w.ok, true);
  assert.equal(w.kod, 0);
  assert.match(w.tekst, /2/);
});

test("werdykt broni się przed pomiarem na czerwonym repo i przed brakiem przywrócenia", () => {
  // Czerwone testy PRZED sabotażem znaczą, że nie da się przypisać spadku zmianie.
  const czerwone = werdykt({ blednePrzed: 3, blednePo: 5, blendePoPrzywroceniu: 0, plikPrzywrocony: true });
  assert.equal(czerwone.kod, 2);
  assert.match(czerwone.tekst, /PRZED sabotażem/);

  // Najgroźniejszy przypadek: zepsuty kod ZOSTAJE w repo.
  const zostal = werdykt({ blednePrzed: 0, blednePo: 2, blendePoPrzywroceniu: 0, plikPrzywrocony: false });
  assert.equal(zostal.kod, 2);
  assert.match(zostal.tekst, /NIE ZOSTAŁ PRZYWRÓCONY/);

  // Przywrócony plik, ale testy dalej czerwone — przywrócenie nie zadziałało.
  const poPsu = werdykt({ blednePrzed: 0, blednePo: 2, blendePoPrzywroceniu: 1, plikPrzywrocony: true });
  assert.equal(poPsu.kod, 2);
  assert.match(poPsu.tekst, /po przywróceniu/);
});
