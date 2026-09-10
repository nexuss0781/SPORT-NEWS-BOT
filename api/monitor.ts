import { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthorized, respondJson } from "./_shared";
import reconcile from "./reconcile";

// Cron endpoint (GitHub Actions action.yml pings /api/monitor every 5 min).
// Same brain as /api/wake — guarantees self-healing even with zero bot traffic.
export default reconcile;