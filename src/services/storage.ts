import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { BotConfig, Channel, ProcessedPost, StorageData } from "../types";
export { ProcessedPost } from "../types";

const DATA_DIR = "/tmp/bot-data";

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJsonFile<T>(filename: string, defaultValue: T): T {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, filename);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content).data;
    }
  } catch {
    // Return default on error
  }
  return defaultValue;
}

function writeJsonFile<T>(filename: string, data: T): void {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, filename);
  const payload: StorageData<T> = {
    data,
    lastUpdated: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

// Bot Config
const DEFAULT_CONFIG: BotConfig = {
  targetChannel: null,
  targetChannels: [],
  signature: "",
  translatedLang: "am",
  showEnglish: false,
  showOriginal: false,
};

export function getConfig(): BotConfig {
  const cfg = readJsonFile<BotConfig>("config.json", DEFAULT_CONFIG);
  // Migrate legacy single targetChannel into targetChannels
  if (cfg.targetChannel && (!cfg.targetChannels || cfg.targetChannels.length === 0)) {
    const migrated = { ...cfg, targetChannels: [cfg.targetChannel] };
    writeJsonFile("config.json", migrated);
    return migrated;
  }
  return cfg;
}

export function getTargetChannels(): string[] {
  return getConfig().targetChannels || [];
}

export function updateConfig(updates: Partial<BotConfig>): BotConfig {
  const current = getConfig();
  const updated = { ...current, ...updates };
  if (updates.targetChannel !== undefined && updates.targetChannels === undefined) {
    updated.targetChannels = updates.targetChannel ? [updates.targetChannel] : [];
  }
  if (updated.targetChannels !== undefined) {
    updated.targetChannel = updated.targetChannels.length > 0 ? updated.targetChannels[0] : null;
  }
  writeJsonFile("config.json", updated);
  return updated;
}

// Channels
export function getChannels(): Channel[] {
  return readJsonFile<Channel[]>("channels.json", []);
}

export function addChannel(channel: Channel): Channel[] {
  const channels = getChannels();
  const exists = channels.some(
    (c) => c.username.toLowerCase() === channel.username.toLowerCase()
  );
  if (exists) {
    return channels;
  }
  channels.push(channel);
  writeJsonFile("channels.json", channels);
  return channels;
}

export function removeChannel(username: string): Channel[] {
  let channels = getChannels();
  channels = channels.filter(
    (c) => c.username.toLowerCase() !== username.toLowerCase()
  );
  writeJsonFile("channels.json", channels);
  return channels;
}

// Processed Posts
export function getProcessedPosts(): ProcessedPost[] {
  return readJsonFile<ProcessedPost[]>("processed.json", []);
}

export function markAsProcessed(post: ProcessedPost): void {
  const posts = getProcessedPosts();
  const exists = posts.some(
    (p) => p.channelId === post.channelId && p.messageId === post.messageId
  );
  if (!exists) {
    posts.push(post);
    // Keep only last 1000 posts to prevent file bloat
    const trimmed = posts.slice(-1000);
    writeJsonFile("processed.json", trimmed);
  }
}

export function isProcessed(channelId: string, messageId: number): boolean {
  const posts = getProcessedPosts();
  return posts.some(
    (p) => p.channelId === channelId && p.messageId === messageId
  );
}

export function getProcessedPost(channelId: string, messageId: number): ProcessedPost | undefined {
  const posts = getProcessedPosts();
  return posts.find(
    (p) => p.channelId === channelId && p.messageId === messageId
  );
}

export function getProcessedPostByTargetMessage(
  chatId: string | number,
  messageId: number
): ProcessedPost | undefined {
  const posts = getProcessedPosts();
  return posts.find((p) => {
    if (p.targetMessageIds && p.targetMessageIds[String(chatId)] === messageId) return true;
    return p.targetMessageId === messageId;
  });
}

// Pending multi-step menu input state (survives between serverless instances)
interface PendingInput {
  state: string;
  at: string;
}

export function getPendingInput(userId: number): string | undefined {
  const all = readJsonFile<Record<string, PendingInput>>("pending.json", {});
  const entry = all[String(userId)];
  if (!entry) return undefined;
  if (Date.now() - new Date(entry.at).getTime() > 10 * 60 * 1000) {
    clearPendingInput(userId);
    return undefined;
  }
  return entry.state;
}

export function setPendingInput(userId: number, state: string): void {
  const all = readJsonFile<Record<string, PendingInput>>("pending.json", {});
  all[String(userId)] = { state, at: new Date().toISOString() };
  writeJsonFile("pending.json", all);
}

export function clearPendingInput(userId: number): void {
  const all = readJsonFile<Record<string, PendingInput>>("pending.json", {});
  delete all[String(userId)];
  writeJsonFile("pending.json", all);
}
