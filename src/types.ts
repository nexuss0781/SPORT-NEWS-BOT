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
  showEnglish: boolean;
  showOriginal: boolean;
}

export interface ProcessedPost {
  channelId: string;
  messageId: number;
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
