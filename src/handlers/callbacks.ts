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
} from "../services/storage";
import { Channel } from "../types";
import { isAdmin } from "../config";

const awaitingInput = new Map<number, string>();

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
      target: cfg.targetChannel,
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
    awaitingInput.set(ctx.from!.id, "addchannel");
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
    awaitingInput.set(ctx.from!.id, "settarget");
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
    awaitingInput.set(ctx.from!.id, "setsignature");
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
    if (!userId) return;

    const state = awaitingInput.get(userId);
    if (!state) return;

    const text = ctx.message?.text;
    if (!text) return;

    if (text === "/cancel") {
      awaitingInput.delete(userId);
      const { text: menuText, keyboard } = getMainMenu();
      await ctx.reply(menuText, { reply_markup: keyboard });
      return;
    }

    switch (state) {
      case "addchannel": {
        let username = text.trim();
        if (!username.startsWith("@")) username = `@${username}`;
        const channel: Channel = {
          id: username,
          username,
          addedAt: new Date().toISOString(),
          addedBy: userId,
        };
        addChannel(channel);
        const channels = getChannels();
        awaitingInput.delete(userId);
        const { text: menuText, keyboard } = getChannelsMenu();
        await ctx.reply(`✅ ${username} added.\n\nTotal: ${channels.length} channels.\n\n${menuText}`, { reply_markup: keyboard });
        break;
      }
      case "settarget": {
        let username = text.trim();
        if (!username.startsWith("@")) username = `@${username}`;
        updateConfig({ targetChannel: username });
        awaitingInput.delete(userId);
        const { text: menuText, keyboard } = getChannelsMenu();
        await ctx.reply(`✅ Target set to ${username}.\n\n${menuText}`, { reply_markup: keyboard });
        break;
      }
      case "setsignature": {
        updateConfig({ signature: text });
        awaitingInput.delete(userId);
        const cfg = getConfig();
        const { text: menuText, keyboard } = getSettingsMenu(cfg.showEnglish, cfg.showOriginal);
        await ctx.reply(`✅ Signature set.\n\n${menuText}`, { reply_markup: keyboard });
        break;
      }
    }
  });
}
