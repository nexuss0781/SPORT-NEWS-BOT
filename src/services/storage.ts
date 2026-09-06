import { BotConfig, Channel, ProcessedPost, ReelItem } from "../types";
import { dbGet, dbSet } from "./db";
import { toChannelUrl } from "./mtproto";
import { LaneRelease } from "./postRules";
export { ProcessedPost } from "../types";

const KEY_CONFIG = "config";
const KEY_CHANNELS = "channels";
const KEY_PROCESSED = "processed";
const KEY_PENDING = "pending";
const KEY_REELS = "reels";
const KEY_LANE_RELEASES = "lane_releases";

// Tiny TTL cache for getConfig so rapid button presses skip repeated DB reads.
let configCache: BotConfig | null = null;
let configCacheTime = 0;
const CONFIG_TTL_MS = 20_000;

// Bot Config
const DEFAULT_SIGNATURE = "SHARE ⬅️\n🤳@Ethio_Utd ✅";

const DEFAULT_CONFIG: BotConfig = {
  targetChannel: null,
  targetChannels: [],
  signature: DEFAULT_SIGNATURE,
  translatedLang: "am",
  showEnglish: false,
  showOriginal: false,
  owners: [],
  admins: [],
  roleNames: {},
  postRules: {
    timeEnabled: false,
    gapSeconds: 0,
    viewEnabled: false,
    freePosts: 3,
    perPost: null,
    nthCount: null,
    nthTotal: null,
  },
};

export async function getConfig(): Promise<BotConfig> {
  const now = Date.now();
  if (configCache && now - configCacheTime < CONFIG_TTL_MS) return { ...configCache };

  const cfg = (await dbGet<BotConfig>(KEY_CONFIG)) || DEFAULT_CONFIG;
  // Backfill default signature for existing configs
  if (!cfg.signature) {
    const migrated = { ...cfg, signature: DEFAULT_SIGNATURE };
    await dbSet(KEY_CONFIG, migrated);
    configCache = migrated; configCacheTime = now;
    return migrated;
  }
  // Backfill role fields for configs created before roles existed
  if (!Array.isArray(cfg.owners) || !Array.isArray(cfg.admins) || !cfg.roleNames) {
    const migrated = {
      ...cfg,
      owners: Array.isArray(cfg.owners) ? cfg.owners : [],
      admins: Array.isArray(cfg.admins) ? cfg.admins : [],
      roleNames: cfg.roleNames || {},
    };
    await dbSet(KEY_CONFIG, migrated);
    configCache = migrated; configCacheTime = now;
    return migrated;
  }
  // Backfill post rules
  if (!cfg.postRules) {
    const migrated = { ...cfg, postRules: DEFAULT_CONFIG.postRules };
    await dbSet(KEY_CONFIG, migrated);
    configCache = migrated; configCacheTime = now;
    return migrated;
  }
  // Migrate legacy single targetChannel into targetChannels
  if (cfg.targetChannel && (!cfg.targetChannels || cfg.targetChannels.length === 0)) {
    const migrated = { ...cfg, targetChannels: [cfg.targetChannel] };
    await dbSet(KEY_CONFIG, migrated);
    configCache = migrated; configCacheTime = now;
    return migrated;
  }
  configCache = cfg; configCacheTime = now;
  return cfg;
}

export async function updateConfig(updates: Partial<BotConfig>): Promise<BotConfig> {
  const current = await getConfig();
  const updated = { ...current, ...updates };
  if (updates.targetChannel !== undefined && updates.targetChannels === undefined) {
    updated.targetChannels = updates.targetChannel ? [updates.targetChannel] : [];
  }
  if (updated.targetChannels !== undefined) {
    updated.targetChannel = updated.targetChannels.length > 0 ? updated.targetChannels[0] : null;
  }
  await dbSet(KEY_CONFIG, updated);
  configCache = updated; configCacheTime = Date.now();
  return updated;
}

export async function getTargetChannels(): Promise<string[]> {
  const cfg = await getConfig();
  return cfg.targetChannels || [];
}

// Channels
export async function getChannels(): Promise<Channel[]> {
  const list = (await dbGet<Channel[]>(KEY_CHANNELS)) || [];
  // One-time migration: ensure every stored channel is in https://t.me/... form.
  let changed = false;
  const migrated = list.map((c) => {
    const normalized = toChannelUrl(c.username);
    if (normalized !== c.username) {
      changed = true;
      return { ...c, id: normalized, username: normalized };
    }
    return c;
  });
  if (changed) {
    await dbSet(KEY_CHANNELS, migrated);
  }
  return migrated;
}

export async function addChannel(channel: Channel): Promise<Channel[]> {
  const channels = await getChannels();
  const exists = channels.some(
    (c) => c.username.toLowerCase() === channel.username.toLowerCase()
  );
  if (exists) {
    return channels;
  }
  channels.push(channel);
  await dbSet(KEY_CHANNELS, channels);
  return channels;
}

export async function removeChannel(username: string): Promise<Channel[]> {
  let channels = await getChannels();
  channels = channels.filter(
    (c) => c.username.toLowerCase() !== username.toLowerCase()
  );
  await dbSet(KEY_CHANNELS, channels);
  return channels;
}

// Processed Posts
export async function getProcessedPosts(): Promise<ProcessedPost[]> {
  return (await dbGet<ProcessedPost[]>(KEY_PROCESSED)) || [];
}

export async function markAsProcessed(post: ProcessedPost): Promise<void> {
  const posts = await getProcessedPosts();
  const exists = posts.some(
    (p) => p.channelId === post.channelId && p.messageId === post.messageId
  );
  if (!exists) {
    posts.push(post);
    // Keep only last 1000 posts to prevent bloat
    const trimmed = posts.slice(-1000);
    await dbSet(KEY_PROCESSED, trimmed);
  }
}

export async function isProcessed(channelId: string, messageId: number): Promise<boolean> {
  const posts = await getProcessedPosts();
  return posts.some(
    (p) => p.channelId === channelId && p.messageId === messageId
  );
}

export async function getProcessedPost(
  channelId: string,
  messageId: number
): Promise<ProcessedPost | undefined> {
  const posts = await getProcessedPosts();
  return posts.find(
    (p) => p.channelId === channelId && p.messageId === messageId
  );
}

export async function getProcessedPostByTargetMessage(
  chatId: string | number,
  messageId: number
): Promise<ProcessedPost | undefined> {
  const posts = await getProcessedPosts();
  return posts.find((p) => {
    if (p.targetMessageIds && p.targetMessageIds[String(chatId)] === messageId) return true;
    return p.targetMessageId === messageId;
  });
}

// Pending multi-step menu input state
interface PendingInput {
  state: string;
  at: string;
  data?: string;
}

export async function getPendingInput(userId: number): Promise<string | undefined> {
  const all = (await dbGet<Record<string, PendingInput>>(KEY_PENDING)) || {};
  const entry = all[String(userId)];
  if (!entry) return undefined;
  if (Date.now() - new Date(entry.at).getTime() > 10 * 60 * 1000) {
    await clearPendingInput(userId);
    return undefined;
  }
  return entry.state;
}

export async function getPendingFull(userId: number): Promise<{ state: string; data?: string } | undefined> {
  const all = (await dbGet<Record<string, PendingInput>>(KEY_PENDING)) || {};
  const entry = all[String(userId)];
  if (!entry) return undefined;
  if (Date.now() - new Date(entry.at).getTime() > 10 * 60 * 1000) {
    await clearPendingInput(userId);
    return undefined;
  }
  return { state: entry.state, data: entry.data };
}

export async function setPendingInput(userId: number, state: string, data?: string): Promise<void> {
  const all = (await dbGet<Record<string, PendingInput>>(KEY_PENDING)) || {};
  all[String(userId)] = { state, at: new Date().toISOString(), data };
  await dbSet(KEY_PENDING, all);
}

export async function clearPendingInput(userId: number): Promise<void> {
  const all = (await dbGet<Record<string, PendingInput>>(KEY_PENDING)) || {};
  delete all[String(userId)];
  await dbSet(KEY_PENDING, all);
}

// Reels (manual review queue)
export async function getReels(): Promise<ReelItem[]> {
  return (await dbGet<ReelItem[]>(KEY_REELS)) || [];
}

export async function getQueuedReels(): Promise<ReelItem[]> {
  const all = await getReels();
  const now = Date.now();
  return all
    .filter((r) => {
      if (r.status === "queued") return true;
      // Recover reels that got stuck mid-posting (function crashed): treat a
      // stale "posting" claim as queued again.
      if (
        r.status === "posting" &&
        r.postingAt &&
        now - new Date(r.postingAt).getTime() > 3 * 60 * 1000
      ) {
        return true;
      }
      return false;
    })
    .sort(
      (a, b) =>
        new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime()
    );
}

// Reels that are scheduled and now due (in reels mode the monitor publishes
// these automatically, bypassing post rules).
export async function getDueScheduledReels(): Promise<ReelItem[]> {
  const all = await getReels();
  const now = Date.now();
  return all
    .filter(
      (r) =>
        (r.status === "queued" ||
          (r.status === "posting" &&
            r.postingAt &&
            now - new Date(r.postingAt).getTime() > 3 * 60 * 1000)) &&
        r.scheduledAt &&
        new Date(r.scheduledAt).getTime() <= now
    )
    .sort(
      (a, b) =>
        new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime()
    );
}

export async function getReelById(id: string): Promise<ReelItem | undefined> {
  const all = await getReels();
  return all.find((r) => r.id === id);
}

export async function addReel(item: ReelItem): Promise<boolean> {
  const all = await getReels();
  const exists = all.some(
    (r) =>
      r.channelId.toLowerCase() === item.channelId.toLowerCase() &&
      r.sourceMessageId === item.sourceMessageId
  );
  if (exists) return false;
  all.push(item);
  const trimmed = all.slice(-500);
  await dbSet(KEY_REELS, trimmed);
  return true;
}

export async function updateReel(
  id: string,
  updates: Partial<ReelItem>
): Promise<void> {
  const all = await getReels();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...updates };
  await dbSet(KEY_REELS, all);
}

export async function getReelStats(): Promise<{
  queued: number;
  posted: number;
  skipped: number;
}> {
  const all = await getReels();
  return {
    queued: all.filter((r) => r.status === "queued").length,
    posted: all.filter((r) => r.status === "posted").length,
    skipped: all.filter((r) => r.status === "skipped").length,
  };
}

// Per-target-channel release history used by the Post Rules view/time rules.
// Each target lane tracks its own released posts independently.
export async function getLaneReleases(channel: string): Promise<LaneRelease[]> {
  const key = normalizeLaneKey(channel);
  if (!key) return [];
  const all = (await dbGet<Record<string, LaneRelease[]>>(KEY_LANE_RELEASES)) || {};
  return (all[key] || []).sort((a, b) => a.releasedAt - b.releasedAt);
}

export async function appendLaneRelease(
  channel: string,
  targetMessageId: number,
  releasedAt: number = Date.now()
): Promise<void> {
  const key = normalizeLaneKey(channel);
  if (!key || !Number.isInteger(targetMessageId)) return;
  const all = (await dbGet<Record<string, LaneRelease[]>>(KEY_LANE_RELEASES)) || {};
  const list = all[key] || [];
  // Dedupe identical message ids.
  if (list.some((r) => r.targetMessageId === targetMessageId)) return;
  list.push({ targetMessageId, releasedAt });
  all[key] = list.slice(-200);
  await dbSet(KEY_LANE_RELEASES, all);
}

export async function updateLaneReleaseViews(
  channel: string,
  targetMessageId: number,
  views: number
): Promise<void> {
  const key = normalizeLaneKey(channel);
  if (!key) return;
  const all = (await dbGet<Record<string, LaneRelease[]>>(KEY_LANE_RELEASES)) || {};
  const list = all[key] || [];
  const entry = list.find((r) => r.targetMessageId === targetMessageId);
  if (entry) entry.views = views;
  await dbSet(KEY_LANE_RELEASES, all);
}

function normalizeLaneKey(channel: string): string {
  let u = String(channel || "").trim();
  u = u.replace(/^@/, "");
  u = u.replace(/^https?:\/\/t\.me\//i, "");
  u = u.split(/[/?#]/)[0];
  return u;
}