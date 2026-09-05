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
import { isAdmin } from "../config";
import { toChannelUrl } from "../services/mtproto";
import { MediaPayload, ReelItem } from "../types";

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
  const lines = [`🎞 ${reel.channelTitle || reel.channelId}`];

  if (reel.mode === "original") {
    lines.push(
      "",
      "📝 Original:",
      truncate(reel.originalText, limits.original) || "(none)",
      "",
      "🌐 Translation:",
      truncate(reel.translatedText, limits.translated) || "(none)"
    );
  } else {
    lines.push("", truncate(reel.translatedText, limits.translated) || "(none)");
  }
  return lines.join("\n");
}

function buildReelKeyboard(
  reel: ReelItem,
  compact = false
): { text: string; keyboard: InlineKeyboard } {
  const enc = encodeReelId(reel.id);
  const text = compact
    ? buildReelText(reel, { translated: 620, original: 300 })
    : buildReelText(reel);

  const keyboard = new InlineKeyboard()
    .text("✏️ Rewrite", `reel:rewrite:${enc}`)
    .text("🩹 Patch", `reel:patch:${enc}`)
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
    .text("⏭ Skip", `reel:skip:${enc}`)
    .row()
    .text("📤 Post", `reel:post:${enc}`)
    .text("◀️ Menu", "menu:main");

  return { text, keyboard };
}

// Latest sent review-card message per admin so re-renders can clean up.
const reviewCards = new Map<number, number>();

// Pick the media to preview on the review card (admin-added first, else source).
async function pickPreviewMedia(reel: ReelItem): Promise<MediaPayload | undefined> {
  if (reel.addedMedia.length > 0) {
    return reel.addedMedia[0];
  }
  if (!reel.sourceMedia) return undefined;
  return await downloadSourceMedia(reel.channelId, reel.sourceMessageId);
}

// Turn a MediaPayload value into something grammY can send (file_id string or
// InputFile). Downloaded source buffers are wrapped with a proper filename so
// Telegram renders them as the right content type.
function toBotInput(media: MediaPayload): string | InputFile {
  if (typeof media.value === "string") return media.value;
  const buf = Buffer.isBuffer(media.value)
    ? media.value
    : Buffer.from(media.value as any);
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
  const caption = `${header}\n\n${text}`;
  const userId = ctx.from?.id;

  if (hasPreview && media) {
    // Send an actual media preview with the caption + buttons.
    const input = toBotInput(media);
    let sent: any;
    const baseOpts: Record<string, any> = { caption, reply_markup: keyboard };
    if (media.kind === "photo") {
      sent = await ctx.replyWithPhoto(input, baseOpts);
    } else if (media.kind === "video") {
      const videoOpts: Record<string, any> = { ...baseOpts, supports_streaming: true };
      if (media.width) videoOpts.width = media.width;
      if (media.height) videoOpts.height = media.height;
      sent = await ctx.replyWithVideo(input, videoOpts);
    } else if (media.kind === "animation") {
      sent = await ctx.replyWithAnimation(input, baseOpts);
    } else if (media.kind === "audio") {
      sent = await ctx.replyWithAudio(input, baseOpts);
    } else {
      const photoOpts: Record<string, any> = { ...baseOpts };
      if (media.width) photoOpts.width = media.width;
      if (media.height) photoOpts.height = media.height;
      sent = await ctx.replyWithPhoto(input, photoOpts);
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
  await sendReelCard(ctx, fixed, `Queue: ${count} post${count > 1 ? "s" : ""} • showing 1`);
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
  await sendReelCard(ctx, fixed, `Queue: ${count} post${count > 1 ? "s" : ""} • showing ${idx + 1}`);
}

export function registerCallbacks(bot: any): void {
  bot.callbackQuery("menu:main", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const { text, keyboard } = getMainMenu();
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("menu:channels", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const { text, keyboard } = getChannelsMenu();
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("menu:settings", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const cfg = await getConfig();
    const { text, keyboard } = getSettingsMenu(cfg.showEnglish, cfg.showOriginal, cfg.signature, cfg.reelsMode);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("menu:status", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
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
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const { text, keyboard } = getHelpMenu();
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("menu:reels", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const stats = await getReelStats();
    const { text, keyboard } = getReelsHomeMenu(stats);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("menu:reels:start", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    await showQueue(ctx);
  });

  bot.callbackQuery("reel:na", async (ctx: Context) => {
    await ctx
      .answerCallbackQuery("🔗 This channel has no public link (private channel).")
      .catch(() => {});
  });

  bot.callbackQuery(/^reel:post:(.+)$/, async (ctx: Context) => {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const id = decodeReelId(ctx.callbackQuery?.data?.split(":")[2] || "");
    const reel = await getReelById(id);
    if (!reel) {
      await ctx.answerCallbackQuery("Post no longer in queue.").catch(() => {});
      await showQueue(ctx);
      return;
    }
    await ctx.answerCallbackQuery("Posting…").catch(() => {});
    const result = await publishReelItem(bot as any, reel);
    if (result.ok) {
      await updateReel(id, {
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
      await ctx.reply("✅ Posted to target channel(s).");
      await showQueue(ctx);
    } else {
      await ctx.reply(`❌ Could not post: ${result.error}`);
    }
  });

  bot.callbackQuery(/^reel:skip:(.+)$/, async (ctx: Context) => {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const id = decodeReelId(ctx.callbackQuery?.data?.split(":")[2] || "");
    await updateReel(id, { status: "skipped" });
    await ctx.answerCallbackQuery("Skipped ⏭").catch(() => {});
    await showQueue(ctx);
  });

  bot.callbackQuery(/^reel:toggle:(.+)$/, async (ctx: Context) => {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
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
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const enc = ctx.callbackQuery?.data?.split(":")[2] || "";
    await setPendingInput(ctx.from!.id, `reel_rewrite:${enc}`);
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply("✏️ Send the new rewritten text. It replaces the current translation. (/cancel to abort)");
  });

  bot.callbackQuery(/^reel:patch:(.+)$/, async (ctx: Context) => {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const enc = ctx.callbackQuery?.data?.split(":")[2] || "";
    await setPendingInput(ctx.from!.id, `reel_patch_old:${enc}`);
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply("🩹 Send the OLD text (exact phrase or line) to find in the post. (/cancel to abort)");
  });

  bot.callbackQuery(/^reel:addmedia:(.+)$/, async (ctx: Context) => {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const enc = ctx.callbackQuery?.data?.split(":")[2] || "";
    await setPendingInput(ctx.from!.id, `reel_addmedia:${enc}`);
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply("🖼 Send photos, videos, gifs, audio or files to attach to this post. Send /done when finished.");
  });

  bot.callbackQuery("channel:add", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const { text, keyboard } = getAddChannelPrompt();
    await safeReply(ctx, text, keyboard);
    await setPendingInput(ctx.from!.id, "addsource");
  });

  bot.callbackQuery("channel:remove", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const channels = (await getChannels()).map((c) => c.username);
    const { text, keyboard } = getRemoveChannelPrompt(channels);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery(/^channel:confirmremove:(.+)$/, async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
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
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const channelUsername = ctx.callbackQuery?.data?.split(":")[2] || "";
    await removeChannel(channelUsername);
    const { text, keyboard } = getChannelsMenu();
    await safeReply(ctx, `✅ ${channelUsername} removed.\n\n${text}`, keyboard);
  });

  bot.callbackQuery("channel:list", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
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
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const { text, keyboard } = getSetTargetPrompt();
    await safeReply(ctx, text, keyboard);
    await setPendingInput(ctx.from!.id, "addtarget");
  });

  bot.callbackQuery("setting:toggle:english", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const cfg = await getConfig();
    await updateConfig({ showEnglish: !cfg.showEnglish });
    const updated = await getConfig();
    const { text, keyboard } = getSettingsMenu(updated.showEnglish, updated.showOriginal, updated.signature, updated.reelsMode);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("setting:toggle:original", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const cfg = await getConfig();
    await updateConfig({ showOriginal: !cfg.showOriginal });
    const updated = await getConfig();
    const { text, keyboard } = getSettingsMenu(updated.showEnglish, updated.showOriginal, updated.signature, updated.reelsMode);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("setting:toggle:reels", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
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
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const cfg = await getConfig();
    const { text, keyboard } = getSetSignaturePrompt(cfg.signature);
    await safeReply(ctx, text, keyboard);
    await setPendingInput(ctx.from!.id, "setsignature");
  });

  bot.callbackQuery("setting:language", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const { text, keyboard } = getSetLanguagePrompt();
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery(/^setting:setlang:(.+)$/, async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
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

  bot.on("message:text", async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) return;

    const text = (ctx.message?.text || "").trim();
    if (!text) return;

    const state = await getPendingInput(userId);

    // No pending flow: a bare @username (or https://t.me/...) adds a source channel
    if (!state) {
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
      await clearPendingInput(userId);
      const { text: menuText, keyboard } = getMainMenu();
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

    if (state.startsWith("reel_patch_old:")) {
      const enc = state.slice("reel_patch_old:".length);
      await setPendingInput(userId, `reel_patch_new:${enc}`, text);
      await ctx.reply("🩹 Found the OLD text. Now send the NEW replacement text:");
      return;
    }

    if (state.startsWith("reel_patch_new:")) {
      const enc = state.slice("reel_patch_new:".length);
      const oldText = (await getPendingFull(userId))?.data || "";
      const id = decodeReelId(enc);
      const reel = await getReelById(id);
      if (!reel) {
        await clearPendingInput(userId);
        await ctx.reply("❌ Reel not found anymore.");
        return;
      }
      const activeIsOriginal = reel.mode === "original";
      const current = activeIsOriginal ? reel.originalText : reel.translatedText;
      const patched = patchText(current, oldText, text);
      if (patched === null) {
        await setPendingInput(userId, `reel_patch_old:${enc}`);
        await ctx.reply("❌ OLD text not found in the post. Send the exact text to match again:");
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

    switch (state) {
      case "addsource": {
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
        await updateConfig({ signature: text });
        await clearPendingInput(userId);
        const cfg = await getConfig();
        const { text: menuText, keyboard } = getSettingsMenu(cfg.showEnglish, cfg.showOriginal, cfg.signature, cfg.reelsMode);
        await ctx.reply(`✅ Signature updated.\n\n${menuText}`, { reply_markup: keyboard });
        break;
      }
    }
  });

  // Capture media/files sent by the admin while in "Add Media" reel state
  bot.on("message", async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) return;
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
