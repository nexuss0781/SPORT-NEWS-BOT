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
  // Add channel to monitor
  bot.command("addchannel", adminOnly, async (ctx: Context) => {
    const args = ctx.message?.text?.split(" ").slice(1);
    if (!args || args.length === 0) {
      ctx.reply("Usage: /addchannel @channel_username");
      return;
    }

    let username = args[0];
    if (!username.startsWith("@")) {
      username = `@${username}`;
    }

    const channel: Channel = {
      id: username,
      username,
      addedAt: new Date().toISOString(),
      addedBy: ctx.from!.id,
    };

    const channels = addChannel(channel);
    ctx.reply(`✅ Channel ${username} added.\n\nTotal monitored: ${channels.length}`);
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

  // Set target channel
  bot.command("settarget", adminOnly, async (ctx: Context) => {
    const args = ctx.message?.text?.split(" ").slice(1);
    if (!args || args.length === 0) {
      ctx.reply("Usage: /settarget @your_channel");
      return;
    }

    let username = args[0];
    if (!username.startsWith("@")) {
      username = `@${username}`;
    }

    updateConfig({ targetChannel: username });
    ctx.reply(`✅ Target channel set to ${username}`);
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

  // Status
  bot.command("status", adminOnly, async (ctx: Context) => {
    const cfg = getConfig();
    const channels = getChannels();

    const status = [
      "🤖 Bot Status",
      "",
      `📺 Monitored Channels: ${channels.length}`,
      `🎯 Target Channel: ${cfg.targetChannel || "Not set"}`,
      `✍️ Signature: ${cfg.signature || "Not set"}`,
      `🌐 Translation Lang: ${cfg.translatedLang}`,
      "",
      "Commands:",
      "/addchannel @channel - Add channel",
      "/removechannel @channel - Remove channel",
      "/listchannels - List channels",
      "/settarget @channel - Set output channel",
      "/setsignature text - Set footer",
    ].join("\n");

    ctx.reply(status);
  });
}
