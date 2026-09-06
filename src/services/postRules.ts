import { PostRules } from "../types";

// --- Duration parsing ("Xs", "Xmin", "Xhr", "Xday", or mixes like "1hr 30min") ---
const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  d: 86400,
  day: 86400,
  days: 86400,
};

export function parseDuration(input: string): number {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return 0;
  // Plain number => minutes (matches preset usage).
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(parseFloat(text) * 60);
  let total = 0;
  const re = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const unit = UNIT_SECONDS[match[2]];
    if (!unit) return 0;
    total += parseFloat(match[1]) * unit;
  }
  if (total <= 0) return 0;
  return total;
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if ((parts.length === 0 || s > 0) && s) parts.push(`${s}s`);
  return parts.join(" ") || `${s}s`;
}

// --- "5k" / "1.5k" / "500" parsers --------------------------------
export function parseK(input: string): number | null {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return null;
  const m = text.match(/^(\d+(?:\.\d+)?)\s*k$/);
  if (m) return Math.round(parseFloat(m[1]) * 1000);
  if (/^\d+$/.test(text)) return parseInt(text, 10);
  return null;
}

export function formatK(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

// --- Releases tracked per target lane ------------------------------
export interface LaneRelease {
  targetMessageId: number; // message id in the target channel
  releasedAt: number; // epoch ms
  views?: number; // last known view count (refreshed on each evaluation)
}

export type LaneEval =
  | { ok: true }
  | { ok: false; reason: string };

// Batch cycle:
//   1. released.length < freePosts  -> free pass.
//   2. slot = (released.length - freePosts) % nthCount
//      slot == 0 (start of a batch)  -> require sum of last nthCount posts
//           views >= nthTotal (hold until the released posts total that).
//      slot  > 0 (inside a batch)    -> require the previous released post
//           views >= perPost.
// When nthCount is not configured, every post behaves like "inside a batch"
// and is gated on the previous post reaching perPost.
export function evaluateViewRule(
  rules: PostRules,
  releases: LaneRelease[]
): LaneEval {
  if (!rules.viewEnabled) return { ok: true };
  const freePosts = Math.max(0, rules.freePosts || 0);
  const nthCount = rules.nthCount && rules.nthCount > 0 ? rules.nthCount : null;
  const perPost = rules.perPost ?? null;
  const nthTotal = rules.nthTotal ?? null;

  if (perPost === null && nthTotal === null) return { ok: true };
  if (releases.length < freePosts) return { ok: true };
  if (releases.length === 0) return { ok: true };

  const seen = releases.length - freePosts;
  const slotInBatch = nthCount ? seen % nthCount : 1;

  if (nthCount && slotInBatch === 0) {
    // First post of a new batch: need the previous batch's total views.
    const lastOnes = releases.slice(-nthCount);
    const total = lastOnes.reduce((sum: number, r) => sum + (r.views ?? 0), 0);
    if (total < (nthTotal ?? 0)) {
      return {
        ok: false,
        reason: `👁 Holding until the last ${nthCount} posts total ${formatK(nthTotal)} views (currently ${formatK(total)}).`,
      };
    }
    return { ok: true };
  }

  // Inside a batch: the previous post must reach perPost views.
  if (perPost != null) {
    const prev = releases[releases.length - 1];
    const prevViews = prev?.views ?? 0;
    if (prevViews < perPost) {
      return {
        ok: false,
        reason: `👁 Previous post needs ${formatK(perPost)} views before the next one posts (currently ${formatK(prevViews)}).`,
      };
    }
  }
  return { ok: true };
}

export function evaluateTimeRule(
  rules: PostRules,
  lastReleasedAt: number | undefined,
  now: number = Date.now()
): LaneEval {
  if (!rules.timeEnabled || rules.gapSeconds <= 0 || lastReleasedAt == null) {
    return { ok: true };
  }
  const nextAt = lastReleasedAt + rules.gapSeconds * 1000;
  if (now < nextAt) {
    const wait = Math.ceil((nextAt - now) / 1000);
    return { ok: false, reason: `⏳ Next post available in ${formatDuration(wait)}.` };
  }
  return { ok: true };
}

// Presets (minutes for 5/10/15/25, then hours/days).
export const TIME_PRESETS: { label: string; seconds: number }[] = [
  { label: "5m", seconds: 5 * 60 },
  { label: "10m", seconds: 10 * 60 },
  { label: "15m", seconds: 15 * 60 },
  { label: "25m", seconds: 25 * 60 },
  { label: "1hr", seconds: 3600 },
  { label: "2hr", seconds: 2 * 3600 },
  { label: "5hr", seconds: 5 * 3600 },
  { label: "12hr", seconds: 12 * 3600 },
  { label: "1d", seconds: 86400 },
  { label: "3d", seconds: 3 * 86400 },
];