import { createMonitorClient } from "../src/services/mtproto";
import { Api } from "telegram/tl";

async function main() {
  const client = createMonitorClient();
  await client.connect();
  const peer = await client.getInputEntity("foronlytest");
  const res = await client.invoke(new Api.messages.GetHistory({ peer, limit: 12 })) as any;
  for (const m of res.messages) {
    console.log(m.id, JSON.stringify(String(m.message||"").slice(0,40)), m.media?.className, "grouped:", m.groupedId != null ? String(m.groupedId) : "-");
  }
  await client.disconnect();
}
main().catch(e => console.error("ERR", e?.message || e));
