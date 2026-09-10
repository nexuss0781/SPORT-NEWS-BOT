import { VercelRequest, VercelResponse } from "@vercel/node";
import {
  RENDER_URL,
  MONITOR_SECRET,
  renderPolling,
  waitForRenderUp,
  waitForRenderPolling,
  isAuthorized,
  respondJson,
} from "./_shared";

// Triggered by the bot webhook immediately after Vercel finishes replying.
// Proactive path: make sure Render is warm, then hand off so Render takes over
// polling. Render deletes the webhook itself when it starts, so Vercel keeps
// serving until the exact handoff instant — zero disruption.
//
// Always returns quickly; if Render can't be reached, Vercel simply keeps
// serving (reconcile/cron heals later).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) {
    respondJson(res, 401, { error: "Unauthorized" });
    return;
  }

  try {
    if (await renderPolling()) {
      respondJson(res, 200, { status: "render-owns", polling: true });
      return;
    }

    // Wake Render (first probe) and wait for its HTTP server to answer.
    const up = await waitForRenderUp(45000, 2000);
    if (!up) {
      respondJson(res, 200, { status: "vercel-owns", render: "down", polling: false });
      return;
    }

    // Render is warm. Hand off: Render deletes the webhook and starts polling
    // in-process. Idempotent, retried a few times against a still-booting box.
    let handed = false;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(`${RENDER_URL}/handoff?key=${MONITOR_SECRET}`, {
          method: "POST",
          signal: AbortSignal.timeout(15000),
        });
        handed = r.ok;
        if (handed) break;
      } catch {
        // instance still booting — retry shortly
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    const polling = await waitForRenderPolling(30000, 1500);

    respondJson(res, 200, {
      status: handed ? "handoff" : "vercel-owns",
      render: "warm",
      polling,
    });
  } catch (e: any) {
    respondJson(res, 200, { error: String(e?.message || e) });
  }
}