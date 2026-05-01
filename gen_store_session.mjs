import { SignJWT } from "jose";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

const COOKIE_SECRET = "demo-session-secret-replace-in-production-min-32-chars-long";
const STORE_ID = 1;
const STORE_SLUG = "lincoln-spirit";

const conn = await mysql.createConnection({
  host: "localhost",
  user: "mt_demo",
  password: "DemoPass123x",
  database: "mergetasks_demo",
});

// Seed a demo store customer if not exists
const passwordHash = await bcrypt.hash("Demo1234!", 10);
await conn.execute(
  `INSERT INTO storeUsers (storeId, email, name, storeUserRole, storeUserStatus, passwordHash)
   VALUES (?, ?, ?, 'employee', 'active', ?)
   ON DUPLICATE KEY UPDATE storeUserStatus='active', passwordHash=VALUES(passwordHash)`,
  [STORE_ID, "customer@demo.com", "Demo Customer", passwordHash]
);

const [[user]] = await conn.execute(
  "SELECT id, email, storeUserRole FROM storeUsers WHERE storeId=? AND email=?",
  [STORE_ID, "customer@demo.com"]
);

await conn.end();

// Generate a valid JWT using the same secret as the server
const secret = new TextEncoder().encode(COOKIE_SECRET + "_store");
const token = await new SignJWT({
  storeId: STORE_ID,
  storeUserId: user.id,
  email: user.email,
  role: user.storeUserRole,
})
  .setProtectedHeader({ alg: "HS256" })
  .setExpirationTime("24h")
  .setIssuedAt()
  .sign(secret);

const cookieName = `mt_store_${STORE_SLUG}`;
console.log("\n=== STORE SESSION TOKEN ===");
console.log(`Cookie name: ${cookieName}`);
console.log(`Token: ${token}`);
console.log(`\nStore URL: /s/${STORE_SLUG}/products`);
