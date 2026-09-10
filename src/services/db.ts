import * as fs from "fs";
import * as path from "path";

// Persistent local JSON-file store. One bot process owns the data directory
// (usually a Render persistent disk), so there is no external database to keep
// alive or fall back to — a crash leaves the files intact on the disk and the
// same store is reused across restarts.

const DATA_DIR = process.env.DATA_DIR || "./data";

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function filePath(key: string): string {
  // Keys are user-controlled-adjacent; restrict them to a safe filename shape.
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `${safe}.json`);
}

function readFile<T>(key: string): T | undefined {
  ensureDir();
  const file = filePath(key);
  try {
    if (!fs.existsSync(file)) return undefined;
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return parsed.data as T;
  } catch {
    return undefined;
  }
}

function writeFile<T>(key: string, data: T): void {
  ensureDir();
  const file = filePath(key);
  const tmp = `${file}.tmp`;
  const payload = JSON.stringify({ data, lastUpdated: new Date().toISOString() }, null, 2);
  // Atomic write: finish the file, then rename into place so a crash mid-write
  // can never leave a corrupt/partial doc behind.
  fs.writeFileSync(tmp, payload, "utf-8");
  fs.renameSync(tmp, file);
}

export async function dbGet<T>(key: string): Promise<T | undefined> {
  return readFile<T>(key);
}

export async function dbSet<T>(key: string, data: T): Promise<void> {
  writeFile(key, data);
}

export async function dbPing(): Promise<boolean> {
  try {
    ensureDir();
    return true;
  } catch {
    return false;
  }
}