import { config } from "../src/config";
import { getMonitorClient, fetchRawMessage, fetchGroupedMedia, downloadMedia, classifyMedia } from "../src/services/mtproto";

// Diagnostic endpoint: curl ".../api/diag?key=<secret>&channel=foronlytest&id=114"
// Reports what the media preview pipeline would do for a given source message.
export default async function handler(req: any, res: any) {
  const keyMatch =
    !config.monitorSecret ||
    req.query?.key === config.monitorSecret ||
    req.headers?.["x-vercel-cron"] === "1";
  if (!keyMatch) {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return;
  }

  const channel = String(req.query?.channel || "foronlytest");
  const id = Number(req.query?.id || 0);

  const client = await getMonitorClient();
  try {
    const raw = await fetchRawMessage(client, channel, id);
    if (!raw) {
      res.json({ ok: true, messageId: id, channel, found: false });
      return;
    }
    const out: any = {
      ok: true,
      found: true,
      messageId: id,
      channel,
      className: raw.className,
      text: String(raw.message || "").slice(0, 200),
      mediaClass: raw.media?.className,
      kind: classifyMedia(raw.media),
      groupedId: raw.groupedId != null ? String(raw.groupedId) : undefined,
      hasCaption: (raw.message || "").length > 0,
    };

    // What the preview picker uses: single media download, or album ids.
    if (raw.media && raw.media.className !== "MessageMediaEmpty") {
      const payload = await downloadMedia(client, raw);
      out.download = payload
        ? {
            kind: payload.kind,
            bytes:
              typeof payload.value === "string"
                ? payload.value.length
                : payload.value.byteLength ?? (payload.value as any).length ?? 0,
            fileName: payload.fileName,
            mimeType: payload.mimeType,
            width: payload.width,
            height: payload.height,
            valueType: typeof payload.value,
          }
        : null;
    }
    if (raw.groupedId != null) {
      const msgs = await fetchGroupedMedia(client, channel, id, raw.groupedId);
      out.album = {
        count: msgs.length,
        ids: msgs.map((m: any) => m.id),
        kinds: msgs.map((m: any) => classifyMedia(m.media)),
      };
    }
    res.json(out);
  } catch (error: any) {
    res.status(500).json({ ok: false, error: String(error?.errorMessage || error?.message || error) });
  }
}