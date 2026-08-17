// ============================================================
//  Hamulec na zgadywanie haseł
//
//  Panel stoi publicznie i chroni go samo logowanie, więc jakiś limit prób
//  musi być. Problem w tym, że liczenie WYŁĄCZNIE po adresie IP nie pasuje do
//  miejsca, w którym Kompas ma pracować: całe biuro wychodzi do internetu
//  jednym adresem. Przy progu 5 prób jedna osoba, która trzy razy pomyli hasło
//  i dwa razy wpisze stare, potrafi zamknąć panel CAŁEMU zespołowi na kwadrans
//  — i to pierwszego dnia pilotażu, kiedy nikt jeszcze hasła nie pamięta.
//
//  Dlatego liczymy w dwóch wymiarach naraz:
//  · per KONTO (niski próg) — chroni jedno konto przed zgadywaniem, także wtedy,
//    gdy próby lecą z wielu adresów;
//  · per ADRES (wysoki próg) — łapie „spryskiwanie" wielu kont z jednego miejsca,
//    ale nie reaguje na pojedynczą osobę mylącą własne hasło.
//
//  Udane logowanie zeruje licznik konta i ZDEJMUJE JEGO WKŁAD z licznika adresu:
//  własne pomyłki po poprawnym wejściu nie mają już znaczenia, ale próby na cudze
//  konta z tego samego adresu zostają policzone. Bez tego jedno poprawne logowanie
//  w biurze kasowałoby cały ślad trwającego ataku.
//
//  Stan trzymamy w pamięci procesu — przy jednym serwerze pilotażowym to wystarcza,
//  a restart i tak przerywa atak skuteczniej niż licznik.
// ============================================================

const OKNO_MS = 15 * 60 * 1000;
const MAX_NA_KONTO = 5;
const MAX_NA_ADRES = 20;

// Klucz konta: bez wielkości liter i spacji dookoła, żeby „ Adam@X.pl " i „adam@x.pl"
// były jedną i tą samą próbą, a nie dwiema osobnymi pulami do wyczerpania.
function kluczKonta(email) {
  return String(email || "").trim().toLowerCase();
}

export function utworzHamulec(opcje = {}) {
  const oknoMs = opcje.oknoMs ?? OKNO_MS;
  const maxNaKonto = opcje.maxNaKonto ?? MAX_NA_KONTO;
  const maxNaAdres = opcje.maxNaAdres ?? MAX_NA_ADRES;
  const teraz = opcje.teraz ?? (() => Date.now());

  const konta = new Map();
  const adresy = new Map();

  function odczyt(mapa, klucz) {
    const wpis = mapa.get(klucz);
    if (!wpis) return null;
    if (teraz() - wpis.od > oknoMs) { mapa.delete(klucz); return null; }
    return wpis;
  }

  function dolicz(mapa, klucz) {
    const wpis = odczyt(mapa, klucz);
    if (!wpis) { mapa.set(klucz, { ile: 1, od: teraz() }); return; }
    wpis.ile += 1;
  }

  return {
    /** Czy tę próbę odrzucamy bez sprawdzania hasła. */
    zablokowane({ email, ip } = {}) {
      const konto = odczyt(konta, kluczKonta(email));
      if (konto && konto.ile >= maxNaKonto) return true;
      const adres = odczyt(adresy, ip || "?");
      return !!(adres && adres.ile >= maxNaAdres);
    },

    /** Nieudana próba: liczy się i kontu, i adresowi. */
    nieudana({ email, ip } = {}) {
      dolicz(konta, kluczKonta(email));
      dolicz(adresy, ip || "?");
    },

    /** Udane wejście: zeruje konto i zdejmuje jego wkład z puli adresu. */
    udana({ email, ip } = {}) {
      const klucz = kluczKonta(email);
      const konto = odczyt(konta, klucz);
      const wlasne = konto ? konto.ile : 0;
      konta.delete(klucz);
      const adres = odczyt(adresy, ip || "?");
      if (!adres) return;
      adres.ile -= wlasne;
      if (adres.ile <= 0) adresy.delete(ip || "?");
    },

    /** Do testów i do panelu diagnostycznego. */
    stan({ email, ip } = {}) {
      return {
        konto: odczyt(konta, kluczKonta(email))?.ile ?? 0,
        adres: odczyt(adresy, ip || "?")?.ile ?? 0,
        maxNaKonto,
        maxNaAdres,
      };
    },

    wyczysc() { konta.clear(); adresy.clear(); },
  };
}
