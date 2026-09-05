import { BotConfig, Channel, ProcessedPost } from "../types";
import { dbGet, dbSet } from "./db";
export { ProcessedPost } from "../types";

const KEY_CONFIG = "config";
const KEY_CHANNELS = "channels";
const KEY_PROCESSED = "processed";
const KEY_PENDING = "pending";

// Bot Config
const DEFAULT_SIGNATURE = "SHARE ⬅️\n🤳@Ethio_Utd ✅";

const DEFAULT_CONFIG: BotConfig = {
  targetChannel: null,
  targetChannels: [],
  signature: DEFAULT_SIGNATURE,
  translatedLang: "am",
  showEnglish: false,
  showOriginal: false,
};

export async function getConfig(): Promise<BotConfig> {
  const cfg = (await dbGet<BotConfig>(KEY_CONFIG)) || DEFAULT_CONFIG;
  // Backfill default signature for existing configs
  if (!cfg.signature) {
    const migrated = { ...cfg, signature: DEFAULT_SIGNATURE };
    await dbSet(KEY_CONFIG, migrated);
    return migrated;
  }
  // Migrate legacy single targetChannel into targetChannels
  if (cfg.targetChannel && (!cfg.targetChannels || cfg.targetChannels.length === 0)) {
    const migrated = { ...cfg, targetChannels: [cfg.targetChannel] };
    await dbSet(KEY_CONFIG, migrated);
    return migrated;
  }
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
  return updated;
}

export async function getTargetChannels(): Promise<string[]> {
  const cfg = await getConfig();
  return cfg.targetChannels || [];
}

// Channels
export async function getChannels(): Promise<Channel[]> {
  return (await dbGet<Channel[]>(KEY_CHANNELS)) || [];
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

export async function setPendingInput(userId: number, state: string): Promise<void> {
  const all = (await dbGet<Record<string, PendingInput>>(KEY_PENDING)) || {};
  all[String(userId)] = { state, at: new Date().toISOString() };
  await dbSet(KEY_PENDING, all);
}

export async function clearPendingInput(userId: number): Promise<void> {
  const all = (await dbGet<Record<string, PendingInput>>(KEY_PENDING)) || {};
  delete all[String(userId)];
  await dbSet(KEY_PENDING, all);
}