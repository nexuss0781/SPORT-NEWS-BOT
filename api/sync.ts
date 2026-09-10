import { VercelRequest, VercelResponse } from "@vercel/node";
import {
  isAuthorized,
  respondJson,
  readBody,
  supabaseGetSnapshot,
  supabasePutSnapshot,
  SNAPSHOT_ROW,
} from "./_shared";

// Storage bridge.
//   GET  /api/sync?key=...    -> Render pulls latest snapshot (Supabase)
//   POST /api/sync?key=...    -> Render pushes a storage batch -> Supabase
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) {
    respondJson(res, 401, { error: "Unauthorized" });
    return;
  }

  if (req.method === "GET") {
    const snapshot = await supabaseGetSnapshot();
    if (snapshot === null) {
      respondJson(res, 200, { ok: true, fresh: false, snapshot: null });
      return;
    }
    respondJson(res, 200, { ok: true, fresh: true, snapshot });
    return;
  }

  if (req.method === "POST") {
    let body: any = {};
    try {
      body = await readBody(req);
    } catch {
      respondJson(res, 400, { ok: false, error: "Invalid JSON" });
      return;
    }
    const snapshot = body?.snapshot && typeof body.snapshot === "object" ? body.snapshot : null;
    if (!snapshot) {
      respondJson(res, 400, { ok: false, error: "Missing snapshot" });
      return;
    }
    try {
      const ok = await supabasePutSnapshot(snapshot);
      respondJson(res, ok ? 200 : 500, { ok, row: SNAPSHOT_ROW });
    } catch (e: any) {
      respondJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return;
  }

  respondJson(res, 405, { error: "Method not allowed" });
}