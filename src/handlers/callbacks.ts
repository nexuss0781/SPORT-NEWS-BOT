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
    const cfg = await getConfig();
    const { text, keyboard } = getSettingsMenu(cfg.showEnglish, cfg.showOriginal);
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
    await setPendingInput(ctx.from!.id, "settarget");
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
    const { text, keyboard } = getSettingsMenu(updated.showEnglish, updated.showOriginal);
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

    const state = await getPendingInput(userId);

    // No pending flow: a bare @username is treated as adding a source channel
    if (!state) {
      const match = text.match(/^@[A-Za-z0-9_]{3,}$/);
      if (match) {
        const username = match[0];
        const added = await addSourceChannel(username, userId);
        if (added) {
          const channels = await getChannels();
          await ctx.reply(`✅ ${username} added as source channel.\n\nTotal sources: ${channels.length}\n\nTap 📥 Source Channels to add more, or 📤 Target Channels to set the output.`);
        } else {
          await ctx.reply(`ℹ️ ${username} is already a source channel.`);
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
      case "addtarget": {
        const usernames = parseChannels(text);
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
        const { text: menuText, keyboard } = getSettingsMenu(cfg.showEnglish, cfg.showOriginal);
        await ctx.reply(`✅ Signature set.\n\n${menuText}`, { reply_markup: keyboard });
        break;
      }
    }
  });
}
