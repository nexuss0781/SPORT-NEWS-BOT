import postgres from "postgres";
import * as fs from "fs";
import * as path from "path";

const DB_URL = process.env.POSTGRES_URL || "";
const FALLBACK_DIR = "/tmp/bot-data";

let sqlInstance: any = null;
let initPromise: Promise<void> | null = null;

function ensureDir(): void {
  if (!fs.existsSync(FALLBACK_DIR)) {
    fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  }
}

function fallbackPath(key: string): string {
  return path.join(FALLBACK_DIR, `${key}.json`);
}

function fallbackRead<T>(key: string): T | undefined {
  ensureDir();
  const file = fallbackPath(key);
  try {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, "utf-8");
      return JSON.parse(content).data as T;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function fallbackWrite<T>(key: string, data: T): void {
  ensureDir();
  fs.writeFileSync(
    fallbackPath(key),
    JSON.stringify({ data, lastUpdated: new Date().toISOString() }, null, 2),
    "utf-8"
  );
}

function getSql(): any | null {
  if (!DB_URL) return null;
  if (!sqlInstance) {
    sqlInstance = postgres(DB_URL, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      max_lifetime: 55,
      ssl: { rejectUnauthorized: false },
    });
  }
  return sqlInstance;
}

function ensureTables(sql: any): Promise<void> {
  if (!initPromise) {
    initPromise = sql
      .unsafe(
        `CREATE TABLE IF NOT EXISTS bot_data (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`
      )
      .then(() => {})
      .catch((e: any) => {
        console.error("[db] ensureTables failed:", e?.message);
        initPromise = null;
      });
  }
  return initPromise as Promise<void>;
}

export async function dbGet<T>(key: string): Promise<T | undefined> {
  const sql = getSql();
  if (!sql) return fallbackRead<T>(key);

  try {
    await ensureTables(sql);
    const rows = await sql`SELECT value FROM bot_data WHERE key = ${key}`;
    if (rows.length > 0 && rows[0]?.value !== undefined) {
      return rows[0].value as T;
    }
    // Migrate any leftover fallback file into the DB
    const fb = fallbackRead<T>(key);
    if (fb !== undefined) {
      await dbSet(key, fb);
      return fb;
    }
    return undefined;
  } catch (e: any) {
    console.error(`[db] read ${key} fallback:`, e?.message);
    return fallbackRead<T>(key);
  }
}

export async function dbSet<T>(key: string, data: T): Promise<void> {
  const sql = getSql();
  if (!sql) {
    fallbackWrite(key, data);
    return;
  }

  try {
    await ensureTables(sql);
    await sql`
      INSERT INTO bot_data (key, value, updated_at)
      VALUES (${key}, ${sql.json(data)}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;
  } catch (e: any) {
    console.error(`[db] write ${key} fallback:`, e?.message);
    fallbackWrite(key, data);
  }
}

export async function dbPing(): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  try {
    await ensureTables(sql);
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}