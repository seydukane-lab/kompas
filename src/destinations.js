// ============================================================
//  Destination Intelligence (ETA OS) — kuratorowana, OGÓLNA wiedza
//  o kierunkach: klimat, dla kogo, na co uważać (czerwone flagi), wskazówka.
//
//  To powszechnie znane fakty turystyczne (nie zmyślanie konkretów o hotelu).
//  Zasila: (1) lokalny „Raport doradcy" na karcie/w raporcie,
//          (2) prompt ETA OS dla Claude — żeby analiza stała na faktach z bazy,
//              a nie na wymyślonych szczegółach.
//  Dopasowanie po fragmencie nazwy regionu (case-insensitive, ł→l).
// ============================================================

// Każdy wpis: keys (fragmenty regionu/kraju do dopasowania) + intel.
const DEST = [
  // ---- EGIPT ----
  { keys: ["marsa alam", "marsa el"], vibe: "Spokój i najlepsza rafa Egiptu, mniej tłoczno", forWho: "nurkowie, pary, spokojny wypoczynek", watch: "daleko od lotniska (transfer 45–90 min), poza hotelami mało atrakcji", tip: "wybieraj hotel z domową rafą — snorkeling prosto z brzegu" },
  { keys: ["sharm"], vibe: "Światowej klasy rafy, żywe kurorty", forWho: "nurkowie, rodziny, pary", watch: "loty bywają z przesiadką; Naama Bay gwarna", tip: "Nabq / Sharks Bay = spokojniej niż centrum" },
  { keys: ["hurghada"], vibe: "Duży wybór, dobre ceny, sporty wodne", forWho: "budżet, rodziny, wypad ze znajomymi", watch: "część plaż płytka lub z trawą morską; miasto rozległe", tip: "Sahl Hasheesh / Makadi Bay = wyższy standard i lepsze plaże" },
  { keys: ["makadi"], vibe: "Zatoka z ładnymi plażami i rafą, spokojniej niż Hurghada", forWho: "rodziny, pary", watch: "to strefa hotelowa — poza resortami niewiele", tip: "dobre wejście do morza dla dzieci" },

  // ---- TURCJA ----
  { keys: ["belek"], vibe: "Topowe 5★ resorty, golf, aquaparki", forWho: "rodziny premium, golfiści, pary", watch: "drożej; plaże miejscami z drobnym żwirem", tip: "najlepszy wybór wielkich aquaparków w Turcji" },
  { keys: ["lara", "antalya"], vibe: "Duże resorty tuż przy lotnisku", forWho: "rodziny, pary", watch: "część plaż piaszczysto-żwirowa", tip: "blisko klimatycznej starówki Kaleiçi" },
  { keys: ["side"], vibe: "Antyczne ruiny w tle plaż", forWho: "rodziny, pary, zwiedzanie", watch: "centrum bywa gwarne i handlowe", tip: "Çolaklı / Kumköy = spokojniej" },
  { keys: ["alanya"], vibe: "Tanio, żywo, długa plaża Kleopatry", forWho: "budżet, młodzież, rodziny", watch: "dłuższy transfer z Antalyi (~2 h)", tip: "Okurcalar / Avsallar = ciszej" },
  { keys: ["kemer"], vibe: "Góry Taurus schodzą do morza, sosny", forWho: "pary, aktywni, miłośnicy widoków", watch: "plaże przeważnie kamieniste (żwir)", tip: "świetne na trekking i naturę" },
  { keys: ["bodrum"], vibe: "Modny, biało-niebieski klimat", forWho: "pary, wyższy standard", watch: "wiele plaż to pomosty — mało piasku", tip: "Turgutreis słynie z zachodów słońca" },
  { keys: ["marmaris"], vibe: "Zielona zatoka, żywe życie nocne", forWho: "młodzież, rodziny", watch: "Bar Street bardzo głośny", tip: "İçmeler obok = znacznie spokojniej" },
  { keys: ["kusadasi", "kuşadası", "kusadasi"], vibe: "Baza do Efezu, żywe miasteczko", forWho: "rodziny, zwiedzanie", watch: "gwarno w szczycie sezonu", tip: "koniecznie wypad do Efezu / Pamukkale" },

  // ---- GRECJA ----
  { keys: ["kreta"], vibe: "Największa wyspa, ogromna różnorodność", forWho: "praktycznie każdy", watch: "zachód (Chania) inny niż wschód (Heraklion/Lasithi) — sprawdź konkretny region", tip: "Elounda = premium, Malia = impreza, Rethymno = złoty środek" },
  { keys: ["rodos", "rhodes"], vibe: "Dużo słońca, historia, dobre plaże", forWho: "rodziny, pary", watch: "wschodnie wybrzeże wietrzniejsze (fajne dla windsurfingu)", tip: "Lindos = widoki, Faliraki = rodzinnie i rozrywkowo" },
  { keys: ["zakynthos", "zakintos"], vibe: "Piękne plaże, słynne Navagio", forWho: "pary, rodziny lub młodzież — zależnie od kurortu", watch: "Laganas = mocno imprezowo, młodzieżowo", tip: "Tsilivi / Alykes = rodzinnie i spokojnie" },
  { keys: ["korfu", "corfu"], vibe: "Najbardziej zielona wyspa, włoski sznyt", forWho: "pary, rodziny", watch: "część plaż kamienista", tip: "północ i zachód spokojniejsze" },
  { keys: ["kos"], vibe: "Płaska, rowerowa, długie plaże", forWho: "rodziny, aktywni", watch: "Kardamena mocno imprezowa", tip: "Kefalos = spokój na końcu wyspy" },
  { keys: ["santorini"], vibe: "Widoki i romantyzm klasy światowej", forWho: "pary, nowożeńcy", watch: "plaże wulkaniczne (ciemny piasek), drogo, mało dla dzieci", tip: "to kierunek widokowy, nie typowo plażowy" },
  { keys: ["chalkidiki", "chalcydyki", "gerakini", "kassandra", "sithonia"], vibe: "Sosny nad czystym morzem, blisko Salonik", forWho: "rodziny, pary", watch: "trzy palce różnią się — sprawdź który", tip: "Kassandra żywsza, Sithonia dziksza i spokojniejsza" },
  { keys: ["kefalonia", "kefalinia"], vibe: "Dzika, górzysta, turkusowe zatoki", forWho: "pary, spokojny wypoczynek, samochód", watch: "atrakcje rozrzucone — warto wynająć auto", tip: "plaża Myrtos to wizytówka wyspy" },

  // ---- TUNEZJA ----
  { keys: ["hammamet"], vibe: "Ogrody, spokój, blisko Tunisu", forWho: "pary, rodziny, budżet", watch: "morze bywa faliste", tip: "Yasmine Hammamet = nowocześniejsza część" },
  { keys: ["djerba", "dżerba", "dzerba"], vibe: "Wyspa palm, spokój, słońce niemal cały rok", forWho: "spokojny wypoczynek, pary", watch: "położona dalej, klimat senny", tip: "spokojniejsza niż kurorty kontynentalne" },
  { keys: ["monastir", "sousse", "skanes", "kantaoui"], vibe: "Klasyczne czartery, dobre ceny", forWho: "rodziny, budżet", watch: "część hoteli starszej daty — patrz na rok remontu", tip: "Port El Kantaoui = ładna marina" },

  // ---- HISZPANIA ----
  { keys: ["majorka", "mallorca", "alcudia"], vibe: "Wyspa dla każdego — od imprezy po ciszę", forWho: "wszyscy", watch: "Magaluf / S'Arenal mocno imprezowe", tip: "Alcudia / Pollensa = rodzinnie" },
  { keys: ["gran canaria", "meloneras", "maspalomas"], vibe: "Całoroczne słońce, słynne wydmy", forWho: "pary, seniorzy, rodziny", watch: "na południu potrafi wiać", tip: "Maspalomas = wydmy i długa plaża" },
  { keys: ["teneryfa", "tenerife", "adeje"], vibe: "Całoroczna, wulkan Teide", forWho: "wszyscy", watch: "plaże wulkaniczne (ciemny lub dowożony piasek)", tip: "Costa Adeje = strona premium i cieplejsza" },
  { keys: ["fuerteventura", "corralejo", "costa calma"], vibe: "Wiatr, surfing, dzikie plaże", forWho: "aktywni, surferzy, pary", watch: "wietrznie (raj dla kite/windsurf, mniej dla parawanu)", tip: "Corralejo = wielkie wydmy" },
  { keys: ["lanzarote", "playa blanca"], vibe: "Księżycowe krajobrazy wulkaniczne", forWho: "pary, rodziny, estetyka", watch: "surowa natura, mniej zieleni", tip: "architektura Césara Manrique" },
  { keys: ["ibiza"], vibe: "Imprezowa stolica Śródziemnomorza", forWho: "młodzież, imprezowicze", watch: "drogo i głośno w sezonie", tip: "Santa Eulalia = spokojniejsza strona wyspy" },
  { keys: ["costa del sol", "estepona", "malaga"], vibe: "Andaluzja, słońce, życie miejskie", forWho: "pary, rodziny, city+plaża", watch: "plaże często ciemnego piasku", tip: "łącz plażę ze zwiedzaniem (Malaga, Marbella)" },
  { keys: ["costa brava", "costa de la luz", "chiclana"], vibe: "Szeroka, złota plaża (Costa de la Luz)", forWho: "rodziny, pary", watch: "atlantyckie fale i wiatr", tip: "jedne z najlepszych piaszczystych plaż Hiszpanii" },

  // ---- WŁOCHY / PORTUGALIA / BAŁKANY / CYPR ----
  { keys: ["sardynia", "villasimius", "santa teresa"], vibe: "Karaibskie plaże Europy", forWho: "pary, rodziny, estetyka", watch: "drogo; auto bardzo się przydaje", tip: "woda jak na Karaibach, ale ceny włoskie" },
  { keys: ["sycylia", "taormina", "licata", "augusta"], vibe: "Historia, wulkan Etna, kuchnia", forWho: "pary, zwiedzanie + plaża", watch: "część plaż kamienista; upały w VII–VIII", tip: "Taormina = perła, ale tłoczna" },
  { keys: ["algarve", "albufeira", "armacao"], vibe: "Klify, złote plaże, golf", forWho: "rodziny, pary, golfiści", watch: "Atlantyk chłodniejszy niż Śródziemne", tip: "Lagos i groty Benagil to hit" },
  { keys: ["madera", "madeira", "machico"], vibe: "Wyspa wiecznej wiosny, natura i levady", forWho: "aktywni, pary, seniorzy", watch: "to nie kierunek plażowy (skaliste wybrzeże)", tip: "raj dla trekkingu, nie dla parawanu" },
  { keys: ["sloneczny brzeg", "słoneczny brzeg", "nessebar", "sunny beach"], vibe: "Tanio, szeroka piaszczysta plaża, żywo", forWho: "budżet, młodzież, rodziny", watch: "Słoneczny Brzeg bywa bardzo imprezowy", tip: "Nessebar starówka = urok UNESCO" },
  { keys: ["albania", "saranda", "durres", "golem"], vibe: "Rosnąca gwiazda, dobre ceny, ładne morze", forWho: "budżet, odkrywcy, rodziny", watch: "infrastruktura miejscami jeszcze się rozwija", tip: "Riwiera Albańska (Saranda/Ksamil) = najładniejsze plaże" },
  { keys: ["ayia napa", "cypr", "pafos", "napa"], vibe: "Turkusowe morze, dużo słońca", forWho: "Ayia Napa: młodzież/impreza; Pafos: rodziny/pary", watch: "Ayia Napa = imprezowa stolica wyspy", tip: "Protaras / Pafos = spokojniej i rodzinnie" },

  // ---- EGZOTYKA ----
  { keys: ["malediwy", "atoll", "male"], vibe: "Rajowe wyspy, rafa, wille nad wodą", forWho: "pary, nowożeńcy, nurkowie", watch: "drogo; transfer hydroplanem/łodzią bywa dodatkowo płatny", tip: "sprawdź, czy wyspa ma dobrą rafę domową" },
  { keys: ["zanzibar", "nungwi", "kiwengwa"], vibe: "Biały piasek, przyprawy, turkus", forWho: "pary, spokojny wypoczynek", watch: "silne pływy — odpływ potrafi odsłonić dno na godziny", tip: "Nungwi / Kendwa = najmniejsze pływy, kąpiel cały dzień" },
  { keys: ["punta cana", "dominikana", "bavaro", "arena gorda"], vibe: "Długie plaże, All Inclusive, palmy", forWho: "rodziny, pary, wypad ze znajomymi", watch: "sezon huraganów VIII–X; miejscami sargassum", tip: "Bavaro to klasyk z dobrą infrastrukturą" },
  { keys: ["riviera maya", "cancun", "cancún", "meksyk"], vibe: "Karaiby, cenoty, kultura Majów", forWho: "pary, rodziny, zwiedzanie", watch: "sargassum bywa V–IX; Cancún głośniejszy niż Riviera Maya", tip: "koniecznie cenoty i Tulum" },
  { keys: ["phuket", "krabi", "tajlandia", "kata", "patong", "ao nang"], vibe: "Egzotyka, kuchnia, rajskie wyspy", forWho: "pary, aktywni, odkrywcy", watch: "pora deszczowa V–X (Phuket); Patong bardzo imprezowy", tip: "Krabi / Kata = spokojniej niż Patong" },
  { keys: ["sri lanka", "ahungalla", "beruwala", "bentota"], vibe: "Herbata, safari, plaże Oceanu Indyjskiego", forWho: "objazd + plaża, pary, ciekawi świata", watch: "pogoda zależy od strony wyspy i pory roku", tip: "łącz zwiedzanie (Kandy, safari) z wypoczynkiem" },
  { keys: ["mauritius", "belle mare", "piments"], vibe: "Laguny, rafa, klimat luksusu", forWho: "pary, premium, nowożeńcy", watch: "drogo; wschód wyspy wietrzniejszy", tip: "zachód i północ = spokojniejsze morze" },
  { keys: ["bali", "nusa dua", "benoa", "indonezja"], vibe: "Świątynie, tarasy ryżowe, surf", forWho: "pary, aktywni, duchowo", watch: "korki na południu; nie każda plaża nadaje się do kąpieli", tip: "Nusa Dua = spokojne, bezpieczne kąpieliska" },
  { keys: ["wietnam", "nha trang", "phu quoc"], vibe: "Plaże + bogata kultura, świetne ceny", forWho: "objazd + plaża, pary, budżet-egzotyka", watch: "pora deszczowa różni się mocno między regionami", tip: "łącz północ (Halong) z plażowym południem" },
  { keys: ["zielonego przyladka", "zielonego przylądka", "sal", "santa maria", "boa vista"], vibe: "Całoroczne słońce blisko Europy (6 h lotu)", forWho: "spokój zimą, kitesurferzy", watch: "wietrznie; wyspy Sal/Boa Vista pustynne, mało zieleni", tip: "Santa Maria (Sal) = główna, długa plaża" },
  { keys: ["kenia", "diani", "mombasa"], vibe: "Safari + ocean w jednym", forWho: "łączenie safari z plażą, pary", watch: "wymaga szczepień/profilaktyki — sprawdź zalecenia", tip: "Diani Beach = jedna z najlepszych plaż Afryki" },
];

// Normalizacja do dopasowania: małe litery, ł→l, bez diakrytyków.
function norm(s) {
  return String(s || "").toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Zwraca intel dla regionu/kraju (pierwsze trafienie) albo null.
export function destIntel(region, country) {
  const hay = norm(region) + " " + norm(country);
  for (const d of DEST) {
    if (d.keys.some((k) => hay.includes(norm(k)))) {
      return { vibe: d.vibe, forWho: d.forWho, watch: d.watch, tip: d.tip };
    }
  }
  return null;
}

// Cała baza (do endpointu /api/destinations dla frontu).
export function allDestinations() {
  return DEST;
}
