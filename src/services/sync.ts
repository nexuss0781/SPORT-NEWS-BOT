import { config, transitionEnabled } from "../config";
import { dbExportAll, dbImportAll } from "./db";

// Storage bridge helpers (Render side): export the local JSON store to a
// snapshot and hand it to Vercel (which persists to Supabase), or restore a
// snapshot back from Vercel. Used on boot, on a timer, and by the manual
// "Backup" button in Settings.

export interface SyncResult {
  ok: boolean;
  status?: number;
  restored?: boolean;
  error?: string;
}

export async function pushSnapshot(reason: string): Promise<SyncResult> {
  if (!transitionEnabled) return { ok: false, error: "transition mode not enabled" };
  try {
    const snapshot = await dbExportAll();
    const url = `${config.vercelUrl}/api/sync?key=${config.monitorSecret}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot }),
      signal: AbortSignal.timeout(20000),
    });
    console.log(`[sync:${reason}] push=${res.status}`);
    return { ok: res.ok, status: res.status };
  } catch (e: any) {
    console.error(`[sync:${reason}] push error:`, String(e?.message || e));
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function pullSnapshot(): Promise<SyncResult> {
  if (!transitionEnabled) return { ok: false, error: "transition mode not enabled" };
  try {
    const url = `${config.vercelUrl}/api/sync?key=${config.monitorSecret}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const json: any = await res.json();
    if (json?.ok && json.snapshot) {
      await dbImportAll(json.snapshot);
      console.log("[sync:pull] restored storage from Vercel (Supabase)");
      return { ok: true, restored: true };
    }
    console.log("[sync:pull] no remote snapshot yet; keeping local");
    return { ok: true, restored: false };
  } catch (e: any) {
    console.error("[sync:pull] error:", String(e?.message || e));
    return { ok: false, error: String(e?.message || e) };
  }
}

// Manual "Backup" action: push now, then pull back so whatever Vercel/Supabase
// held is also restored locally (covers redeploys with a fresh Render disk).
export async function backupNow(): Promise<SyncResult> {
  const push = await pushSnapshot("manual");
  if (!push.ok) {
    return { ok: false, error: push.error || `push failed (${push.status})` };
  }
  const pull = await pullSnapshot();
  return { ok: true, status: push.status, restored: pull.restored };
}