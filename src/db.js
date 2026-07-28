// ============================================================
//  Kompas — baza danych (SQLite)
//
//  Używa wbudowanego modułu `node:sqlite` (Node >= 24; na 22 jest jeszcze
//  za flagą --experimental-sqlite) — świadomie BEZ zewnętrznych zależności:
//  better-sqlite3 wymagałby kompilacji, a na maszynie deweloperskiej nie ma
//  narzędzi build.
//
//  Plik bazy: DB_PATH z .env albo ./data/kompas.db
//  Uwaga hostingowa: darmowy dysk Render jest efemeryczny — przy
//  wdrożeniu pilotażowym baza musi stać na dysku trwałym (VPS albo
//  Render Disk), inaczej konta konsultantów znikną przy redeployu.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : join(ROOT, "data", "kompas.db");

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// --- Schemat ---
// users.role: "admin" (zakłada konta) | "consultant" (zwykły konsultant)
// users.active: 0 wyłącza logowanie bez kasowania historii koszyka
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    name        TEXT    NOT NULL DEFAULT '',
    role        TEXT    NOT NULL DEFAULT 'consultant',
    pass_hash   TEXT    NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login  TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS carts (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payload     TEXT    NOT NULL DEFAULT '[]',
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

/** Ile kont istnieje — pierwsze uruchomienie pokazuje podpowiedź w konsoli. */
export function userCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
}

export { DB_PATH };
