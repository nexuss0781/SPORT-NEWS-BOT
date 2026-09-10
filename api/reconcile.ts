import { VercelRequest, VercelResponse } from "@vercel/node";
import {
  WEBHOOK_PATH,
  PUBLIC_BASE_URL,
  RENDER_URL,
  MONITOR_SECRET,
  getWebhookInfo,
  setWebhook,
  deleteWebhook,
  waitForRenderGreen,
  renderPolling,
  isAuthorized,
  respondJson,
} from "./_shared";

// The transition brain, invoked:
//  - by /api/wake (immediately after a Vercel webhook call)
//  - by the GitHub Actions cron every 5 minutes (self-healing)
//
// Flow: render green + webhook currently on Vercel  -> delete webhook (handoff).
//       render not green + webhook empty            -> reclaim webhook to Vercel.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) {
    respondJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const info = await getWebhookInfo();

  // Decide first: is Render alive (or about to be)? The wait doubles as the wake.
  const green = await waitForRenderGreen();

  if (green) {
    if (info.url.endsWith(WEBHOOK_PATH)) {
      // Hand off: Render is green and will take over via long-polling.
      const deleted = await deleteWebhook();
      // Explicitly poke Render to begin polling (idempotent).
      await fetch(`${RENDER_URL}/handoff?key=${MONITOR_SECRET}`, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
      }).catch(() => false);
      respondJson(res, 200, {
        status: "handoff",
        running: true,
        deletedWebhook: deleted,
      });
      return;
    }
    // No webhook set. If Render is already polling it owns updates; otherwise
    // it is green but still in standby -> poke /handoff (idempotent) so it
    // starts long-polling with no webhook active (the desired end state).
    // We never claim the webhook here — that only happens when Render is down.
    const polling = await renderPolling();
    if (!polling) {
      await fetch(`${RENDER_URL}/handoff?key=${MONITOR_SECRET}`, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
      }).catch(() => false);
    }
    respondJson(res, 200, {
      status: "render-owns",
      running: true,
      webhook: info.url || "none",
      polling,
    });
    return;
  }

  // Render is not green. Reclaim the webhook so Vercel answers until it wakes.
  const target = `${PUBLIC_BASE_URL}${WEBHOOK_PATH}`;
  if (!info.url.endsWith(WEBHOOK_PATH)) {
    await setWebhook(target).catch(() => false);
  }
  respondJson(res, 200, {
    status: "vercel-owns",
    running: false,
    webhook: target,
  });
}