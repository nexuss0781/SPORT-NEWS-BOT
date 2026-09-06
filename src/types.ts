export interface Channel {
  id: string;
  username: string;
  addedAt: string;
  addedBy: number;
}

export interface BotConfig {
  targetChannel: string | null;
  targetChannels: string[];
  signature: string;
  translatedLang: string;
  showEnglish: boolean;
  showOriginal: boolean;
  reelsMode?: boolean;
  owners?: number[];
  admins?: number[];
  roleNames?: Record<string, string>;
}

export interface CustomEmoji {
  emojiChar: string;
  emojiId: string;
}

export interface ReelItem {
  id: string;
  channelId: string;
  channelTitle?: string;
  sourceMessageId: number;
  sourceLink?: string;
  originalText: string;
  translatedText: string;
  englishText?: string;
  sourceLang: string;
  mode: "translated" | "original";
  sourceMedia: boolean;
  sourceGroupedId?: bigint | string;
  sourceGroupedMedia?: MediaPayload[];
  customEmoji: CustomEmoji[];
  addedMedia: MediaPayload[];
  status: "queued" | "posted" | "skipped";
  queuedAt: string;
  targetMessageIds?: Record<string, number>;
  targetMessageId?: number;
}

export interface MediaPayload {
  kind: "photo" | "video" | "animation" | "document" | "audio";
  value: string | Buffer | Uint8Array | ArrayBuffer;
  fileName?: string;
  mimeType?: string;
  duration?: number;
  width?: number;
  height?: number;
}

export interface ProcessedPost {
  channelId: string;
  messageId: number;
  targetMessageIds?: Record<string, number>;
  targetMessageId?: number;
  originalText: string;
  translatedText: string;
  englishText?: string;
  sourceLang: string;
  processedAt: string;
}

export interface StorageData<T> {
  data: T;
  lastUpdated: string;
}
