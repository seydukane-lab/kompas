// ============================================================
//  Kompas — konta konsultantów, logowanie, sesje
//
//  Bez zewnętrznych bibliotek: hasła są hashowane wbudowanym scrypt
//  (node:crypto), sesje to losowy token w bazie + ciasteczko httpOnly.
//  Świadomie NIE ma tu JWT ani express-session — panel dla kilkudziesięciu
//  konsultantów nie potrzebuje niczego więcej, a mniej zależności to
//  mniej rzeczy, które mogą się zepsuć przy wdrożeniu u klienta.
// ============================================================

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";

const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const COOKIE = "kompas_sid";

// --- Hasła ---------------------------------------------------

const KEYLEN = 64;

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function passwordMatches(password, stored) {
  const [scheme, salt, hash] = String(stored).split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  // timingSafeEqual wymaga równych długości — stąd długość brana z zapisu.
  return timingSafeEqual(expected, actual);
}

// --- Użytkownicy ---------------------------------------------

const PUBLIC_FIELDS = "id, email, name, role, active, created_at, last_login";

export function createUser({ email, name = "", password, role = "consultant" }) {
  const mail = String(email || "").trim().toLowerCase();
  if (!mail || !mail.includes("@")) throw new Error("Nieprawidłowy adres e-mail.");
  if (!password || password.length < 8) throw new Error("Hasło musi mieć co najmniej 8 znaków.");
  if (!["admin", "consultant"].includes(role)) throw new Error("Nieznana rola: " + role);
  if (findByEmail(mail)) throw new Error("Konto z tym adresem już istnieje.");

  const info = db
    .prepare("INSERT INTO users (email, name, role, pass_hash) VALUES (?, ?, ?, ?)")
    .run(mail, String(name).trim(), role, hashPassword(password));
  return getUser(Number(info.lastInsertRowid));
}

/**
 * Konto startowe z zmiennych środowiskowych — zakładane tylko wtedy, gdy baza
 * jest pusta. Bez tego na hostingu bez konsoli (Render free) nie da się wejść
 * do panelu: skrypt CLI wymaga dostępu do maszyny, a panel wymaga konta.
 * Zwraca opis tego, co zrobił, albo null gdy nie było czego robić.
 */
export function seedAdminFromEnv() {
  const email = (process.env.ADMIN_EMAIL || "").trim();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!email || !password) return null;
  if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0) return null;
  const user = createUser({
    email,
    name: process.env.ADMIN_NAME || "Administrator",
    password,
    role: "admin",
  });
  return user;
}

export function getUser(id) {
  return db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`).get(id) || null;
}

export function findByEmail(email) {
  return db
    .prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE email = ?`)
    .get(String(email || "").trim().toLowerCase()) || null;
}

export function listUsers() {
  return db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users ORDER BY created_at`).all();
}

export function setPassword(id, password) {
  if (!password || password.length < 8) throw new Error("Hasło musi mieć co najmniej 8 znaków.");
  db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(hashPassword(password), id);
  // Zmiana hasła unieważnia wszystkie otwarte sesje tego konta.
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
}

export function setActive(id, active) {
  db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
}

/** Zwraca konto po poprawnym haśle albo null. Nie rozróżnia „zły login" od „złe hasło". */
export function verifyLogin(email, password) {
  const row = db
    .prepare("SELECT id, pass_hash, active FROM users WHERE email = ?")
    .get(String(email || "").trim().toLowerCase());
  if (!row || !row.active) return null;
  if (!passwordMatches(String(password || ""), row.pass_hash)) return null;
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(row.id);
  return getUser(row.id);
}

// --- Sesje ---------------------------------------------------

export function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+' || ? || ' days'))`
  ).run(token, userId, String(SESSION_DAYS));
  return token;
}

export function sessionUser(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.active, u.created_at, u.last_login
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`
    )
    .get(token);
  return row || null;
}

export function destroySession(token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function purgeExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

// --- Ciasteczka i middleware ---------------------------------

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Dokłada req.user, jeśli ciasteczko wskazuje na żywą sesję. Nigdy nie blokuje. */
export function attachUser(req, res, next) {
  req.sessionToken = readCookie(req, COOKIE);
  req.user = sessionUser(req.sessionToken);
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Wymagane logowanie.", login: true });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Wymagane logowanie.", login: true });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Wymagane uprawnienia administratora." });
  next();
}

// --- Koszyk konsultanta (per konto, nie per przeglądarka) -----

export function getCart(userId) {
  const row = db.prepare("SELECT payload, updated_at FROM carts WHERE user_id = ?").get(userId);
  if (!row) return { items: [], updatedAt: null };
  try {
    return { items: JSON.parse(row.payload), updatedAt: row.updated_at };
  } catch {
    return { items: [], updatedAt: row.updated_at };
  }
}

export function saveCart(userId, items) {
  const payload = JSON.stringify(Array.isArray(items) ? items : []);
  db.prepare(
    `INSERT INTO carts (user_id, payload, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = datetime('now')`
  ).run(userId, payload);
  return getCart(userId);
}

export { COOKIE as SESSION_COOKIE };
