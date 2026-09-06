import { TelegramClient } from "telegram";
import { Api } from "telegram/tl";
import { getMonitorClient, normalizeUsername } from "./mtproto";

// Fetch current view counts for published messages in a target channel.
// Returns a map id -> views. Messages the session cannot see are skipped.
export async function fetchViews(
  laneUsername: string,
  messageIds: number[]
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const clean = normalizeUsername(laneUsername);
  const unique = [...new Set(messageIds)].filter((id) => Number.isInteger(id));
  if (!clean || unique.length === 0) return out;

  try {
    const client: TelegramClient = await getMonitorClient();
    const peer = await client.getInputEntity(clean);
    void peer;
    // Batch: GetMessages accepts an array of ids (one message per id).
    const CHUNK = 50;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const res: any = await client.invoke(
        new Api.messages.GetMessages({ id: chunk as any })
      );
      const msgs: any[] = res?.messages || [];
      for (const m of msgs) {
        if (m?.className !== "Message") continue;
        const views = m.views ?? 0;
        out.set(m.id, typeof views === "number" ? views : Number(views) || 0);
      }
    }
  } catch (error: any) {
    console.error(
      `[views] fetchViews failed for ${clean}:`,
      error?.errorMessage || error?.message || error
    );
  }
  return out;
}