import postgres from "postgres";

export default async function handler(req: any, res: any) {
  const url = process.env.POSTGRES_URL || "";
  if (!url) {
    res.status(200).json({ ok: false, error: "POSTGRES_URL not set" });
    return;
  }
  let sql: any = null;
  try {
    sql = postgres(url, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 10,
      max_lifetime: 55,
      ssl: { rejectUnauthorized: false },
    });
    await sql`SELECT 1`;
    await sql`CREATE TABLE IF NOT EXISTS bot_data (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    await sql`INSERT INTO bot_data (key, value) VALUES ('ping', ${sql.json({ ok: true, t: Date.now() })} ) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    const rows = await sql`SELECT value FROM bot_data WHERE key = 'ping'`;
    res.status(200).json({ ok: true, db: "connected", ping: rows[0]?.value });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: String(e?.message || e) });
  } finally {
    if (sql) {
      try {
        await sql.end();
      } catch {}
    }
  }
}