import { TelegramClient, Api } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { config } from "../config";
import { CustomEmoji } from "../types";

// Exact server-side copy (no download/re-upload) of a source message — or a
// whole album — into a target channel, using the same user session that the
// monitor uses. Albums are preserved because all grouped ids are passed in one
// copyMessages call (teleproto groups them into a single ForwardMessages with
// dropAuthor:true, which behaves like the Bot API copyMessage).
export interface CopyTargetResult {
  target: string;
  ok: boolean;
  messageId?: number;
  error?: string;
}

export interface CopyRequest {
  sourceChannelId: string; // username / @username / https URL
  sourceMessageIds: number[]; // album: ALL grouped ids (base first)
  targetChannels: string[]; // @username or numeric ids
  caption?: string; // text to apply to the FIRST copied message
  customEmoji?: CustomEmoji[];
}

export function createCopyClient(): TelegramClient {
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

function toUsername(input: string): string {
  let u = String(input || "").trim();
  u = u.replace(/^@/, "");
  u = u.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, "");
  u = u.split(/[/?#]/)[0];
  return u;
}

async function resolveEntities(
  client: TelegramClient,
  source: string,
  targets: string[]
): Promise<{ fromPeer: any; targetPeers: any[]; error?: string }> {
  try {
    const fromPeer = await client.getInputEntity(toUsername(source));
    const targetPeers: any[] = [];
    for (const t of targets) {
      targetPeers.push(await client.getInputEntity(t));
    }
    return { fromPeer, targetPeers };
  } catch (error: any) {
    return { fromPeer: undefined, targetPeers: [], error: String(error?.message || error) };
  }
}

// Attach premium emoji entities (MTProto, not Bot API). documentId is the
// emoji document_id; runtime accepts native bigint even though the .d.ts type
// says BigInteger.
function buildMtpEmojiEntities(
  text: string,
  list: CustomEmoji[]
): Api.TypeMessageEntity[] {
  const out: Api.TypeMessageEntity[] = [];
  for (const ce of list) {
    let idx = 0;
    while ((idx = text.indexOf(ce.emojiChar, idx)) !== -1) {
      out.push(
        new Api.MessageEntityCustomEmoji({
          offset: idx,
          length: ce.emojiChar.length,
          documentId: BigInt(ce.emojiId) as any,
        })
      );
      idx += ce.emojiChar.length;
    }
  }
  return out;
}

export async function copyMessagesToTargets(
  req: CopyRequest
): Promise<CopyTargetResult[]> {
  const results: CopyTargetResult[] = [];
  const client = createCopyClient();
  try {
    await client.connect();
    const { fromPeer, targetPeers, error: entityError } = await resolveEntities(
      client,
      req.sourceChannelId,
      req.targetChannels
    );
    if (entityError || !fromPeer) {
      for (const t of req.targetChannels) {
        results.push({ target: t, ok: false, error: entityError || "resolve peer failed" });
      }
      return results;
    }

    for (let i = 0; i < targetPeers.length; i++) {
      const target = req.targetChannels[i];
      const targetPeer = targetPeers[i];
      try {
        const copied: Api.Message[] = await client.copyMessages(targetPeer, {
          messages: req.sourceMessageIds,
          fromPeer,
          dropMediaCaptions: Boolean(req.caption),
        });
        // copyMessages -> forwardMessages returns [ _getResponseMessage(...) ];
        // that inner value may itself be an array of Api.Message (albums) or a
        // single Api.Message. Flatten to the first valid message with a numeric id.
        const flat = (Array.isArray(copied) ? copied : [copied])
          .flat()
          .filter((m: any) => m?.id != null);
        const first = flat[0];
        if (!first) {
          results.push({ target, ok: false, error: "copy returned no message" });
          continue;
        }
        const copiedId = Number(first.id);
        if (!Number.isInteger(copiedId)) {
          results.push({ target, ok: false, error: "copy returned invalid message id" });
          continue;
        }
        if (req.caption) {
          const entities = buildMtpEmojiEntities(req.caption, req.customEmoji || []);
          await client.editMessage(targetPeer, {
            message: copiedId,
            text: req.caption,
            formattingEntities: entities,
          });
        }
        results.push({ target, ok: true, messageId: copiedId });
      } catch (error: any) {
        results.push({
          target,
          ok: false,
          error: String(error?.errorMessage || error?.message || error),
        });
      }
    }
    return results;
  } catch (error: any) {
    console.error("[copy] copy service failed:", error?.errorMessage || error?.message || error);
    for (const t of req.targetChannels) {
      results.push({ target: t, ok: false, error: String(error?.message || error) });
    }
    return results;
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }
}