import { VercelRequest, VercelResponse } from "@vercel/node";
import {
  WEBHOOK_PATH,
  PUBLIC_BASE_URL,
  RENDER_URL,
  MONITOR_SECRET,
  getWebhookInfo,
  setWebhook,
  renderPolling,
  isAuthorized,
  respondJson,
} from "./_shared";

// The transition brain's defensive half, invoked by the GitHub Actions cron
// every 5 minutes (/api/monitor) to guarantee self-healing even with zero bot
// traffic. The proactive wake-and-handoff lives in /api/wake.
//
// Ownership invariant: Vercel only ever SETS the webhook (reclaim). Render
// only ever DELETES it, atomically, when it starts polling. So we never
// delete the webhook here — that would put Telegram in a no-owner window.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) {
    respondJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const [polling, info] = await Promise.all([renderPolling(), getWebhookInfo()]);
  const target = `${PUBLIC_BASE_URL}${WEBHOOK_PATH}`;
  const ownsVercel = Boolean(info.url && info.url.endsWith(WEBHOOK_PATH));

  // Render owns long-polling and the webhook is empty (or isn't Vercel's):
  // healthy steady state.
  if (polling && !ownsVercel) {
    respondJson(res, 200, { status: "render-owns", running: true, webhook: info.url || "none" });
    return;
  }

  // Render is polling but the webhook still points at Vercel (stale state).
  // Never delete from here — poke Render's idempotent /handoff which deletes
  // it atomically at the moment Render re-takes control.
  if (polling && ownsVercel) {
    await fetch(`${RENDER_URL}/handoff?key=${MONITOR_SECRET}`, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
    }).catch(() => false);
    respondJson(res, 200, { status: "render-owns", running: true, webhook: info.url || "none" });
    return;
  }

  // Render is not polling. If Vercel already owns the webhook, it keeps
  // serving — /api/wake will hand off when Render is warm. Otherwise it owns
  // nothing, which must never happen: reclaim to Vercel.
  if (!ownsVercel) {
    await setWebhook(target).catch(() => false);
  }
  respondJson(res, 200, {
    status: ownsVercel ? "vercel-owns" : "vercel-owns (reclaimed)",
    running: false,
    webhook: target,
  });
}