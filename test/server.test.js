// ============================================================
//  Serwer od strony przeglądarki (test end-to-end po HTTP)
//
//  Testy modułów sprawdzają logikę, ale to nie one wpuszczają ludzi
//  do panelu — robi to Express z kolejnością middleware'ów. Ten plik
//  startuje prawdziwy serwer na własnej bazie i puka do niego tak,
//  jak robi to panel: ciasteczkiem sesji.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "kompas-srv-"));
const DB_PATH = join(dir, "srv.db");
const PORT = 3400 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;

const ADMIN = { email: "admin@test.local", pass: "haslo12345" };
const KONSULTANT = { email: "konsultant@test.local", pass: "haslo12345" };

let serwer;

function zalozKonto(email, name, pass, role) {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "user.js"), "add", email, name, pass, ...(role ? [role] : [])],
    { cwd: ROOT, env: { ...process.env, DB_PATH }, encoding: "utf8" });
  assert.equal(r.status, 0, `nie udało się założyć konta: ${r.stderr || r.stdout}`);
}

async function zaloguj(email, password) {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) return null;
  return r.headers.get("set-cookie").split(";")[0];
}

test.before(async () => {
  zalozKonto(ADMIN.email, "Admin Testowy", ADMIN.pass, "admin");
  zalozKonto(KONSULTANT.email, "Konsultant Testowy", KONSULTANT.pass);

  serwer = spawn(process.execPath, [join(ROOT, "server.js")], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH, PORT: String(PORT), NODE_ENV: "test" },
    stdio: "ignore",
  });

  // Czekamy, aż zacznie odpowiadać — bez sztywnego sleepa.
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const r = await fetch(BASE + "/healthz");
      if (r.ok) break;
    } catch { /* jeszcze nie wstał */ }
    if (Date.now() > deadline) throw new Error("serwer nie wstał w 20 s");
    await new Promise((r) => setTimeout(r, 200));
  }
});

test.after(async () => {
  // Windows nie pozwoli usunąć pliku bazy, dopóki serwer go trzyma —
  // najpierw czekamy, aż proces naprawdę zniknie.
  if (serwer && serwer.exitCode === null) {
    await new Promise((resolve) => {
      serwer.once("exit", resolve);
      serwer.kill();
      setTimeout(resolve, 3000).unref();
    });
  }
  // Katalog tymczasowy to nie jest coś, dla czego warto wywalić cały przebieg testów.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.warn("nie udało się posprzątać katalogu testowego:", err.code);
  }
});

test("healthcheck odpowiada bez logowania", async () => {
  const r = await fetch(BASE + "/healthz");
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(typeof d.uptime, "number");
});

test("panel bez sesji przekierowuje na logowanie", async () => {
  const r = await fetch(BASE + "/", { redirect: "manual" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/login.html");
});

test("ekran logowania jest dostępny bez sesji", async () => {
  const r = await fetch(BASE + "/login.html");
  assert.equal(r.status, 200);
});

test("API bez sesji jest zamknięte", async () => {
  for (const sciezka of ["/api/search?dest=Egipt", "/api/cart", "/api/status", "/api/users", "/api/countries"]) {
    const r = await fetch(BASE + sciezka);
    assert.equal(r.status, 401, `${sciezka} powinno wymagać logowania, dostałem ${r.status}`);
  }
});

test("złe hasło nie wpuszcza i nie zdradza, czy konto istnieje", async () => {
  const zle = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN.email, password: "nieprawidlowe" }),
  });
  const nieistnieje = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "nikt@test.local", password: "cokolwiek123" }),
  });
  assert.equal(zle.status, 401);
  assert.equal(nieistnieje.status, 401);
  assert.equal((await zle.json()).error, (await nieistnieje.json()).error);
});

// Blokada po serii pomyłek ma dotyczyć KONTA, nie całego biura — wszyscy
// konsultanci wychodzą do internetu jednym adresem IP (patrz src/login-limit.js).
// Test celowo dobija konto, które nie istnieje, żeby nie zablokować pozostałym
// testom logowania na admina i konsultanta.
test("seria pomyłek blokuje jedno konto, a nie logowanie z tego samego adresu", async () => {
  const proba = (email) => fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "zle-haslo-123" }),
  });

  const atakowane = "atakowane@test.local";
  let ostatni = null;
  for (let i = 0; i < 6; i++) ostatni = await proba(atakowane);

  assert.equal(ostatni.status, 429, "po serii pomyłek konto powinno dostać 429, a nie kolejne 401");

  // Ten sam adres IP, inne konto i PRAWIDŁOWE hasło — musi wejść.
  const cookie = await zaloguj(KONSULTANT.email, KONSULTANT.pass);
  assert.ok(cookie, "blokada objęła cały adres IP — w biurze oznaczałoby to odcięcie wszystkich");
});

test("po zalogowaniu panel i API są dostępne", async () => {
  const cookie = await zaloguj(KONSULTANT.email, KONSULTANT.pass);
  assert.ok(cookie, "logowanie nie zwróciło ciasteczka");
  assert.match(cookie, /^kompas_sid=/);

  const panel = await fetch(BASE + "/", { headers: { cookie }, redirect: "manual" });
  assert.equal(panel.status, 200);

  const me = await fetch(BASE + "/api/auth/me", { headers: { cookie } });
  assert.equal((await me.json()).user.email, KONSULTANT.email);
});

test("ciasteczko sesji jest HttpOnly i SameSite", async () => {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.pass }),
  });
  const setCookie = r.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i, "ciasteczko musi być niedostępne dla JavaScriptu");
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//);
});

test("konsultant nie ma dostępu do zarządzania kontami", async () => {
  const cookie = await zaloguj(KONSULTANT.email, KONSULTANT.pass);
  const lista = await fetch(BASE + "/api/users", { headers: { cookie } });
  assert.equal(lista.status, 403);

  const proba = await fetch(BASE + "/api/users", {
    method: "POST", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ email: "podszywacz@test.local", password: "haslo12345", role: "admin" }),
  });
  assert.equal(proba.status, 403, "konsultant nie może założyć sobie konta administratora");
});

test("administrator zarządza kontami, ale nie wyłączy własnego", async () => {
  const cookie = await zaloguj(ADMIN.email, ADMIN.pass);
  const lista = await fetch(BASE + "/api/users", { headers: { cookie } });
  assert.equal(lista.status, 200);
  const { users } = await lista.json();
  assert.ok(users.length >= 2);

  const ja = users.find((u) => u.email === ADMIN.email);
  const proba = await fetch(BASE + `/api/users/${ja.id}/active`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ active: false }),
  });
  assert.equal(proba.status, 400, "ostatni admin nie może zamknąć sobie drzwi od środka");
});

test("koszyk jest prywatny dla konta", async () => {
  const admin = await zaloguj(ADMIN.email, ADMIN.pass);
  const konsultant = await zaloguj(KONSULTANT.email, KONSULTANT.pass);

  const zapis = await fetch(BASE + "/api/cart", {
    method: "PUT", headers: { "Content-Type": "application/json", cookie: admin },
    body: JSON.stringify({ items: [{ id: "h1", name: "Hotel Admina" }] }),
  });
  assert.equal(zapis.status, 200);

  const mojKoszyk = await (await fetch(BASE + "/api/cart", { headers: { cookie: admin } })).json();
  const cudzyKoszyk = await (await fetch(BASE + "/api/cart", { headers: { cookie: konsultant } })).json();
  assert.equal(mojKoszyk.items.length, 1);
  assert.equal(cudzyKoszyk.items.length, 0, "konsultant nie może zobaczyć koszyka administratora");
});

test("koszyk odrzuca dane w złym kształcie", async () => {
  const cookie = await zaloguj(ADMIN.email, ADMIN.pass);
  const r = await fetch(BASE + "/api/cart", {
    method: "PUT", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ items: "to nie jest lista" }),
  });
  assert.equal(r.status, 400);
});

test("wylogowanie unieważnia ciasteczko", async () => {
  const cookie = await zaloguj(KONSULTANT.email, KONSULTANT.pass);
  const wyloguj = await fetch(BASE + "/api/auth/logout", { method: "POST", headers: { cookie } });
  assert.equal(wyloguj.status, 200);

  const po = await fetch(BASE + "/api/cart", { headers: { cookie } });
  assert.equal(po.status, 401, "ten sam token nie może już działać");
});

test("status podaje dostawców i kurs waluty", async () => {
  const cookie = await zaloguj(ADMIN.email, ADMIN.pass);
  const d = await (await fetch(BASE + "/api/status", { headers: { cookie } })).json();
  assert.ok(Array.isArray(d.providers));
  assert.ok(d.fx && d.fx.eurPln > 0, "panel musi wiedzieć, po jakim kursie liczy ceny");
});

test("odpowiedzi mają nagłówki bezpieczeństwa", async () => {
  for (const sciezka of ["/login.html", "/healthz"]) {
    const r = await fetch(BASE + sciezka);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", sciezka);
    assert.equal(r.headers.get("x-frame-options"), "DENY", `${sciezka} — panel nie może działać w cudzej ramce`);
    assert.equal(r.headers.get("referrer-policy"), "same-origin", sciezka);
  }
});

test("zbyt duży koszyk jest odrzucany, a nie połykany", async () => {
  const cookie = await zaloguj(ADMIN.email, ADMIN.pass);
  // Ponad limit 256 kB — ktoś mógłby tak zapychać bazę bez końca.
  const wielki = { items: Array.from({ length: 4000 }, (_, i) => ({ id: "h" + i, name: "x".repeat(100) })) };
  const r = await fetch(BASE + "/api/cart", {
    method: "PUT", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(wielki),
  });
  assert.ok(r.status >= 400, `oczekiwano odmowy, dostałem ${r.status}`);
  // Serwer musi to przeżyć.
  assert.equal((await fetch(BASE + "/healthz")).status, 200);
});

test("uszkodzony JSON nie wywraca serwera", async () => {
  const cookie = await zaloguj(ADMIN.email, ADMIN.pass);
  const r = await fetch(BASE + "/api/cart", {
    method: "PUT", headers: { "Content-Type": "application/json", cookie },
    body: "{to nie jest json",
  });
  assert.ok(r.status >= 400);
  assert.equal((await fetch(BASE + "/healthz")).status, 200);
});

test("podrobione ciasteczko sesji nie wpuszcza", async () => {
  for (const falsywka of ["kompas_sid=zmyslony", "kompas_sid=", "kompas_sid=" + "a".repeat(43)]) {
    const r = await fetch(BASE + "/api/cart", { headers: { cookie: falsywka } });
    assert.equal(r.status, 401, `token „${falsywka}" nie może działać`);
  }
});

test("multiroom bez sensownych pokoi nie wywraca serwera", async () => {
  const cookie = await zaloguj(ADMIN.email, ADMIN.pass);
  for (const rooms of ["nie-json", "{}", "[]", '[{"adults":-5}]']) {
    const r = await fetch(BASE + `/api/multiroom?rooms=${encodeURIComponent(rooms)}`, { headers: { cookie } });
    // 502/429 = awaria albo limit po stronie dostawcy; też akceptowalne,
    // bo test sprawdza odporność serwera, a nie dostępność Hotelbedsa.
    assert.ok([200, 429, 500, 502, 503].includes(r.status), `nieoczekiwany status ${r.status} dla rooms=${rooms}`);
  }
  assert.equal((await fetch(BASE + "/healthz")).status, 200);
});

test("nieznana ścieżka nie wywraca serwera", async () => {
  const r = await fetch(BASE + "/api/nie-ma-takiego-endpointu");
  assert.ok(r.status === 401 || r.status === 404, `nieoczekiwany status ${r.status}`);
  // Serwer nadal żyje.
  assert.equal((await fetch(BASE + "/healthz")).status, 200);
});

// ============================================================
//  Kryterium, ktorego serwer nie rozumie
//
//  hasAttribute() zwraca dla nieznanego klucza `undefined` = brak danych, a brak
//  danych swiadomie NIE odsiewa ofert. Bez przechwycenia takiego klucza po stronie
//  serwera filtr przepuszcza caly katalog, a panel liczy go jako aktywny -
//  konsultant czyta pelna liste jako spelniajaca kryterium, o ktore pytal klient.
// ============================================================

test("kryterium, ktorego serwer nie zna, wraca po nazwie zamiast cicho nie filtrowac", async () => {
  const cookie = await zaloguj(KONSULTANT.email, KONSULTANT.pass);
  assert.ok(cookie, "nie udalo sie zalogowac konsultanta");

  const r = await fetch(BASE + "/api/search?countries=Egipt&adults=2&attrs=plaza-blisko", { headers: { cookie } });
  assert.equal(r.status, 200);
  const d = await r.json();

  assert.deepEqual(d.attrsNieznane, ["plaza-blisko"],
    "serwer nie zglosil nieznanego kryterium - filtr nie odsial niczego, a nikt o tym nie wie");
  // Nieznany klucz nie ma prawa udawac policzonego pokrycia atrybutu.
  const pokrycia = (d.attrs || []).map((a) => a.key);
  assert.ok(!pokrycia.includes("plaza-blisko"),
    "nieznane kryterium trafilo do statystyk pokrycia jak gdyby bylo prawdziwa cecha");
});

test("znane kryterium nie wywoluje falszywego alarmu o nieuzytym filtrze", async () => {
  const cookie = await zaloguj(KONSULTANT.email, KONSULTANT.pass);
  const r = await fetch(BASE + "/api/search?countries=Egipt&adults=2&attrs=plaza", { headers: { cookie } });
  const d = await r.json();

  assert.equal(d.attrsNieznane, undefined,
    "poprawny klucz zglaszany jako nieznany - panel bilby na alarm przy kazdym wyszukiwaniu");
});

// ============================================================
//  /healthz mówi, KTÓRA wersja stoi pod tym adresem
//
//  Auto-deploy jest wyłączony, więc push nie jest wdrożeniem, a kliknięcie
//  „Deploy" nie jest dowodem, że wdrożenie się udało. Bez tego pola jedynym
//  sposobem sprawdzenia produkcji jest zalogowanie się do panelu hostingu.
// ============================================================

test("/healthz podaje wersję kodu, którą uruchomiono", async () => {
  const r = await fetch(BASE + "/healthz");
  assert.equal(r.status, 200);
  const d = await r.json();

  assert.ok("wersja" in d,
    "/healthz nie podaje wersji — nie da się z zewnątrz sprawdzić, co stoi na produkcji");
  // Testy startują z repo, więc hash MUSI się odczytać. `null` znaczyłoby, że
  // odczyt się wysypał i produkcja też przestałaby cokolwiek raportować.
  assert.match(String(d.wersja), /^[0-9a-f]{7}$/,
    `oczekiwano skróconego hasha, dostałem ${JSON.stringify(d.wersja)}`);

  // Sonda żywotności ma zostać sondą: reszta pól nie może zniknąć.
  assert.equal(d.ok, true);
  assert.equal(typeof d.uptime, "number");
});

// ============================================================
//  Publiczny kod konsultanta — formularz „dane do rezerwacji"
//
//  Formularz wypelnia KLIENT, ktory konta nie ma. Jedyne, czego strona potrzebuje
//  z serwera, to imie i adres konsultanta — i to jest jedyny endpoint /api dzialajacy
//  bez sesji. Reszta granicy musi zostac nietknieta, wiec sprawdzamy oba kierunki:
//  ze ten jeden dziala bez logowania I ze nie otworzyl przy okazji niczego innego.
// ============================================================

test("kod konsultanta otwiera dane kontaktowe bez logowania — i tylko je", async () => {
  const cookie = await zaloguj(KONSULTANT.email, KONSULTANT.pass);
  const ja = await (await fetch(BASE + "/api/auth/me", { headers: { cookie } })).json();
  const kod = ja.user.kod;
  assert.ok(kod, "konto nie ma kodu — konsultant nie ma jak wygenerowac linku dla klienta");

  // Bez ciasteczka, dokladnie jak przegladarka klienta.
  const r = await fetch(`${BASE}/api/konsultant/${kod}`);
  assert.equal(r.status, 200, "klient bez konta nie moze pobrac adresu konsultanta — formularz nie ma komu wyslac danych");
  const d = await r.json();
  assert.equal(d.konsultant.email, KONSULTANT.email);

  // Z konta nie moze wyciec nic ponad to, co potrzebne do zaadresowania wiadomosci.
  assert.deepEqual(Object.keys(d.konsultant).sort(), ["email", "name"],
    "publiczna odpowiedz niesie wiecej niz imie i adres");
});

test("nieznany kod nie zdradza, czy konto istnieje, a reszta API zostaje zamknieta", async () => {
  const zly = await fetch(BASE + "/api/konsultant/nieistniejacy-kod");
  assert.equal(zly.status, 404);

  // Kluczowe: dodanie publicznego endpointu NIE moglo otworzyc calego /api.
  const szukanie = await fetch(BASE + "/api/search?countries=Grecja");
  assert.equal(szukanie.status, 401, "publiczny endpoint przepuscil za soba reszte API");
  const konta = await fetch(BASE + "/api/users");
  assert.equal(konta.status, 401, "lista kont stala sie dostepna bez logowania");
});

test("kod przestaje dzialac razem z odcieciem dostepu konsultantowi", async () => {
  // Link zyje w wydrukach i skrzynkach klientow. Gdy konto jest wylaczane, adres
  // ma przestac odpowiadac — inaczej wylaczony konsultant dalej zbiera dane klientow.
  const admin = await zaloguj(ADMIN.email, ADMIN.pass);
  const lista = await (await fetch(BASE + "/api/users", { headers: { cookie: admin } })).json();
  const k = lista.users.find((u) => u.email === KONSULTANT.email);
  assert.ok(k, "nie znalazlem konta konsultanta na liscie");

  await fetch(`${BASE}/api/users/${k.id}/active`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie: admin },
    body: JSON.stringify({ active: false }),
  });
  const po = await fetch(`${BASE}/api/konsultant/${k.kod}`);
  assert.equal(po.status, 404, "kod wylaczonego konta dalej zwraca jego adres");

  // Sprzatanie: kolejne testy moga potrzebowac tego konta.
  await fetch(`${BASE}/api/users/${k.id}/active`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie: admin },
    body: JSON.stringify({ active: true }),
  });
});
