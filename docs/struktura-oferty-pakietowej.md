# Struktura oferty pakietowej — model danych dla seeda demo

Opis kształtu, jaki ma oferta wycieczki pakietowej w systemach sprzedażowych biur podróży.
Spisane z obserwacji publicznych serwisów touroperatorów i z praktyki sprzedażowej.
Służy do budowy **danych demonstracyjnych** — wszystkie liczby w seedzie są generowane,
żaden rekord nie pochodzi z systemu zewnętrznego.

## Zasada nadrzędna: hotel ≠ oferta

Najważniejsza różnica względem pierwotnego seeda. Konsultant nie wybiera „oferty" —
wybiera **hotel**, a potem **wariant** spośród kilkunastu. Jeden obiekt potrafi mieć
10+ wariantów różniących się operatorem, lotniskiem, datą i ceną.

```
HOTEL (obiekt fizyczny — nazwa, kategoria, lokalizacja, plaża, opinie)
 └── WARIANT 1: operator A · KTW · 19.08–26.08 · 8d/7n · 5349/os · 10698 razem
 └── WARIANT 2: operator A · WRO · 21.08–28.08 · 8d/7n · 5299/os · 10598 razem
 └── WARIANT 3: operator B · KTW · 19.08–26.08 · 8d/7n · 9101/os · 10521 razem
     └── opcje pokoju (dopłata lub „w cenie")
     └── opcje wyżywienia
```

Uwaga na wariant 3: cena za osobę **wyższa** (9101 vs 5349), a suma **niższa**
(10521 vs 10698). To nie błąd — część operatorów stosuje promocje typu „druga osoba
za symboliczną kwotę", więc cena/os. przestaje być porównywalna między operatorami.
**Dlatego konsultant sortuje po SUMIE, nie po cenie za osobę** — i dlatego Kompas
musi pokazywać obie liczby, nigdy samej ceny „od".

## Pola hotelu (wspólne dla wszystkich wariantów)

| Pole | Przykład | Uwagi |
|---|---|---|
| nazwa | „RH Canfali" | |
| kategoria | 4★ | osobno od oceny gości |
| lokalizacja | Hiszpania / Costa Blanca / Benidorm | trzy poziomy: kraj / region / miejscowość |
| ocena zewnętrzna | 4,5 + liczba recenzji (957) | źródło zewnętrzne (TripAdvisor), skala 1–5 |
| odległość od plaży | 28 m | w metrach, nie „blisko plaży" |

## Pola wariantu

| Pole | Przykład |
|---|---|
| operator | touroperator sprzedający ten wyjazd |
| lotnisko wylotu | KTW, WRO, WAW, POZ, GDN, KRK |
| termin | 19.08 – 26.08.2026 |
| długość | 8d / 7n — **dni ≠ noce**, i bywa 9d/7n |
| cena za osobę | 5349 PLN |
| suma | 10698 PLN |
| lot bezpośredni | tak/nie |
| gwarancja TFG | znacznik bezpieczeństwa (Turystyczny Fundusz Gwarancyjny) |
| rezerwacja opcjonalna do | data + godzina — opcja wygasa |

### Przelot (osobno tam i z powrotem)

| Pole | Przykład |
|---|---|
| przewoźnik | WizzAir (samolot rejsowy) |
| numer rejsu | W61079 |
| godziny | 05:30 → 08:40 |
| trasa | KTW Katowice → ALC Alicante |
| bagaż podręczny | 5 kg |
| wolne miejsca | 5 (albo `*` = brak informacji) |

Wolne miejsca bywają podane tylko dla lotu tam — powrót pokazuje `*`. To realny
przypadek „brak danych", który UI musi umieć pokazać bez zmyślania.

### Zakwaterowanie

Lista opcji pokoju do wyboru, każda z dopłatą:
- „Standard Double Standard Room (CityView, Promotion)" — **w cenie**
- „Standard Double Standard Room (CityView)" — **+400 PLN**

Do każdej opcji chipy opisowe: `Pokój dwuosobowy`, `Widok na miasto`.
Ta sama nazwa pokoju bywa u każdego operatora inaczej sformatowana
(`DOUBLE STANDARD ROOM` vs `Standard Double Standard`) — stąd dopasowywanie
po nazwie jest zawodne.

### Wyżywienie

Lista opcji, zwykle jedna wybrana. Nazewnictwo **niespójne między operatorami**:
„Śniadania i obiadokolacje" u jednego, „Half Board" u drugiego, „Śniadanie
i obiadokolacja" (liczba pojedyncza) u trzeciego — to ten sam produkt.

### Atrybuty oferty

Chipy: `Transfer w cenie`, `Lot bezpośredni`, `Assistance`.
To cechy **wariantu**, nie hotelu — ten sam hotel u innego operatora może być bez transferu.

### Historia ceny (za osobę)

- poprzednia cena
- najniższa cena z ostatnich 30 dni
- **wykres cen wg daty wylotu** — kilkanaście słupków (data → cena), z wyróżnionym
  najtańszym terminem

To jest realne narzędzie sprzedażowe: „gdyby Pan poleciał dzień później, jest 580 zł taniej".

## Co z tego wynika dla Kompasa

1. **Sortowanie po sumie musi być domyślne**, nie po cenie za osobę.
2. Filtr operatora / lotniska wylotu ma sens dopiero, gdy jeden hotel ma wiele wariantów.
3. Karta wyniku powinna pokazywać hotel raz, a warianty pod nim — inaczej lista
   dziesięciu wierszy tego samego hotelu zapycha ekran.
4. Wykres ceny wg daty wylotu to najmocniejszy argument sprzedażowy w całym widoku
   i nie ma go dziś w Kompasie.
5. „Brak danych" jest normalnym stanem (wolne miejsca `*`), nie awarią.
