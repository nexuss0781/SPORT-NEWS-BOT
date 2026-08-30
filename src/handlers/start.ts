import { Context, InlineKeyboard } from "grammy";
import { getMainMenu } from "../menus/index";

export function registerStartCommands(bot: any): void {
  bot.start(async (ctx: Context) => {
    const { text, keyboard } = getMainMenu();
    const welcome = [
      "╔══════════════════════════╗",
      "║   🤖 SPORT NEWS BOT      ║",
      "║   Amharic Translation    ║",
      "╚══════════════════════════╝",
      "",
      "Welcome! I monitor Telegram channels",
      "and translate posts to Amharic.",
      "",
      "Use the menu below to get started:",
    ].join("\n");

    await ctx.reply(welcome, { reply_markup: keyboard });
  });

  bot.command("help", async (ctx: Context) => {
    const { text, keyboard } = getMainMenu();
    const help = [
      "╔══════════════════════════╗",
      "║   ❓ HELP & COMMANDS     ║",
      "╚══════════════════════════╝",
      "",
      "🔹 Channel Commands:",
      "   /english - Show EN + AM",
      "   /original - Show Original",
      "",
      "🔹 Admin Commands:",
      "   /addchannel @channel",
      "   /removechannel @channel",
      "   /listchannels",
      "   /settarget @channel",
      "   /setsignature text",
      "   /toggleenglish",
      "   /toggleoriginal",
      "   /status",
      "   /menu - Open menu",
    ].join("\n");

    await ctx.reply(help, { reply_markup: keyboard });
  });
}
