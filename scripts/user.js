// ============================================================
//  Kompas — zarządzanie kontami z wiersza poleceń
//
//  Pierwsze konto administratora trzeba założyć tutaj, bo panel
//  administracyjny sam wymaga zalogowanego admina.
//
//    npm run user:add  -- jan@biuro.pl "Jan Kowalski" haslo1234 [admin]
//    npm run user:list
//    npm run user:pass -- jan@biuro.pl noweHaslo123
//    npm run user:off  -- jan@biuro.pl
//    npm run user:on   -- jan@biuro.pl
// ============================================================

import "dotenv/config";
import { createUser, listUsers, findByEmail, setPassword, setActive } from "../src/auth.js";

const [cmd, ...args] = process.argv.slice(2);

function fail(msg) {
  console.error("✖ " + msg);
  process.exit(1);
}

function mustFind(email) {
  const user = findByEmail(email);
  if (!user) fail("Nie ma konta: " + email);
  return user;
}

switch (cmd) {
  case "add": {
    const [email, name, password, role = "consultant"] = args;
    if (!email || !password) fail('Użycie: npm run user:add -- email "Imię Nazwisko" hasło [admin]');
    try {
      const user = createUser({ email, name: name || "", password, role });
      console.log(`✔ Konto założone: ${user.email} (${user.role})`);
    } catch (err) {
      fail(err.message);
    }
    break;
  }

  case "list": {
    const users = listUsers();
    if (!users.length) {
      console.log("Brak kont.");
      break;
    }
    for (const u of users) {
      const status = u.active ? "aktywne " : "wyłączone";
      const last = u.last_login ? `ostatnie logowanie ${u.last_login}` : "nigdy nie logowany";
      console.log(`${String(u.id).padStart(3)}  ${status}  ${u.role.padEnd(10)} ${u.email.padEnd(30)} ${u.name.padEnd(24)} ${last}`);
    }
    break;
  }

  case "pass": {
    const [email, password] = args;
    if (!email || !password) fail("Użycie: npm run user:pass -- email noweHasło");
    const user = mustFind(email);
    try {
      setPassword(user.id, password);
      console.log(`✔ Hasło zmienione: ${user.email} (otwarte sesje zostały unieważnione)`);
    } catch (err) {
      fail(err.message);
    }
    break;
  }

  case "off":
  case "on": {
    const [email] = args;
    if (!email) fail(`Użycie: npm run user:${cmd} -- email`);
    const user = mustFind(email);
    setActive(user.id, cmd === "on");
    console.log(`✔ Konto ${user.email} ${cmd === "on" ? "włączone" : "wyłączone"}`);
    break;
  }

  default:
    console.log("Polecenia: add | list | pass | off | on");
    console.log('  npm run user:add  -- jan@biuro.pl "Jan Kowalski" haslo1234 admin');
    console.log("  npm run user:list");
    console.log("  npm run user:pass -- jan@biuro.pl noweHaslo123");
    console.log("  npm run user:off  -- jan@biuro.pl");
}
