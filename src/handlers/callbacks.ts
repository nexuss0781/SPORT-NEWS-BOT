import { Context } from "grammy";
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
} from "../menus/index";
import {
  getChannels,
  addChannel,
  removeChannel,
  getConfig,
  updateConfig,
  getPendingInput,
  setPendingInput,
  clearPendingInput,
} from "../services/storage";
import { isAdmin } from "../config";

function addSourceChannel(username: string, addedBy: number): boolean {
  const channels = getChannels();
  const exists = channels.some(
    (c) => c.username.toLowerCase() === username.toLowerCase()
  );
  if (exists) return false;
  addChannel({
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
    .map((c) => (c.startsWith("@") ? c : `@${c}`));
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
    const cfg = getConfig();
    const { text, keyboard } = getSettingsMenu(cfg.showEnglish, cfg.showOriginal);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("menu:status", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const cfg = getConfig();
    const channels = getChannels();
    const { text, keyboard } = getStatusMenu({
      channels: channels.length,
      target: cfg.targetChannels,
      signature: cfg.signature,
      showEnglish: cfg.showEnglish,
      showOriginal: cfg.showOriginal,
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

  bot.callbackQuery("channel:add", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const { text, keyboard } = getAddChannelPrompt();
    await safeReply(ctx, text, keyboard);
    setPendingInput(ctx.from!.id, "addsource");
  });

  bot.callbackQuery("channel:remove", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const channels = getChannels().map((c) => c.username);
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
    removeChannel(channelUsername);
    const { text, keyboard } = getChannelsMenu();
    await safeReply(ctx, `✅ ${channelUsername} removed.\n\n${text}`, keyboard);
  });

  bot.callbackQuery("channel:list", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const channels = getChannels();
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
    setPendingInput(ctx.from!.id, "settarget");
  });

  bot.callbackQuery("setting:toggle:english", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const cfg = getConfig();
    updateConfig({ showEnglish: !cfg.showEnglish });
    const updated = getConfig();
    const { text, keyboard } = getSettingsMenu(updated.showEnglish, updated.showOriginal);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("setting:toggle:original", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const cfg = getConfig();
    updateConfig({ showOriginal: !cfg.showOriginal });
    const updated = getConfig();
    const { text, keyboard } = getSettingsMenu(updated.showEnglish, updated.showOriginal);
    await safeReply(ctx, text, keyboard);
  });

  bot.callbackQuery("setting:signature", async (ctx: Context) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ You are not authorized.");
      return;
    }
    const { text, keyboard } = getSetSignaturePrompt();
    await safeReply(ctx, text, keyboard);
    setPendingInput(ctx.from!.id, "setsignature");
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
    updateConfig({ translatedLang: lang });
    const cfg = getConfig();
    const { text, keyboard } = getSettingsMenu(cfg.showEnglish, cfg.showOriginal);
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

    const state = getPendingInput(userId);

    // No pending flow: a bare @username is treated as adding a source channel
    if (!state) {
      const match = text.match(/^@[A-Za-z0-9_]{3,}$/);
      if (match) {
        const username = match[0];
        const added = addSourceChannel(username, userId);
        if (added) {
          const channels = getChannels();
          await ctx.reply(`✅ ${username} added as source channel.\n\nTotal sources: ${channels.length}\n\nTap 📥 Source Channels to add more, or 📤 Target Channels to set the output.`);
        } else {
          await ctx.reply(`ℹ️ ${username} is already a source channel.`);
        }
      }
      return;
    }

    if (text === "/cancel") {
      clearPendingInput(userId);
      const { text: menuText, keyboard } = getMainMenu();
      await ctx.reply(menuText, { reply_markup: keyboard });
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
          if (addSourceChannel(username, userId)) {
            added++;
          } else {
            skipped.push(username);
          }
        }
        clearPendingInput(userId);
        const { text: menuText, keyboard } = getChannelsMenu();
        const lines = [`✅ Added: ${added}`, `Total sources: ${getChannels().length}`];
        if (skipped.length > 0) lines.push(`Already present: ${skipped.join(", ")}`);
        lines.push("", menuText);
        await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
        break;
      }
      case "addtarget": {
        const usernames = parseChannels(text);
        if (usernames.length === 0) {
          await ctx.reply("⚠️ No valid channels found. Send usernames like: @sport_news, @sport_news2");
          return;
        }
        const unique = [...new Set(usernames)];
        updateConfig({ targetChannels: unique, targetChannel: unique[0] });
        clearPendingInput(userId);
        const { text: menuText, keyboard } = getChannelsMenu();
        await ctx.reply(`✅ Target channels set:\n\n${unique.join("\n")}\n\nTotal: ${unique.length}\n\n${menuText}`, { reply_markup: keyboard });
        break;
      }
      case "setsignature": {
        updateConfig({ signature: text });
        clearPendingInput(userId);
        const cfg = getConfig();
        const { text: menuText, keyboard } = getSettingsMenu(cfg.showEnglish, cfg.showOriginal);
        await ctx.reply(`✅ Signature set.\n\n${menuText}`, { reply_markup: keyboard });
        break;
      }
    }
  });
}
