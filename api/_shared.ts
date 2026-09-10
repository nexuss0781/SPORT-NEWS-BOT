import type { VercelRequest, VercelResponse } from "@vercel/node";

// Shared helpers for the Vercel side of the Vercel->Render transition.
//
// Ownership rule (single source of truth): whoever the Telegram webhook URL
// currently points at owns bot traffic.
//   - webhook == /api/bot  -> Vercel is hot, Render is standby/warming
//   - webhook == empty     -> Render owns it via long-polling
//
// The Telegram API forbids webhook + getUpdates at the same time (409), so the
// handoff is atomic on Render's side: Vercel calls /handoff and Render deletes
// the webhook + starts long-polling in the same process. Until that delete
// lands, Vercel still owns — Telegram keeps any in-flight update pending and
// delivers it to Render's getUpdates (no drops, no dead window).

export const MONITOR_SECRET = process.env.MONITOR_SECRET || "";
export const BOT_TOKEN = process.env.BOT_TOKEN || "";
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
export const RENDER_URL = (process.env.RENDER_URL || "").replace(/\/+$/, "");
export const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const WEBHOOK_PATH = "/api/bot";
export const SNAPSHOT_ROW = "snapshot";

export function isAuthorized(req: VercelRequest): boolean {
  const key = req.query?.key;
  return (
    Boolean(MONITOR_SECRET) &&
    typeof key === "string" &&
    key === MONITOR_SECRET
  );
}

export function respondJson(res: VercelResponse, status: number, body: unknown): void {
  res.status(status).setHeader("Content-Type", "application/json").send(JSON.stringify(body));
}

export function readBody(req: VercelRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// --- Telegram bot API ------------------------------------------------------------------

async function telegram<T = any>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return (await res.json()) as T;
}

export async function getWebhookInfo(): Promise<{ url: string }> {
  const r = await telegram<{ ok: boolean; result: { url: string } }>("getWebhookInfo");
  return r?.result ? { url: r.result.url } : { url: "" };
}

export async function setWebhook(url: string): Promise<boolean> {
  const r = await telegram<{ ok: boolean }>("setWebhook", {
    url,
    allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post", "callback_query"],
  });
  return Boolean(r?.ok);
}

export async function deleteWebhook(): Promise<boolean> {
  // Never drop pending updates — dropping them could discard user messages.
  const r = await telegram<{ ok: boolean }>("deleteWebhook", {});
  return Boolean(r?.ok);
}

// --- Render health ------------------------------------------------------------------------
//
// Two distinct signals:
//   - renderUp():     Render's HTTP server responds at all (the process is
//                     warm/booting). The FIRST probe doubles as the wake-up
//                     call (Render free boots on inbound request).
//   - renderPolling():Render is actively long-polling Telegram and owns the
//                     updates (health "running" is true only in this state).

export async function renderUp(timeoutMs = 8000): Promise<boolean> {
  try {
    const res = await fetch(`${RENDER_URL}/`, { signal: AbortSignal.timeout(timeoutMs) });
    const json: any = await res.json().catch(() => null);
    return Boolean(json && json.status === "ok");
  } catch {
    return false;
  }
}

// Waits until Render's process responds (the first probe wakes a sleeping
// instance). Does NOT mean it is polling yet.
export async function waitForRenderUp(timeoutMs = 55000, pollMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await renderUp(9000)) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return renderUp(9000);
}

// Does Render own long-polling right now (vs. sitting in standby)?
export async function renderPolling(timeoutMs = 8000): Promise<boolean> {
  try {
    const res = await fetch(`${RENDER_URL}/status`, { signal: AbortSignal.timeout(timeoutMs) });
    const json: any = await res.json().catch(() => null);
    return Boolean(json && json.status === "ok" && json.mode === "polling");
  } catch {
    return false;
  }
}

// Waits until Render confirms it is actually long-polling (owns updates).
export async function waitForRenderPolling(timeoutMs = 30000, pollMs = 1500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await renderPolling(9000)) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return renderPolling(9000);
}

// --- Supabase (PostgREST) ------------------------------------------------------------------

function supabaseHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    Prefer: "resolution=merge-duplicates",
  };
}

export async function supabaseGetSnapshot(): Promise<Record<string, unknown> | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/bot_state?key=eq.${SNAPSHOT_ROW}&select=data`;
    const res = await fetch(url, {
      method: "GET",
      headers: supabaseHeaders(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ data: Record<string, unknown> }>;
    return rows && rows[0] ? rows[0].data : null;
  } catch {
    return null;
  }
}

export async function supabasePutSnapshot(snapshot: Record<string, unknown>): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return false;
  try {
    const url = `${SUPABASE_URL}/rest/v1/bot_state?on_conflict=key`;
    const res = await fetch(url, {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify([{ key: SNAPSHOT_ROW, data: snapshot, updated_at: new Date().toISOString() }]),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}