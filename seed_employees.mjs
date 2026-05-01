import crypto from "crypto";
import mysql from "mysql2/promise";

// Same scrypt hash as onboarding.ts
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function makeOpenId() {
  return crypto.randomBytes(20).toString("base64url");
}

const employees = [
  { name: "Sarah Mitchell",  email: "sarah@mergetasks.dev",   role: "admin",  password: "Demo1234!" },
  { name: "James Okafor",   email: "james@mergetasks.dev",    role: "user",   password: "Demo1234!" },
  { name: "Priya Sharma",   email: "priya@mergetasks.dev",    role: "user",   password: "Demo1234!" },
  { name: "Tom Brennan",    email: "tom@mergetasks.dev",      role: "user",   password: "Demo1234!" },
  { name: "Lisa Chen",      email: "lisa@mergetasks.dev",     role: "admin",  password: "Demo1234!" },
];

const conn = await mysql.createConnection({
  host: "localhost",
  user: "mt_demo",
  password: "DemoPass123x",
  database: "mergetasks_demo",
});

for (const emp of employees) {
  const hash = await hashPassword(emp.password);
  const openId = makeOpenId();
  try {
    await conn.execute(
      `INSERT INTO users (openId, name, email, loginMethod, role, passwordHash, subscriptionTier, subscriptionStatus)
       VALUES (?, ?, ?, 'email', ?, ?, 'pro', 'active')
       ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role), passwordHash=VALUES(passwordHash)`,
      [openId, emp.name, emp.email, emp.role, hash]
    );
    console.log(`✅  ${emp.name} (${emp.role}) — ${emp.email}`);
  } catch (e) {
    console.error(`❌  ${emp.email}: ${e.message}`);
  }
}

// Also create distributor profiles for each user so they have org access
const [rows] = await conn.execute("SELECT id, email, role FROM users WHERE email LIKE '%@mergetasks.dev'");
const [orgRows] = await conn.execute("SELECT id FROM distributorProfiles LIMIT 1");
const orgId = orgRows[0]?.id;

if (orgId) {
  for (const user of rows) {
    try {
      await conn.execute(
        `INSERT IGNORE INTO distributorProfiles (userId, organizationId, displayName)
         SELECT ?, organizationId, ? FROM distributorProfiles WHERE id = ?`,
        [user.id, user.email.split("@")[0], orgId]
      );
    } catch (e) {
      // ignore if profile already exists
    }
  }
  console.log("\n✅  Distributor profiles linked to org");
}

await conn.end();
console.log("\nAll done! Password for all accounts: Demo1234!");
