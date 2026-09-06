import { Context, InlineKeyboard, InputFile } from "grammy";
import {
  getMainMenu,
  getChannelsMenu,
  getSettingsMenu,
  getStatusMenu,
  getHelpMenu,
  getConfirmDialog,
  getAddChannelPrompt,
  getRemoveChannelPrompt,
  getSetTargetPrompt,
  getSetSignaturePrompt,
  getSetLanguagePrompt,
  getReelsHomeMenu,
  getRolesMenu,
  getAddRolePrompt,
  getPostRulesMenu,
  getPostRulePrompt,
} from "../menus/index";
import {
  getChannels,
  addChannel,
  removeChannel,
  getConfig,
  updateConfig,
  getPendingInput,
  getPendingFull,
  setPendingInput,
  clearPendingInput,
  getQueuedReels,
  getReelById,
  getReelStats,
  updateReel,
  markAsProcessed,
  getLaneReleases,
  updateLaneReleaseViews,
  getTargetChannels,
} from "../services/storage";
import {
  encodeReelId,
  decodeReelId,
  patchText,
  extractMediaPayloadFromMessage,
  publishReelItem,
  ensureReelMeta,
  downloadSourceMedia,
} from "../services/reels";
import {
  isOwner,
  isAdminRole,
  canPost,
  getRoleMembers,
  addRoleMember,
  removeRoleMember,
  resolveUsernameToId,
} from "../services/roles";
import { toChannelUrl } from "../services/mtproto";
import { fetchViews } from "../services/views";
import { parseDuration, formatDuration, parseK, evaluateTimeRule, evaluateViewRule } from "../services/postRules";
import { BotConfig, MediaPayload, PostRules, ReelItem } from "../types";

async function requireOwner(ctx: Context): Promise<boolean> {
  if (!(await isOwner(ctx.from?.id))) {
    await ctx.reply("⛔ You are not authorized.");
    return false;
  }
  return true;
}

async function requireCanPost(ctx: Context): Promise<boolean> {
  if (!(await canPost(ctx.from?.id))) {
    await ctx.reply("⛔ You are not authorized.");
    return false;
  }
  return true;
}

async function addSourceChannel(username: string, addedBy: number): Promise<boolean> {
  const channels = await getChannels();
  const exists = channels.some(
    (c) => c.username.toLowerCase() === username.toLowerCase()
  );
  if (exists) return false;
  await addChannel({
    id: username,
    username,
    addedAt: new Date().toISOString(),
    addedBy,
  });
  return true;
}

function parseChannels(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map(toChannelUrl);
}

// Target channels are posted via Bot API, which needs @username, not URLs.
function parseTargets(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => (c.startsWith("@") ? c : `@${c.replace(/^https?:\/\/t\.me\//i, "")}`));
}

async function safeReply(ctx: Context, text: string, keyboard: any): Promise<void> {
  try {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, { reply_markup: keyboard });
    } else {
      await ctx.reply(text, { reply_markup: keyboard });
    }
  } catch (e) {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max)}\n…` : s;
}

// Build the review card body. Limits differ for text cards (messages hold
// 4096 chars) vs media captions (Bot API caps at 1024).
function buildReelText(
  reel: ReelItem,
  limits: { translated: number; original: number } = { translated: 1600, original: 900 }
): string {
  const body =
    reel.mode === "original"
      ? truncate(reel.originalText, limits.original) || "(none)"
      : truncate(reel.translatedText, limits.translated) || "(none)";
  return body;
}

function buildReelKeyboard(
  reel: ReelItem,
  compact = false
): { text: string; keyboard: InlineKeyboard } {
  const enc = encodeReelId(reel.id);
  let text = compact
    ? buildReelText(reel, { translated: 620, original: 300 })
    : buildReelText(reel);
  if (reel.scheduledAt) {
    const at = new Date(reel.scheduledAt);
    text += `\n\n📅 Scheduled: ${at.toLocaleString()}`;
  }

  const keyboard = new InlineKeyboard()
    .text("✏️ Rewrite", `reel:rewrite:${enc}`)
    .text("🩹 Edit", `reel:patch:${enc}`)
    .row()
    .text(
      reel.mode === "translated" ? "🔁 Use Original" : "🌐 Use Translation",
      `reel:toggle:${enc}`
    );
  if (reel.sourceLink && reel.sourceLink.startsWith("http")) {
    keyboard.url("🔗 Original Post", reel.sourceLink);
  } else {
    keyboard.text("🔗 Original Post", "reel:na");
  }
  keyboard
    .row()
    .text("🖼 Add Media", `reel:addmedia:${enc}`)
    .text("📤 Post", `reel:post:${enc}`)
    .row()
    .text("⚡ Post Now", `reel:postnow:${enc}`)
    .text("📅 Schedule", `reel:schedule:${enc}`)
    .row()
    .text("◀️ Menu", "menu:main")
    .text("⏭ Skip", `reel:skip:${enc}`);

  return { text, keyboard };
}

// Latest sent review-card message per admin so re-renders can clean up.
const reviewCards = new Map<number, number>();

// Pick the media to preview on the review card. Everything here is cheap:
// admin-added or pre-cached media (no MTProto). A live re-download from the
// source is the last resort and can be slow.
async function pickPreviewMedia(reel: ReelItem): Promise<MediaPayload | undefined> {
  if (reel.addedMedia.length > 0) {
    return reel.addedMedia[0];
  }
  if (reel.previewMedia) {
    return reel.previewMedia;
  }
  if (reel.previewFileId && reel.previewKind) {
    return { kind: reel.previewKind as MediaPayload["kind"], value: reel.previewFileId };
  }
  if (reel.sourceGroupedMedia && reel.sourceGroupedMedia.length > 0) {
    return reel.sourceGroupedMedia[0];
  }
  if (!reel.sourceMedia) return undefined;
  return await downloadSourceMedia(reel.channelId, reel.sourceMessageId);
}

// Extract a reusable Bot API file_id from a sent media message.
function extractFileId(sent: any, kind: string): string | undefined {
  if (!sent) return undefined;
  if (kind === "photo") return sent.photo?.find?.((p: any) => p.file_id)?.file_id || sent.photo?.[0]?.file_id;
  return sent?.[kind]?.file_id;
}

async function sendReelMedia(
  ctx: Context,
  media: MediaPayload,
  caption: string,
  keyboard: InlineKeyboard
): Promise<any> {
  const input = toBotInput(media);
  const baseOpts: Record<string, any> = { caption, reply_markup: keyboard };
  if (media.kind === "photo") {
    const opts: Record<string, any> = { ...baseOpts };
    if (media.width) opts.width = media.width;
    if (media.height) opts.height = media.height;
    return await ctx.replyWithPhoto(input, opts);
  }
  if (media.kind === "video") {
    const opts: Record<string, any> = { ...baseOpts, supports_streaming: true };
    if (media.width) opts.width = media.width;
    if (media.height) opts.height = media.height;
    return await ctx.replyWithVideo(input, opts);
  }
  if (media.kind === "animation") return await ctx.replyWithAnimation(input, baseOpts);
  if (media.kind === "audio") return await ctx.replyWithAudio(input, baseOpts);
  return await ctx.replyWithPhoto(input, baseOpts);
}

// Turn a MediaPayload value into something grammY can send (file_id string or
// InputFile). Downloaded source buffers are wrapped with a proper filename so
// Telegram renders them as the right content type.
function toBotInput(media: MediaPayload): string | InputFile {
  if (typeof media.value === "string") return media.value;
  let buf: Buffer;
  if (Buffer.isBuffer(media.value)) {
    buf = media.value;
  } else if (
    media.value &&
    (media.value as any).type === "Buffer" &&
    Array.isArray((media.value as any).data)
  ) {
    buf = Buffer.from((media.value as any).data);
  } else if (media.value instanceof ArrayBuffer) {
    buf = Buffer.from(media.value);
  } else if (ArrayBuffer.isView(media.value)) {
    buf = Buffer.from(media.value.buffer, media.value.byteOffset, media.value.byteLength);
  } else {
    buf = Buffer.from(media.value as any);
  }
  return new InputFile(buf, media.fileName || "preview");
}

async function sendReelCard(
  ctx: Context,
  reel: ReelItem,
  header: string
): Promise<void> {
  const media = await pickPreviewMedia(reel);
  const hasPreview = !!media && media.kind !== "document";
  const { text, keyboard } = buildReelKeyboard(reel, hasPreview);
  const caption = `${header ? `${header}\n\n` : ""}${text}`;
  const userId = ctx.from?.id;

  if (hasPreview && media) {
    let sent: any;
    try {
      sent = await sendReelMedia(ctx, media, caption, keyboard);
    } catch (error: any) {
      // Any preview send failure (stale file_id, live-download timeout…) must
      // degrade to a text card rather than 500ing the webhook.
      try {
        if (typeof media.value === "string") {
          await updateReel(reel.id, { previewFileId: undefined, previewKind: undefined });
        }
        await safeReply(ctx, caption, keyboard);
      } catch {}
      return;
    }

    // Snapshot the uploaded preview as a reusable file_id so every following
    // button press skips the MTProto download + re-upload entirely.
    if (typeof media.value !== "string") {
      const fid = extractFileId(sent, media.kind);
      if (fid) {
        await updateReel(reel.id, { previewFileId: fid, previewKind: media.kind });
      }
    }

    if (userId !== undefined && sent?.message_id !== undefined) {
      const prev = reviewCards.get(userId);
      if (prev !== undefined) {
        try {
          await ctx.api.deleteMessage(ctx.chat!.id, prev);
        } catch {}
      }
      reviewCards.set(userId, sent.message_id);
    }
  } else {
    await safeReply(ctx, caption, keyboard);
  }
}

async function showQueue(ctx: Context): Promise<void> {
  const queued = await getQueuedReels();
  if (queued.length === 0) {
    const keyboard = new InlineKeyboard().text("◀️ Back", "menu:main");
    const cfg = await getConfig();
    const emptyText = cfg.reelsMode
      ? "🎞 REELS\n\nQueue is empty. New posts will land here for review."
      : "🎞 REELS\n\nQueue is empty. Enable Reels Mode in ⚙️ Settings to queue new posts here instead of auto-posting them.";
    await safeReply(ctx, emptyText, keyboard);
    return;
  }
  const count = queued.length;
  const reel = queued[0];
  await ensureReelMeta(reel);
  const fixed = (await getQueuedReels()).find((r) => r.id === reel.id) || reel;
  await sendReelCard(ctx, fixed, "");
}

async function renderReelById(ctx: Context, id: string): Promise<void> {
  const queued = await getQueuedReels();
  const idx = queued.findIndex((r) => r.id === id);
  if (idx === -1) {
    await showQueue(ctx);
    return;
  }
  const count = queued.length;
  await ensureReelMeta(queued[idx]);
  const fixed = (await getQueuedReels()).find((r) => r.id === id) || queued[idx];
  await sendReelCard(ctx, fixed, "");
}

const DEFAULT_RULES: PostRules = {
  timeEnabled: false,
  gapSeconds: 0,
  viewEnabled: false,
  freePosts: 3,
  perPost: null,
  nthCount: null,
  nthTotal: null,
};

// Evaluate the Post Rules for every target lane independently. Returns the
// lanes allowed to receive this reel now plus per-lane block reasons.
async function evaluateReelLanes(
  reel: ReelItem,
  cfg: BotConfig,
  targets: string[]
): Promise<{ ready: string[]; blocked: { lane: string; reason: string }[] }> {
  const rules = cfg.postRules;
  const ready: string[] = [];
  const blocked: { lane: string; reason: string }[] = [];
  for (const lane of targets) {
    const releases = await getLaneReleases(lane);
    if (rules?.timeEnabled) {
      const last = releases.length ? releases[releases.length - 1] : undefined;
      const t = evaluateTimeRule(rules, last?.releasedAt);
      if (!t.ok) {
        blocked.push({ lane, reason: t.reason });
        continue;
      }
    }
    if (rules?.viewEnabled && releases.length > 0) {
      const recent = releases.slice(
        -(rules.nthCount && rules.nthCount > 0 ? rules.nthCount : 1)
      );
      const views = await fetchViews(
        lane,
        recent.map((r) => r.targetMessageId)
      );
      let viewReleases = releases;
      if (views.size > 0) {
        viewReleases = releases.map((r) =>
          views.has(r.targetMessageId)
            ? { ...r, views: views.get(r.targetMessageId) }
            : r
        );
        for (const [mid, v] of views) void updateLaneReleaseViews(lane, mid, v);
      }
      const v = evaluateViewRule(rules, viewReleases);
      if (!v.ok) {
        blocked.push({ lane, reason: v.reason });
        continue;
      }
    }
    ready.push(lane);
  }
  return { ready, blocked };
}

// Mark a reel posted + processed, then reply and advance the queue.
async function finishPostedReel(
  ctx: Context,
  reel: ReelItem,
  result: { ok: boolean; error?: string; firstId?: number; ids?: Record<string, number> },
  extra?: string
): Promise<void> {
  if (!result.ok) {
    await ctx.reply(`❌ Could not post: ${result.error}`);
    return;
  }
  await updateReel(reel.id, {
    status: "posted",
    targetMessageIds: result.ids,
    targetMessageId: result.firstId,
  });
  await markAsProcessed({
    channelId: reel.channelId,
    messageId: reel.sourceMessageId,
    targetMessageIds: result.ids,
    targetMessageId: result.firstId,
    originalText: reel.originalText,
    translatedText: reel.translatedText,
    englishText: reel.englishText,
    sourceLang: reel.sourceLang,
    processedAt: new Date().toISOString(),
  });
  await ctx.reply(`✅ Posted to target channel(s).${extra ? `\n${extra}` : ""}`);
  await showQueue(ctx);
}

export function registerCallbacks(bot: any): void {
  bot.callbackQuery("menu:main", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireCanPost(ctx))) return;
    const isOwnerRole = await isOwner(ctx.from?.id);
    const { text, keyboard } = getMainMenu(isOwnerRole);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("menu:channels", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const { text, keyboard } = getChannelsMenu();
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("menu:settings", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const cfg = await getConfig();
    const { text, keyboard } = getSettingsMenu(cfg.showEnglish, cfg.showOriginal, cfg.signature, cfg.reelsMode);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("menu:status", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const cfg = await getConfig();
    const channels = await getChannels();
    const queued = (await getQueuedReels()).length;
    const { text, keyboard } = getStatusMenu({
      channels: channels.length,
      target: cfg.targetChannels,
      signature: cfg.signature,
      showEnglish: cfg.showEnglish,
      showOriginal: cfg.showOriginal,
      reelsEnabled: !!cfg.reelsMode,
      reelsQueued: queued,
    });
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("menu:help", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireCanPost(ctx))) return;
    const { text, keyboard } = getHelpMenu();
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("menu:reels", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireCanPost(ctx))) return;
    const stats = await getReelStats();
    const { text, keyboard } = getReelsHomeMenu(stats);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("menu:reels:start", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireCanPost(ctx))) return;
    await showQueue(ctx);
  });

  bot.callbackQuery("reel:na", async (ctx: Context) => {
    await ctx
      .answerCallbackQuery("🔗 This channel has no public link (private channel).")
      .catch(() => {});
  });

  bot.callbackQuery(/^reel:post:(.+)$/, async (ctx: Context) => {
    if (!(await requireCanPost(ctx))) return;
    const id = decodeReelId(ctx.callbackQuery?.data?.split(":")[2] || "");
    const reel = await getReelById(id);
    if (!reel) {
      await ctx.answerCallbackQuery("Post no longer in queue.").catch(() => {});
      await showQueue(ctx);
      return;
    }
    await ctx.answerCallbackQuery("Checking post rules…").catch(() => {});
    const cfg = await getConfig();
    const targets = await getTargetChannels();
    const { ready, blocked } = await evaluateReelLanes(reel, cfg, targets);
    if (ready.length === 0) {
      const lines = blocked.map((b) => `▪️ ${b.lane}: ${b.reason}`);
      await ctx.reply(
        `⛔ Post is on hold by the rules.\n\n${lines.join("\n")}\n\nUse ⚡ Post Now to override (breaking news), or 📅 Schedule a time.`
      );
      return;
    }
    const result =
      blocked.length > 0
        ? await publishReelItem(bot as any, reel, { allowedTargets: ready })
        : await publishReelItem(bot as any, reel);
    const skipped =
      blocked.length > 0
        ? `\nSkipped by rules:\n${blocked.map((b) => `▪️ ${b.lane}: ${b.reason}`).join("\n")}`
        : "";
    await finishPostedReel(ctx, reel, result, skipped);
  });

  bot.callbackQuery(/^reel:postnow:(.+)$/, async (ctx: Context) => {
    if (!(await requireCanPost(ctx))) return;
    const id = decodeReelId(ctx.callbackQuery?.data?.split(":")[2] || "");
    const reel = await getReelById(id);
    if (!reel) {
      await ctx.answerCallbackQuery("Post no longer in queue.").catch(() => {});
      await showQueue(ctx);
      return;
    }
    await ctx.answerCallbackQuery("Posting now…").catch(() => {});
    const result = await publishReelItem(bot as any, reel);
    await finishPostedReel(ctx, reel, result);
  });

  bot.callbackQuery(/^reel:schedule:(.+)$/, async (ctx: Context) => {
    if (!(await requireCanPost(ctx))) return;
    const enc = ctx.callbackQuery?.data?.split(":")[2] || "";
    await setPendingInput(ctx.from!.id, `reel_schedule:${enc}`);
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply(
      "📅 Send a duration from now — examples:\n15min, 1hr, 2h 30min, 1day, 90s (or a plain number of minutes).\nThe post bypasses the rules when it goes out. (/cancel to abort)"
    );
  });

  bot.callbackQuery(/^reel:skip:(.+)$/, async (ctx: Context) => {
    if (!(await requireCanPost(ctx))) return;
    const id = decodeReelId(ctx.callbackQuery?.data?.split(":")[2] || "");
    await updateReel(id, { status: "skipped" });
    await ctx.answerCallbackQuery("Skipped ⏭").catch(() => {});
    await showQueue(ctx);
  });

  bot.callbackQuery(/^reel:toggle:(.+)$/, async (ctx: Context) => {
    if (!(await requireCanPost(ctx))) return;
    const id = decodeReelId(ctx.callbackQuery?.data?.split(":")[2] || "");
    const reel = await getReelById(id);
    if (reel) {
      const mode = reel.mode === "translated" ? "original" : "translated";
      await updateReel(id, { mode });
    }
    await ctx.answerCallbackQuery().catch(() => {});
    await renderReelById(ctx, id);
  });

  bot.callbackQuery(/^reel:rewrite:(.+)$/, async (ctx: Context) => {
    if (!(await requireCanPost(ctx))) return;
    const enc = ctx.callbackQuery?.data?.split(":")[2] || "";
    await setPendingInput(ctx.from!.id, `reel_rewrite:${enc}`);
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply("✏️ Send the new rewritten text. It replaces the current translation. (/cancel to abort)");
  });

  bot.callbackQuery(/^reel:patch:(.+)$/, async (ctx: Context) => {
    if (!(await requireCanPost(ctx))) return;
    const enc = ctx.callbackQuery?.data?.split(":")[2] || "";
    await setPendingInput(ctx.from!.id, `reel_patch:${enc}`);
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply("✏️ Send the change as:\nOLD text => NEW text\n(/cancel to abort)");
  });

  bot.callbackQuery(/^reel:addmedia:(.+)$/, async (ctx: Context) => {
    if (!(await requireCanPost(ctx))) return;
    const enc = ctx.callbackQuery?.data?.split(":")[2] || "";
    await setPendingInput(ctx.from!.id, `reel_addmedia:${enc}`);
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply("🖼 Send photos, videos, gifs, audio or files to attach to this post. Send /done when finished.");
  });

  bot.callbackQuery("channel:add", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const { text, keyboard } = getAddChannelPrompt();
    await safeReply(ctx, text, keyboard);
    await setPendingInput(ctx.from!.id, "addsource");
  });

  bot.callbackQuery("channel:remove", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const channels = (await getChannels()).map((c) => c.username);
    const { text, keyboard } = getRemoveChannelPrompt(channels);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery(/^channel:confirmremove:(.+)$/, async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const channelUsername = ctx.callbackQuery?.data?.split(":")[2] || "";
    const { text, keyboard } = getConfirmDialog(
      `Remove ${channelUsername} from monitored channels?`,
      `channel:doremove:${channelUsername}`,
      "menu:channels"
    );
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery(/^channel:doremove:(.+)$/, async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const channelUsername = ctx.callbackQuery?.data?.split(":")[2] || "";
    await removeChannel(channelUsername);
    const { text, keyboard } = getChannelsMenu();
    await safeReply(ctx, `✅ ${channelUsername} removed.\n\n${text}`, keyboard);
  });

  bot.callbackQuery("channel:list", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const channels = await getChannels();
    let text: string;
    if (channels.length === 0) {
      text = [
        "╔══════════════════════════╗",
        "║   📋 MONITORED CHANNELS   ║",
        "╚══════════════════════════╝",
        "",
        "No channels being monitored.",
        "Use ➕ Add Channel to add one.",
      ].join("\n");
    } else {
      const list = channels.map((c, i) => `${i + 1}. ${c.username}`).join("\n");
      text = [
        "╔══════════════════════════╗",
        "║   📋 MONITORED CHANNELS   ║",
        "╚══════════════════════════╝",
        "",
        list,
        "",
        `Total: ${channels.length} channels`,
      ].join("\n");
    }
    const { InlineKeyboard } = await import("grammy");
    const keyboard = new InlineKeyboard().text("◀️ Back", "menu:channels");
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("channel:target", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const { text, keyboard } = getSetTargetPrompt();
    await safeReply(ctx, text, keyboard);
    await setPendingInput(ctx.from!.id, "addtarget");
  });

  bot.callbackQuery("setting:toggle:english", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const cfg = await getConfig();
    await updateConfig({ showEnglish: !cfg.showEnglish });
    const updated = await getConfig();
    const { text, keyboard } = getSettingsMenu(updated.showEnglish, updated.showOriginal, updated.signature, updated.reelsMode);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("setting:toggle:original", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const cfg = await getConfig();
    await updateConfig({ showOriginal: !cfg.showOriginal });
    const updated = await getConfig();
    const { text, keyboard } = getSettingsMenu(updated.showEnglish, updated.showOriginal, updated.signature, updated.reelsMode);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("setting:toggle:reels", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const cfg = await getConfig();
    await updateConfig({ reelsMode: !cfg.reelsMode });
    const updated = await getConfig();
    const { text, keyboard } = getSettingsMenu(updated.showEnglish, updated.showOriginal, updated.signature, updated.reelsMode);
    await safeReply(
      ctx,
      `${updated.reelsMode ? "🎞 Reels mode ON — new posts are queued for manual review instead of auto-posting." : "🎞 Reels mode OFF — posts auto-publish as before."}\n\n${text}`,
      keyboard
    );
  });

  bot.callbackQuery("setting:signature", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const cfg = await getConfig();
    const { text, keyboard } = getSetSignaturePrompt(cfg.signature);
    await safeReply(ctx, text, keyboard);
    await setPendingInput(ctx.from!.id, "setsignature");
  });

  bot.callbackQuery("setting:language", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const { text, keyboard } = getSetLanguagePrompt();
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery(/^setting:setlang:(.+)$/, async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const lang = ctx.callbackQuery?.data?.split(":")[2] || "am";
    await updateConfig({ translatedLang: lang });
    const cfg = await getConfig();
    const { text, keyboard } = getSettingsMenu(cfg.showEnglish, cfg.showOriginal, cfg.signature, cfg.reelsMode);
    const langNames: Record<string, string> = {
      am: "Amharic", ar: "Arabic", fr: "French",
      es: "Spanish", de: "German", pt: "Portuguese",
    };
    await safeReply(ctx, `✅ Language set to ${langNames[lang] || lang}.\n\n${text}`, keyboard);
  });

  bot.callbackQuery("setting:roles", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const owners = await getRoleMembers("owner");
    const admins = await getRoleMembers("admin");
    const { text, keyboard } = getRolesMenu({ owners, admins });
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery(/^setting:role:add:(.+)$/, async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const role = (ctx.callbackQuery?.data?.split(":")[3] || "") as "owner" | "admin";
    if (role !== "owner" && role !== "admin") return;
    const { text, keyboard } = getAddRolePrompt(role);
    await safeReply(ctx, text, keyboard);
    await setPendingInput(ctx.from!.id, `addrole:${role}`);
  });

  bot.callbackQuery(/^setting:role:remove:(.+):(.+)$/, async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const [role, rawId] = ctx.callbackQuery?.data?.replace(/^setting:role:remove:/, "").split(":") || [];
    const id = Number(rawId);
    if ((role !== "owner" && role !== "admin") || !Number.isInteger(id)) return;
    const { text, keyboard } = getConfirmDialog(
      `Remove this ${role === "owner" ? "👑 owner" : "📰 admin"} (${id})?`,
      `setting:role:doremove:${role}:${id}`,
      "setting:roles"
    );
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery(/^setting:role:doremove:(.+):(.+)$/, async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const [role, rawId] = ctx.callbackQuery?.data?.replace(/^setting:role:doremove:/, "").split(":") || [];
    const id = Number(rawId);
    if ((role !== "owner" && role !== "admin") || !Number.isInteger(id)) return;
    await removeRoleMember(role, id);
    const owners = await getRoleMembers("owner");
    const admins = await getRoleMembers("admin");
    const { text, keyboard } = getRolesMenu({ owners, admins });
    await safeReply(ctx, `✅ ${role === "owner" ? "Owner" : "Admin"} removed.\n\n${text}`, keyboard);
  });

  bot.callbackQuery("setting:postrules", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const cfg = await getConfig();
    const rules = { ...DEFAULT_RULES, ...(cfg.postRules || {}) };
    const { text, keyboard } = getPostRulesMenu(rules);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery(/^postrule:toggle:(.+)$/, async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const which = ctx.callbackQuery?.data?.split(":")[2] || "";
    const cfg = await getConfig();
    const rules = { ...DEFAULT_RULES, ...(cfg.postRules || {}) };
    if (which === "time") rules.timeEnabled = !rules.timeEnabled;
    else if (which === "view") rules.viewEnabled = !rules.viewEnabled;
    else return;
    await updateConfig({ postRules: rules });
    const updated = (await getConfig()).postRules || rules;
    const { text, keyboard } = getPostRulesMenu(updated);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery(/^postrule:gap:(\d+)$/, async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const seconds = Number(ctx.callbackQuery?.data?.split(":")[2]);
    if (!Number.isInteger(seconds) || seconds <= 0) return;
    const cfg = await getConfig();
    const rules = { ...DEFAULT_RULES, ...(cfg.postRules || {}) };
    rules.gapSeconds = seconds;
    await updateConfig({ postRules: rules });
    const updated = (await getConfig()).postRules || rules;
    const { text, keyboard } = getPostRulesMenu(updated);
    await safeReply(ctx, `✅ Time gap set to ${formatDuration(seconds)}.\n\n${text}`, keyboard);
  });

  bot.callbackQuery(/^postrule:(gapcustom|perpost|freeposts|nthcount|nthtotal)$/, async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!(await requireOwner(ctx))) return;
    const kind = ctx.callbackQuery?.data?.split(":")[1] || "";
    await setPendingInput(ctx.from!.id, `postrule_${kind}`);
    const { text, keyboard } = getPostRulePrompt(kind);
    await safeReply(ctx, text, keyboard);
  });

  bot.on("message:text", async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (!userId || !(await canPost(userId))) return;

    const text = (ctx.message?.text || "").trim();
    if (!text) return;

    const state = await getPendingInput(userId);

    // No pending flow: a bare @username (or https://t.me/...) adds a source channel
    if (!state) {
      if (!(await isOwner(userId))) return;
      const match = text.match(/^(@?https?:\/\/t\.me\/)?[A-Za-z0-9_]{3,}$/i);
      if (match) {
        const username = text.match(/^@[A-Za-z0-9_]{3,}$/)
          ? text
          : `@${text.replace(/^https?:\/\/t\.me\//i, "")}`;
        const normalized = toChannelUrl(username);
        const added = await addSourceChannel(normalized, userId);
        if (added) {
          const channels = await getChannels();
          await ctx.reply(`✅ ${normalized} added as source channel.\n\nTotal sources: ${channels.length}\n\nTap 📥 Source Channels to add more, or 📤 Target Channels to set the output.`);
        } else {
          await ctx.reply(`ℹ️ ${normalized} is already a source channel.`);
        }
      }
      return;
    }

    if (text === "/cancel") {
      const state = await getPendingInput(userId);
      await clearPendingInput(userId);
      if (
        state?.startsWith("reel_rewrite:") ||
        state?.startsWith("reel_patch:") ||
        state?.startsWith("reel_schedule:")
      ) {
        const enc = state.split(":").slice(1).join(":");
        const id = decodeReelId(enc);
        const reel = await getReelById(id);
        if (reel) {
          await renderReelById(ctx, id);
          return;
        }
      }
      if (state?.startsWith("postrule_")) {
        const cfg = await getConfig();
        const rules = { ...DEFAULT_RULES, ...(cfg.postRules || {}) };
        const { text: rulesText, keyboard } = getPostRulesMenu(rules);
        await ctx.reply(rulesText, { reply_markup: keyboard });
        return;
      }
      const isOwnerRole = await isOwner(userId);
      const { text: menuText, keyboard } = getMainMenu(isOwnerRole);
      await ctx.reply(menuText, { reply_markup: keyboard });
      return;
    }

    if (state.startsWith("reel_rewrite:")) {
      const enc = state.slice("reel_rewrite:".length);
      const id = decodeReelId(enc);
      const reel = await getReelById(id);
      if (!reel) {
        await clearPendingInput(userId);
        await ctx.reply("❌ Reel not found anymore.");
        return;
      }
      await updateReel(id, { translatedText: text });
      await clearPendingInput(userId);
      await ctx.reply("✅ Translation updated.");
      await renderReelById(ctx, id);
      return;
    }

    if (state.startsWith("reel_patch:")) {
      const enc = state.slice("reel_patch:".length);
      const sep = text.indexOf("=>");
      if (sep === -1) {
        await ctx.reply("❌ Use this format:\nOLD text => NEW text");
        return;
      }
      const oldText = text.slice(0, sep).trim();
      const newText = text.slice(sep + 2).trim();
      if (!oldText || !newText) {
        await ctx.reply("❌ Both OLD and NEW text are required:\nOLD text => NEW text");
        return;
      }
      const id = decodeReelId(enc);
      const reel = await getReelById(id);
      if (!reel) {
        await clearPendingInput(userId);
        await ctx.reply("❌ Reel not found anymore.");
        return;
      }
      const activeIsOriginal = reel.mode === "original";
      const current = activeIsOriginal ? reel.originalText : reel.translatedText;
      const patched = patchText(current, oldText, newText);
      if (patched === null) {
        await ctx.reply("❌ OLD text not found in the post.\nSend:\nOLD text => NEW text");
        return;
      }
      if (activeIsOriginal) {
        await updateReel(id, { originalText: patched });
      } else {
        await updateReel(id, { translatedText: patched });
      }
      await clearPendingInput(userId);
      await ctx.reply("✅ Patched. The rest of the post is intact.");
      await renderReelById(ctx, id);
      return;
    }

    if (state.startsWith("reel_addmedia:")) {
      if (text === "/done") {
        await clearPendingInput(userId);
        const enc = state.slice("reel_addmedia:".length);
        await ctx.reply("✅ Media attachments saved.");
        await renderReelById(ctx, decodeReelId(enc));
      } else {
        await ctx.reply("📎 Send a photo, video, gif, audio or file, or send /done to finish.");
      }
      return;
    }

    if (state.startsWith("reel_schedule:")) {
      const enc = state.slice("reel_schedule:".length);
      const id = decodeReelId(enc);
      const reel = await getReelById(id);
      if (!reel) {
        await clearPendingInput(userId);
        await ctx.reply("❌ Reel not found anymore.");
        return;
      }
      const seconds = parseDuration(text);
      if (!seconds) {
        await ctx.reply("❌ Could not understand that duration. Use e.g. 15min, 1hr, 2h 30min, 1day, 90s — or a plain number of minutes.");
        return;
      }
      const when = new Date(Date.now() + seconds * 1000).toISOString();
      await updateReel(id, { scheduledAt: when });
      await clearPendingInput(userId);
      await ctx.reply(
        `📅 Scheduled in ${formatDuration(seconds)} — ${new Date(when).toLocaleString()}. It will bypass the rules when it posts.`
      );
      await renderReelById(ctx, id);
      return;
    }

    if (state.startsWith("postrule_")) {
      if (!(await isOwner(userId))) return;
      const kind = state.slice("postrule_".length);
      const cfg = await getConfig();
      const rules = { ...DEFAULT_RULES, ...(cfg.postRules || {}) };
      if (kind === "gap") {
        const seconds = parseDuration(text);
        if (!seconds) {
          await ctx.reply("❌ Could not understand that duration. Use e.g. 15min, 1hr, 2h 30min, 1day, 90s — or a plain number of minutes.");
          return;
        }
        rules.gapSeconds = seconds;
      } else if (kind === "perpost") {
        const v = parseK(text);
        if (v == null || v <= 0) {
          await ctx.reply("❌ Invalid target. Use e.g. 500, 1k, 5k, 10k.");
          return;
        }
        rules.perPost = v;
      } else if (kind === "freeposts") {
        const v = parseInt(text, 10);
        if (!Number.isInteger(v) || v < 0) {
          await ctx.reply("❌ Invalid number. Use e.g. 0, 3, 5.");
          return;
        }
        rules.freePosts = v;
      } else if (kind === "nthcount") {
        const v = parseInt(text, 10);
        if (!Number.isInteger(v) || v <= 0) {
          await ctx.reply("❌ Invalid batch size. Use e.g. 3, 5, 10.");
          return;
        }
        rules.nthCount = v;
      } else if (kind === "nthtotal") {
        const v = parseK(text);
        if (v == null || v <= 0) {
          await ctx.reply("❌ Invalid total. Use e.g. 1k, 5k, 10k.");
          return;
        }
        rules.nthTotal = v;
      } else {
        return;
      }
      await updateConfig({ postRules: rules });
      await clearPendingInput(userId);
      const updated = (await getConfig()).postRules || rules;
      const { text: menuText, keyboard } = getPostRulesMenu(updated);
      await ctx.reply(`✅ Post rules updated.\n\n${menuText}`, { reply_markup: keyboard });
      return;
    }

    switch (state) {
      case "addsource": {
        if (!(await isOwner(userId))) return;
        const usernames = parseChannels(text);
        if (usernames.length === 0) {
          await ctx.reply("⚠️ No valid channels found. Send usernames like: @sky_sports, @united");
          return;
        }
        const skipped: string[] = [];
        let added = 0;
        for (const username of usernames) {
          if (await addSourceChannel(username, userId)) {
            added++;
          } else {
            skipped.push(username);
          }
        }
        await clearPendingInput(userId);
        const { text: menuText, keyboard } = getChannelsMenu();
        const lines = [`✅ Added: ${added}`, `Total sources: ${(await getChannels()).length}`];
        if (skipped.length > 0) lines.push(`Already present: ${skipped.join(", ")}`);
        lines.push("", menuText);
        await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
        break;
      }
      case "addtarget":
      case "settarget": {
        if (!(await isOwner(userId))) return;
        const usernames = parseTargets(text);
        if (usernames.length === 0) {
          await ctx.reply("⚠️ No valid channels found. Send usernames like: @sport_news, @sport_news2");
          return;
        }
        const unique = [...new Set(usernames)];
        await updateConfig({ targetChannels: unique, targetChannel: unique[0] });
        await clearPendingInput(userId);
        const { text: menuText, keyboard } = getChannelsMenu();
        await ctx.reply(`✅ Target channels set:\n\n${unique.join("\n")}\n\nTotal: ${unique.length}\n\n${menuText}`, { reply_markup: keyboard });
        break;
      }
      case "setsignature": {
        if (!(await isOwner(userId))) return;
        await updateConfig({ signature: text });
        await clearPendingInput(userId);
        const cfg = await getConfig();
        const { text: menuText, keyboard } = getSettingsMenu(cfg.showEnglish, cfg.showOriginal, cfg.signature, cfg.reelsMode);
        await ctx.reply(`✅ Signature updated.\n\n${menuText}`, { reply_markup: keyboard });
        break;
      }
    }

    if (state.startsWith("addrole:")) {
      if (!(await isOwner(userId))) return;
      const role = state.slice("addrole:".length) as "owner" | "admin";
      if (role !== "owner" && role !== "admin") return;
      const result = await resolveUsernameToId(text);
      if (!result.ok) {
        await ctx.reply(`❌ ${result.error}`);
        return;
      }
      const roleLabel = role === "owner" ? "👑 owner" : "📰 admin";
      const added = await addRoleMember(role, result.id, result.username || result.name);
      if (!added) {
        await ctx.reply(`ℹ️ ${result.name} is already a ${roleLabel}.`);
        return;
      }
      await clearPendingInput(userId);
      const owners = await getRoleMembers("owner");
      const admins = await getRoleMembers("admin");
      const { text: menuText, keyboard } = getRolesMenu({ owners, admins });
      await ctx.reply(`✅ ${result.name} is now a ${roleLabel}.\n\n${menuText}`, { reply_markup: keyboard });
    }
  });

  // Capture media/files sent by an authorized reviewer while in "Add Media" reel state
  bot.on("message", async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (!userId || !(await canPost(userId))) return;
    const message = ctx.message;
    if (!message) return;

    const state = await getPendingInput(userId);
    if (!state || !state.startsWith("reel_addmedia:")) return;

    const payload = extractMediaPayloadFromMessage(message);
    if (!payload) return;

    const enc = state.slice("reel_addmedia:".length);
    const id = decodeReelId(enc);
    const reel = await getReelById(id);
    if (!reel) return;

    const addedMedia = [...(reel.addedMedia || []), payload];
    await updateReel(id, { addedMedia });
    await ctx.reply(
      `✅ Added: ${payload.kind} (total ${addedMedia.length}). Send more or /done to finish.`
    );
  });
}
