/**
 * Database connection layer — MySQL pool + Drizzle ORM initialization.
 *
 * Exports `getDb()` which lazily creates a single connection pool and
 * returns a Drizzle database instance. Also exports user-lookup helpers
 * used during authentication.
 *
 * @module server/db
 */
import { eq } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';
import { getLogger } from './utils/logger';

const log = getLogger("Database");

let _db: MySql2Database | null = null;
let _pool: mysql.Pool | null = null;

/**
 * Parse a DATABASE_URL into mysql2 pool config.
 * Supports both TCP (mysql://user:pass@host:port/db) and socket
 * (mysql://user:pass@localhost/db?socketPath=/tmp/mysql.sock) URLs.
 */
function parseDatabaseUrl(url: string): mysql.PoolOptions {
  const parsed = new URL(url);
  const opts: mysql.PoolOptions = {
    host: parsed.hostname || "localhost",
    port: parsed.port ? parseInt(parsed.port) : 3306,
    user: parsed.username || undefined,
    password: parsed.password || undefined,
    database: parsed.pathname.replace(/^\//, "") || undefined,
    // Connection pool settings for concurrent workloads
    // Configurable via DB_POOL_SIZE env var (default: 20)
    connectionLimit: parseInt(process.env.DB_POOL_SIZE || "20", 10),
    queueLimit: 0,
    waitForConnections: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  };
  const socketPath = parsed.searchParams.get("socketPath");
  if (socketPath) {
    opts.socketPath = socketPath;
    delete opts.host;
    delete opts.port;
  }

  // ── TLS / SSL (PCI DSS Req 4.1: encrypt sensitive data in transit) ──
  // Enable TLS on the database connection unless explicitly disabled via
  // DB_SSL=false (e.g., for local development with a Unix socket).
  // When the database is on a separate host, data travels over the network
  // and MUST be encrypted to prevent plaintext credential/token exposure.
  const sslParam = parsed.searchParams.get("ssl") || process.env.DB_SSL;
  if (sslParam?.toLowerCase() !== "false" && !socketPath) {
    opts.ssl = {
      // rejectUnauthorized: true ensures the server certificate is validated
      // against the system CA bundle. Set DB_SSL_REJECT_UNAUTHORIZED=false
      // only for self-signed certs in staging environments.
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
    };
    // If a custom CA certificate path is provided, load it
    if (process.env.DB_SSL_CA) {
      const fs = require("fs");
      opts.ssl.ca = fs.readFileSync(process.env.DB_SSL_CA);
    }
  }

  return opts;
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb(): Promise<MySql2Database | null> {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const poolOpts = parseDatabaseUrl(process.env.DATABASE_URL);
      _pool = mysql.createPool({
        ...poolOpts,
        // Reclaim idle connections after 60 seconds to prevent stale connections
        // from accumulating in the pool and causing errors.
        idleTimeout: 60_000,
      });

      // Health-check: verify the pool can actually reach the database.
      // This catches bad credentials, unreachable hosts, and TLS errors
      // at startup rather than on the first user request.
      const conn = await _pool.getConnection();
      await conn.ping();
      conn.release();

      _db = drizzle(_pool);
      log.info(`Database connection pool initialised (connectionLimit=${process.env.DB_POOL_SIZE || 20}, idleTimeout=60s, health check passed)`);

      // Periodic pool health check — ping every 30 seconds to detect
      // stale connections early and keep the pool warm.
      setInterval(async () => {
        try {
          const c = await _pool!.getConnection();
          await c.ping();
          c.release();
        } catch (err) {
          log.warn("Database pool health check failed", err);
        }
      }, 30_000).unref();
    } catch (error) {
      log.warn("Failed to connect", error);
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    log.warn("Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    log.error("Failed to upsert user", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    log.warn("Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Get the raw mysql2 connection pool for operations that need
 * manual transactions (e.g., cascade deletes).
 */
export function getPool(): mysql.Pool | null {
  return _pool;
}
