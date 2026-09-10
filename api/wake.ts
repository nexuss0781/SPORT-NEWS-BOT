import { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthorized, respondJson } from "./_shared";
import reconcile from "./reconcile";

// Triggered by the bot webhook immediately after Vercel handles an update.
// Fire-and-forget: it wakes + reconciles so Render takes over asap.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) {
    respondJson(res, 401, { error: "Unauthorized" });
    return;
  }
  try {
    await reconcile(req, res);
  } catch (e: any) {
    respondJson(res, 500, { error: String(e?.message || e) });
  }
}