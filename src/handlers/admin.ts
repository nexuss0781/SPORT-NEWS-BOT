import { Context } from "grammy";
import { isAdmin } from "../config";
import {
  getChannels,
  addChannel,
  removeChannel,
  getConfig,
  updateConfig,
} from "../services/storage";
import { Channel } from "../types";

export function adminOnly(ctx: Context, next: () => Promise<void>): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) {
    ctx.reply("⛔ You are not authorized to use this command.");
    return Promise.resolve();
  }
  return next();
}

export function registerAdminCommands(bot: any): void {
  // Add channel(s) to monitor (multiple separated by comma or space)
  bot.command("addchannel", adminOnly, async (ctx: Context) => {
    const args = ctx.message?.text?.split(" ").slice(1);
    if (!args || args.length === 0) {
      ctx.reply("Usage: /addchannel @ch1 @ch2 @ch3\n\nMultiple separated by comma or space.");
      return;
    }

    const raw = args.join(" ");
    const usernames = raw
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter(Boolean)
      .map((u) => (u.startsWith("@") ? u : `@${u}`));

    let added = 0;
    for (const username of usernames) {
      const exists = getChannels().some(
        (c) => c.username.toLowerCase() === username.toLowerCase()
      );
      if (exists) continue;
      const channel: Channel = {
        id: username,
        username,
        addedAt: new Date().toISOString(),
        addedBy: ctx.from!.id,
      };
      addChannel(channel);
      added++;
    }

    const channels = getChannels();
    ctx.reply(`✅ Added ${added} source channel(s).\n\nTotal monitored: ${channels.length}`);
  });

  // Remove channel
  bot.command("removechannel", adminOnly, async (ctx: Context) => {
    const args = ctx.message?.text?.split(" ").slice(1);
    if (!args || args.length === 0) {
      ctx.reply("Usage: /removechannel @channel_username");
      return;
    }

    let username = args[0];
    if (!username.startsWith("@")) {
      username = `@${username}`;
    }

    const channels = removeChannel(username);
    ctx.reply(`✅ Channel ${username} removed.\n\nTotal monitored: ${channels.length}`);
  });

  // List channels
  bot.command("listchannels", adminOnly, async (ctx: Context) => {
    const channels = getChannels();
    if (channels.length === 0) {
      ctx.reply("No channels being monitored.\n\nUse /addchannel @channel to add one.");
      return;
    }

    const list = channels
      .map((c, i) => `${i + 1}. ${c.username} (added ${new Date(c.addedAt).toLocaleDateString()})`)
      .join("\n");
    ctx.reply(`📺 Monitored Channels (${channels.length}):\n\n${list}`);
  });

  // Set target channel(s) (multiple separated by comma or space, replaces list)
  bot.command("settarget", adminOnly, async (ctx: Context) => {
    const args = ctx.message?.text?.split(" ").slice(1);
    if (!args || args.length === 0) {
      ctx.reply("Usage: /settarget @ch1 @ch2\n\nMultiple separated by comma or space. Replaces current targets.");
      return;
    }

    const raw = args.join(" ");
    const usernames = raw
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter(Boolean)
      .map((u) => (u.startsWith("@") ? u : `@${u}`));

    const unique = [...new Set(usernames)];
    updateConfig({ targetChannels: unique, targetChannel: unique[0] });
    ctx.reply(`✅ Target channel(s) set:\n\n${unique.join("\n")}\n\nTotal: ${unique.length}`);
  });

  // Set signature
  bot.command("setsignature", adminOnly, async (ctx: Context) => {
    const args = ctx.message?.text?.split(" ").slice(1);
    if (!args || args.length === 0) {
      ctx.reply("Usage: /setsignature Your signature text here\n\nExample: /setsignature Share @mychannel on every post footer");
      return;
    }

    const signature = args.join(" ");
    updateConfig({ signature });
    ctx.reply(`✅ Signature set to:\n\n${signature}`);
  });

  // Get signature
  bot.command("getsignature", adminOnly, async (ctx: Context) => {
    const cfg = getConfig();
    if (cfg.signature) {
      ctx.reply(`Current signature:\n\n${cfg.signature}`);
    } else {
      ctx.reply("No signature set.\n\nUse /setsignature to add one.");
    }
  });

  // Toggle English display
  bot.command("toggleenglish", adminOnly, async (ctx: Context) => {
    const cfg = getConfig();
    const newValue = !cfg.showEnglish;
    updateConfig({ showEnglish: newValue });
    ctx.reply(`✅ English display ${newValue ? "ON" : "OFF"}\n\nWhen ON: English translation shown above Amharic for non-English posts.`);
  });

  // Toggle Original display
  bot.command("toggleoriginal", adminOnly, async (ctx: Context) => {
    const cfg = getConfig();
    const newValue = !cfg.showOriginal;
    updateConfig({ showOriginal: newValue });
    ctx.reply(`✅ Original text display ${newValue ? "ON" : "OFF"}\n\nWhen ON: Shows "Original: English" + "Translation: Amharic" format for English source posts.`);
  });

  // Status
  bot.command("status", adminOnly, async (ctx: Context) => {
    const cfg = getConfig();
    const channels = getChannels();

    const status = [
      "🤖 Bot Status",
      "",
      `📥 Source Channels: ${channels.length}`,
      `📤 Target Channels: ${cfg.targetChannels.length ? cfg.targetChannels.join(", ") : "Not set"}`,
      `✍️ Signature: ${cfg.signature || "Not set"}`,
      `🌐 Translation Lang: ${cfg.translatedLang}`,
      `🇬🇧 Show English: ${cfg.showEnglish ? "ON" : "OFF"}`,
      `📝 Show Original: ${cfg.showOriginal ? "ON" : "OFF"}`,
      "",
      "Channel Commands:",
      "/english - Show English + Amharic (reply to post)",
      "/original - Show Original + Translation (reply to post)",
      "",
      "Admin Commands:",
      "/addchannel @channel - Add channel",
      "/removechannel @channel - Remove channel",
      "/listchannels - List channels",
      "/settarget @channel - Set output channel",
      "/setsignature text - Set footer",
      "/toggleenglish - Toggle English display",
      "/toggleoriginal - Toggle Original display",
    ].join("\n");

    ctx.reply(status);
  });
}
