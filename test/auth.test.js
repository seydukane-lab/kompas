// ============================================================
//  Konta, hasła, sesje i koszyk
//
//  Tu błąd nie oznacza brzydkiego wyniku, tylko wpuszczenie kogoś,
//  kto nie powinien wejść, albo pokazanie konsultantowi cudzych ofert.
//  Testy jadą na własnej bazie w katalogu tymczasowym — nigdy na tej,
//  z której korzysta uruchomiony panel.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "kompas-test-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.SESSION_DAYS = "30";

const { db } = await import("../src/db.js");
const auth = await import("../src/auth.js");

test.after(() => {
  try { db.close(); } catch { /* już zamknięta */ }
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
const mail = () => `user${++seq}@test.local`;

test("hasło nie jest nigdzie zapisywane otwartym tekstem", () => {
  const email = mail();
  auth.createUser({ email, name: "Jan", password: "tajneHaslo123" });
  const row = db.prepare("SELECT pass_hash FROM users WHERE email = ?").get(email);
  assert.ok(!row.pass_hash.includes("tajneHaslo123"));
  assert.match(row.pass_hash, /^scrypt\$/);
});

test("to samo hasło daje różne hashe (sól działa)", () => {
  auth.createUser({ email: mail(), password: "identyczne123" });
  auth.createUser({ email: mail(), password: "identyczne123" });
  const rows = db.prepare("SELECT pass_hash FROM users ORDER BY id DESC LIMIT 2").all();
  assert.notEqual(rows[0].pass_hash, rows[1].pass_hash);
});

test("logowanie przechodzi tylko z poprawnym hasłem", () => {
  const email = mail();
  auth.createUser({ email, password: "poprawne123" });
  assert.ok(auth.verifyLogin(email, "poprawne123"));
  assert.equal(auth.verifyLogin(email, "poprawne124"), null);
  assert.equal(auth.verifyLogin(email, ""), null);
  assert.equal(auth.verifyLogin("nieistnieje@test.local", "poprawne123"), null);
});

test("adres e-mail jest niewrażliwy na wielkość liter i spacje", () => {
  const email = mail();
  auth.createUser({ email, password: "haslo12345" });
  assert.ok(auth.verifyLogin("  " + email.toUpperCase() + " ", "haslo12345"));
});

test("nie da się założyć dwóch kont na ten sam adres", () => {
  const email = mail();
  auth.createUser({ email, password: "haslo12345" });
  assert.throws(() => auth.createUser({ email, password: "inne12345" }), /już istnieje/);
});

test("krótkie hasło i błędny adres są odrzucane", () => {
  assert.throws(() => auth.createUser({ email: mail(), password: "krotkie" }), /8 znaków/);
  assert.throws(() => auth.createUser({ email: "bez-malpy", password: "haslo12345" }), /e-mail/);
});

test("nieznana rola nie przechodzi", () => {
  assert.throws(() => auth.createUser({ email: mail(), password: "haslo12345", role: "szef" }), /rola/i);
});

test("sesja daje dostęp, a jej usunięcie odbiera", () => {
  const u = auth.createUser({ email: mail(), password: "haslo12345" });
  const token = auth.createSession(u.id);
  assert.equal(auth.sessionUser(token).id, u.id);
  auth.destroySession(token);
  assert.equal(auth.sessionUser(token), null);
});

test("wygasła sesja nie działa i jest sprzątana", () => {
  const u = auth.createUser({ email: mail(), password: "haslo12345" });
  const token = auth.createSession(u.id);
  // Cofamy datę ważności — tak, jakby minęło 30 dni.
  db.prepare("UPDATE sessions SET expires_at = datetime('now','-1 day') WHERE token = ?").run(token);
  assert.equal(auth.sessionUser(token), null);
  auth.purgeExpiredSessions();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE token = ?").get(token).n, 0);
});

test("zmiana hasła unieważnia otwarte sesje", () => {
  const u = auth.createUser({ email: mail(), password: "stare12345" });
  const token = auth.createSession(u.id);
  auth.setPassword(u.id, "nowe123456");
  assert.equal(auth.sessionUser(token), null, "stara sesja musi umrzeć");
  assert.equal(auth.verifyLogin(u.email, "stare12345"), null);
  assert.ok(auth.verifyLogin(u.email, "nowe123456"));
});

test("wyłączenie konta odcina dostęp natychmiast", () => {
  const u = auth.createUser({ email: mail(), password: "haslo12345" });
  const token = auth.createSession(u.id);
  auth.setActive(u.id, false);
  assert.equal(auth.sessionUser(token), null, "zalogowana osoba traci dostęp od razu");
  assert.equal(auth.verifyLogin(u.email, "haslo12345"), null, "i nie zaloguje się ponownie");
  auth.setActive(u.id, true);
  assert.ok(auth.verifyLogin(u.email, "haslo12345"), "włączenie przywraca dostęp");
});

test("token sesji jest długi i losowy", () => {
  const u = auth.createUser({ email: mail(), password: "haslo12345" });
  const a = auth.createSession(u.id);
  const b = auth.createSession(u.id);
  assert.notEqual(a, b);
  assert.ok(a.length >= 40, `token za krótki: ${a.length} znaków`);
});

test("koszyk jest przypisany do konta i nie przecieka między konsultantami", () => {
  const jan = auth.createUser({ email: mail(), password: "haslo12345" });
  const ola = auth.createUser({ email: mail(), password: "haslo12345" });

  auth.saveCart(jan.id, [{ id: "h1", name: "Hotel Jana" }]);
  assert.equal(auth.getCart(jan.id).items.length, 1);
  assert.equal(auth.getCart(ola.id).items.length, 0, "Ola nie widzi ofert Jana");

  auth.saveCart(jan.id, [{ id: "h2" }, { id: "h3" }]);
  assert.equal(auth.getCart(jan.id).items.length, 2, "zapis nadpisuje, nie dokleja");

  auth.saveCart(jan.id, []);
  assert.deepEqual(auth.getCart(jan.id).items, []);
});

test("uszkodzony koszyk w bazie nie wywraca panelu", () => {
  const u = auth.createUser({ email: mail(), password: "haslo12345" });
  auth.saveCart(u.id, [{ id: "h1" }]);
  db.prepare("UPDATE carts SET payload = ? WHERE user_id = ?").run("{to nie jest json", u.id);
  assert.deepEqual(auth.getCart(u.id).items, [], "zamiast wyjątku pusty koszyk");
});

test("usunięcie konta zabiera ze sobą sesje i koszyk", () => {
  const u = auth.createUser({ email: mail(), password: "haslo12345" });
  auth.createSession(u.id);
  auth.saveCart(u.id, [{ id: "h1" }]);
  db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id = ?").get(u.id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM carts WHERE user_id = ?").get(u.id).n, 0);
});

test("konto startowe z env zakłada się tylko przy pustej bazie", () => {
  // Baza ma już konta z wcześniejszych testów — seed musi je zostawić w spokoju.
  process.env.ADMIN_EMAIL = "seed@test.local";
  process.env.ADMIN_PASSWORD = "seedowe12345";
  assert.equal(auth.seedAdminFromEnv(), null, "przy istniejących kontach seed nie może nic robić");
  assert.equal(auth.findByEmail("seed@test.local"), null);

  // Pusta baza — teraz konto ma powstać, i to z rolą administratora.
  db.exec("DELETE FROM users");
  const utworzony = auth.seedAdminFromEnv();
  assert.ok(utworzony, "przy pustej bazie seed musi założyć konto");
  assert.equal(utworzony.email, "seed@test.local");
  assert.equal(utworzony.role, "admin");
  assert.ok(auth.verifyLogin("seed@test.local", "seedowe12345"));

  // Powtórny start nie może nadpisać hasła zmienionego już w panelu.
  auth.setPassword(utworzony.id, "zmienioneWpanelu123");
  assert.equal(auth.seedAdminFromEnv(), null);
  assert.ok(auth.verifyLogin("seed@test.local", "zmienioneWpanelu123"));
  assert.equal(auth.verifyLogin("seed@test.local", "seedowe12345"), null);

  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;
});

test("bez zmiennych env seed nie robi nic", () => {
  db.exec("DELETE FROM users");
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;
  assert.equal(auth.seedAdminFromEnv(), null);
  assert.equal(auth.listUsers().length, 0);
});

test("lista kont nie zawiera hashy haseł", () => {
  auth.createUser({ email: mail(), password: "haslo12345" });
  for (const u of auth.listUsers()) {
    assert.ok(!("pass_hash" in u), "hash hasła nie ma prawa wyjść poza moduł auth");
  }
});
