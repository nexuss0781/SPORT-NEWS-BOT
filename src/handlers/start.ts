import { Context } from "grammy";

export function registerStartCommands(bot: any): void {
  bot.start(async (ctx: Context) => {
    const welcome = [
      "👋 Welcome to Sport News Amharic Bot!",
      "",
      "This bot monitors Telegram channels and translates their posts to Amharic.",
      "",
      "📌 For admins:",
      "/addchannel @channel - Add channel to monitor",
      "/removechannel @channel - Remove channel",
      "/listchannels - List monitored channels",
      "/settarget @channel - Set output channel",
      "/setsignature text - Set footer signature",
      "/status - Bot status",
      "",
      "ℹ️ /help - Show this message",
    ].join("\n");

    ctx.reply(welcome);
  });

  bot.help(async (ctx: Context) => {
    const help = [
      "📖 Available Commands",
      "",
      "🔹 General:",
      "/start - Welcome message",
      "/help - This help message",
      "",
      "🔹 Admin Commands:",
      "/addchannel @channel - Add channel to monitor",
      "/removechannel @channel - Remove channel",
      "/listchannels - List monitored channels",
      "/settarget @channel - Set output channel",
      "/setsignature text - Set footer signature",
      "/getsignature - View current signature",
      "/status - Bot status & config",
    ].join("\n");

    ctx.reply(help);
  });
}
