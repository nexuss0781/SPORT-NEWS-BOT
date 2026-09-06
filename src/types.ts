export interface Channel {
  id: string;
  username: string;
  addedAt: string;
  addedBy: number;
}

export interface PostRules {
  timeEnabled: boolean;
  gapSeconds: number;
  viewEnabled: boolean;
  freePosts: number;
  perPost: number | null;
  nthCount: number | null;
  nthTotal: number | null;
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
  postRules?: PostRules;
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
  // Small pre-downloaded single-media preview (set by the monitor) so review
  // cards render without touching MTProto on every button press.
  previewMedia?: MediaPayload;
  // Last preview file_id sent to the review chat, so re-renders don't hit MTProto.
  previewFileId?: string;
  previewKind?: string;
  status: "queued" | "posting" | "posted" | "skipped";
  queuedAt: string;
  scheduledAt?: string;
  postingAt?: string;
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
