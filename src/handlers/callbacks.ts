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

// Store user state for awaiting input
const awaitingInput = new Map<number, string>();

export function registerCallbacks(bot: any): void {
  // Main menu callback
  bot.callbackQuery("menu:main", async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const { text, keyboard } = getMainMenu();
    await ctx.editMessageText(text, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  });

  // Channels menu
  bot.callbackQuery("menu:channels", async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const { text, keyboard } = getChannelsMenu();
    await ctx.editMessageText(text, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  });

  // Settings menu
  bot.callbackQuery("menu:settings", async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const cfg = getConfig();
    const { text, keyboard } = getSettingsMenu(cfg.showEnglish, cfg.showOriginal);
    await ctx.editMessageText(text, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  });

  // Status menu
  bot.callbackQuery("menu:status", async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const cfg = getConfig();
    const channels = getChannels();
    const { text, keyboard } = getStatusMenu({
      channels: channels.length,
      target: cfg.targetChannel,
      signature: cfg.signature,
      showEnglish: cfg.showEnglish,
      showOriginal: cfg.showOriginal,
    });
    await ctx.editMessageText(text, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  });

  // Help menu
  bot.callbackQuery("menu:help", async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const { text, keyboard } = getHelpMenu();
    await ctx.editMessageText(text, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  });

  // Add channel prompt
  bot.callbackQuery("channel:add", async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const { text, keyboard } = getAddChannelPrompt();
    await ctx.editMessageText(text, { reply_markup: keyboard });
    awaitingInput.set(ctx.from!.id, "addchannel");
    await ctx.answerCallbackQuery();
  });

  // Remove channel prompt
  bot.callbackQuery("channel:remove", async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const channels = getChannels().map((c) => c.username);
    const { text, keyboard } = getRemoveChannelPrompt(channels);
    await ctx.editMessageText(text, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  });

  // Confirm remove channel
  bot.callbackQuery(/^channel:confirmremove:(.+)$/, async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const channelUsername = (ctx.callbackQuery as any).data.split(":")[2];
    const { text, keyboard } = getConfirmDialog(
      `Remove ${channelUsername} from monitored channels?`,
      `channel:doremove:${channelUsername}`,
      "menu:channels"
    );
    await ctx.editMessageText(text, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  });

  // Do remove channel
  bot.callbackQuery(/^channel:doremove:(.+)$/, async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const channelUsername = (ctx.callbackQuery as any).data.split(":")[2];
    removeChannel(channelUsername);
    const { text, keyboard } = getChannelsMenu();
    await ctx.editMessageText(
      `✅ ${channelUsername} removed.\n\n${text}`,
      { reply_markup: keyboard }
    );
    await ctx.answerCallbackQuery();
  });

  // List channels
  bot.callbackQuery("channel:list", async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
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
      const list = channels
        .map((c, i) => `${i + 1}. ${c.username}`)
        .join("\n");
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
    const keyboard = new (await import("grammy")).InlineKeyboard()
      .text("◀️ Back", "menu:channels");
    await ctx.editMessageText(text, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  });

  // Set target prompt
  bot.callbackQuery("channel:target", async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const { text, keyboard } = getSetTargetPrompt();
    await ctx.editMessageText(text, { reply_markup: keyboard });
    awaitingInput.set(ctx.from!.id, "settarget");
    await ctx.answerCallbackQuery();
  });

  // Toggle English
  bot.callbackQuery("setting:toggle:english", async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const cfg = getConfig();
    updateConfig({ showEnglish: !cfg.showEnglish });
    const updated = getConfig();
    const { text, keyboard } = getSettingsMenu(updated.showEnglish, updated.showOriginal);
    await ctx.editMessageText(text, { reply_markup: keyboard });
    await ctx.answerCallbackQuery({
      text: `English display ${updated.showEnglish ? "ON" : "OFF"}`,
    });
  });

  // Toggle Original
  bot.callbackQuery("setting:toggle:original", async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const cfg = getConfig();
    updateConfig({ showOriginal: !cfg.showOriginal });
    const updated = getConfig();
    const { text, keyboard } = getSettingsMenu(updated.showEnglish, updated.showOriginal);
    await ctx.editMessageText(text, { reply_markup: keyboard });
    await ctx.answerCallbackQuery({
      text: `Original display ${updated.showOriginal ? "ON" : "OFF"}`,
    });
  });

  // Set signature prompt
  bot.callbackQuery("setting:signature", async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const { text, keyboard } = getSetSignaturePrompt();
    await ctx.editMessageText(text, { reply_markup: keyboard });
    awaitingInput.set(ctx.from!.id, "setsignature");
    await ctx.answerCallbackQuery();
  });

  // Set language prompt
  bot.callbackQuery("setting:language", async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const { text, keyboard } = getSetLanguagePrompt();
    await ctx.editMessageText(text, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  });

  // Set language action
  bot.callbackQuery(/^setting:setlang:(.+)$/, async (ctx: Context) => {
    if (!await checkAdmin(ctx)) return;
    const lang = (ctx.callbackQuery as any).data.split(":")[2];
    updateConfig({ translatedLang: lang });
    const cfg = getConfig();
    const { text, keyboard } = getSettingsMenu(cfg.showEnglish, cfg.showOriginal);
    const langNames: Record<string, string> = {
      am: "Amharic",
      ar: "Arabic",
      fr: "French",
      es: "Spanish",
      de: "German",
      pt: "Portuguese",
    };
    await ctx.editMessageText(
      `✅ Language set to ${langNames[lang] || lang}.\n\n${text}`,
      { reply_markup: keyboard }
    );
    await ctx.answerCallbackQuery();
  });

  // Handle text input for awaiting states
  bot.on("message:text", async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const state = awaitingInput.get(userId);
    if (!state) return;

    const text = ctx.message?.text;
    if (!text) return;

    // Handle /cancel
    if (text === "/cancel") {
      awaitingInput.delete(userId);
      const { text: menuText, keyboard } = getMainMenu();
      await ctx.reply(menuText, { reply_markup: keyboard });
      return;
    }

    switch (state) {
      case "addchannel": {
        let username = text.trim();
        if (!username.startsWith("@")) {
          username = `@${username}`;
        }
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
        await ctx.reply(
          `✅ ${username} added.\n\nTotal: ${channels.length} channels.\n\n${menuText}`,
          { reply_markup: keyboard }
        );
        break;
      }
      case "settarget": {
        let username = text.trim();
        if (!username.startsWith("@")) {
          username = `@${username}`;
        }
        updateConfig({ targetChannel: username });
        awaitingInput.delete(userId);
        const { text: menuText, keyboard } = getChannelsMenu();
        await ctx.reply(
          `✅ Target set to ${username}.\n\n${menuText}`,
          { reply_markup: keyboard }
        );
        break;
      }
      case "setsignature": {
        updateConfig({ signature: text });
        awaitingInput.delete(userId);
        const cfg = getConfig();
        const { text: menuText, keyboard } = getSettingsMenu(cfg.showEnglish, cfg.showOriginal);
        await ctx.reply(
          `✅ Signature set.\n\n${menuText}`,
          { reply_markup: keyboard }
        );
        break;
      }
    }
  });
}

async function checkAdmin(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) {
    await ctx.answerCallbackQuery({ text: "⛔ Unauthorized", show_alert: true });
    return false;
  }
  return true;
}
