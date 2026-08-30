export interface Channel {
  id: string;
  username: string;
  addedAt: string;
  addedBy: number;
}

export interface BotConfig {
  targetChannel: string | null;
  signature: string;
  translatedLang: string;
}

export interface ProcessedPost {
  channelId: string;
  messageId: number;
  processedAt: string;
}

export interface StorageData<T> {
  data: T;
  lastUpdated: string;
}
