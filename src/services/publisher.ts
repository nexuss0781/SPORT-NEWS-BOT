import { getConfig, markAsProcessed } from "./storage";
import { translateToAmharic } from "./translator";
import { BotConfig } from "../types";

export interface TranslationResult {
  amharic: string;
  english: string;
  sourceLang: string;
}

interface SendApi {
  sendMessage(
    chatId: string,
    text: string,
    opts?: Record<string, unknown>
  ): Promise<{ message_id: number }>;
}

function buildPostContent(
  originalText: string,
  translation: TranslationResult,
  cfg: BotConfig
): string {
  const { amharic, english, sourceLang } = translation;
  let content = "";

  if (cfg.showEnglish && sourceLang !== "en") {
    content += `🇬🇧 English:\n${english}\n\n`;
  }

  if (sourceLang === "en" && cfg.showOriginal) {
    content += `📝 Original:\n${originalText}\n\n🇪🇹 Translation:\n${amharic}`;
  } else {
    content += `📢 ${amharic}`;
  }

  if (cfg.signature) {
    content += `\n\n—\n${cfg.signature}`;
  }

  return content;
}

export async function processAndPublish(
  api: SendApi,
  channelId: string,
  messageId: number,
  text: string
): Promise<void> {
  const cfg = getConfig();
  if (!cfg.targetChannel) return;

  const translation = await translateToAmharic(text);
  const content = buildPostContent(text, translation, cfg);
  const sent = await api.sendMessage(cfg.targetChannel, content);

  markAsProcessed({
    channelId,
    messageId,
    targetMessageId: sent?.message_id,
    originalText: text,
    translatedText: translation.amharic,
    englishText: translation.english,
    sourceLang: translation.sourceLang,
    processedAt: new Date().toISOString(),
  });
}