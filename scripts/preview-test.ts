import { createMonitorClient, fetchRawMessage } from "../src/services/mtproto";
import { classifyMedia } from "../src/services/mtproto";

async function main() {
  const client = createMonitorClient();
  await client.connect();
  const channel = "https://t.me/foronlytest";
  for (const id of [114, 113]) {
    const raw = await fetchRawMessage(client, channel, id);
    if (!raw) { console.log(id, "no raw"); continue; }
    const kind = classifyMedia(raw.media);
    console.log(id, "text:", JSON.stringify((raw.message||"").slice(0,30)), "media:", raw.media?.className, "kind:", kind, "groupedId:", raw.groupedId);
  }
  await client.disconnect();
}
main().catch(e => console.error("ERR", e?.message || e));
