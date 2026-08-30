import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram/tl";
import { config } from "../config";

export interface MonitorMessage {
  messageId: number;
  text: string;
  date: number;
  hasMedia: boolean;
}

export function createMonitorClient(): TelegramClient {
  if (!config.telegramApiId || !config.telegramApiHash || !config.telegramSession) {
    throw new Error(
      "TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION env vars are required"
    );
  }
  return new TelegramClient(
    new StringSession(config.telegramSession),
    config.telegramApiId,
    config.telegramApiHash,
    {
      connectionRetries: 2,
      autoReconnect: false,
    }
  );
}

export async function fetchRecentMessages(
  client: TelegramClient,
  username: string,
  limit = 10
): Promise<MonitorMessage[]> {
  const cleanName = username.replace(/^@/, "").trim();
  if (!cleanName) return [];

  let peer;
  try {
    peer = await client.getInputEntity(cleanName);
  } catch {
    return [];
  }

  try {
    const result = (await client.invoke(
      new Api.messages.GetHistory({
        peer,
        limit,
      })
    )) as any;

    const messages = result?.messages || [];
    const out: MonitorMessage[] = [];
    for (const m of messages) {
      if (!m || m.className !== "Message" || !m.message) continue;
      const text = String(m.message).trim();
      if (!text) continue;
      out.push({
        messageId: m.id,
        text,
        date: m.date,
        hasMedia: Boolean(m.media && m.media.className !== "MessageMediaEmpty"),
      });
    }
    return out;
  } catch (error: any) {
    const err = error?.errorMessage || "";
    // Private/joined-required: attempt a silent join then retry once
    if (
      err.includes("CHANNEL_PRIVATE") ||
      err.includes("USER_NOT_PARTICIPANT") ||
      err.includes("CHAT_WRITE_FORBIDDEN")
    ) {
      try {
        await client.invoke(
          new Api.channels.JoinChannel({
            channel: peer,
          })
        );
        const result = (await client.invoke(
          new Api.messages.GetHistory({
            peer,
            limit,
          })
        )) as any;
        const messages = result?.messages || [];
        const out: MonitorMessage[] = [];
        for (const m of messages) {
          if (!m || m.className !== "Message" || !m.message) continue;
          const text = String(m.message).trim();
          if (!text) continue;
          out.push({
            messageId: m.id,
            text,
            date: m.date,
            hasMedia: Boolean(m.media && m.media.className !== "MessageMediaEmpty"),
          });
        }
        return out;
      } catch {
        return [];
      }
    }
    return [];
  }
}