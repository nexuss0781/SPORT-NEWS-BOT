import { Bot, Context } from "grammy";
import { registerAdminCommands } from "./handlers/admin";
import { registerStartCommands } from "./handlers/start";
import { registerCallbacks } from "./handlers/callbacks";
import { config } from "./config";
import {
  getChannels,
  getConfig,
  isProcessed,
  getProcessedPostByTargetMessage,
} from "./services/storage";
import { processAndPublish } from "./services/publisher";
import { getMainMenu } from "./menus/index";

export function createBot(): Bot {
  const bot = new Bot(config.botToken, {
    botInfo: {
      id: 8830869191,
      is_bot: true,
      first_name: "SPORT NEWS ⚽️",
      username: "ethioutdbot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    },
  });

  // Register command handlers
  registerStartCommands(bot);
  registerAdminCommands(bot);

  // Register callback handlers for inline keyboards
  registerCallbacks(bot);

  // Handle channel posts (new messages)
  bot.on("channel_post", async (ctx) => {
    await handleChannelPost(ctx);
  });

  // Handle edited channel posts
  bot.on("edited_channel_post", async (ctx) => {
    await handleChannelPost(ctx, true);
  });

  // Handle /english and /original commands in target channel (reply to a translated post)
  bot.command("english", async (ctx) => {
    await handleOriginalCommand(ctx, "english");
  });

  bot.command("original", async (ctx) => {
    await handleOriginalCommand(ctx, "original");
  });

  // Handle /menu command to show interactive menu
  bot.command("menu", async (ctx) => {
    const { text, keyboard } = getMainMenu();
    await ctx.reply(text, { reply_markup: keyboard });
  });

  // Handle /cancel to clear state
  bot.command("cancel", async (ctx) => {
    await ctx.reply("Action cancelled. Use /menu to open the menu.");
  });

  return bot;
}

async function handleOriginalCommand(ctx: Context, mode: "english" | "original"): Promise<void> {
  const message = ctx.message;
  if (!message) return;

  // Must be a reply to a message
  if (!message.reply_to_message) {
    ctx.reply(`Reply to a translated post with /${mode} to see the original text.`);
    return;
  }

  const repliedMessageId = message.reply_to_message.message_id;
  const cfg = getConfig();

  // Find the original post by target message ID
  const post = getProcessedPostByTargetMessage(repliedMessageId);

  if (!post) {
    ctx.reply("❌ Could not find the original post. It may have been processed before this feature was added.");
    return;
  }

  // Check if the source language is English
  const isEnglishSource = post.sourceLang === "en";

  let response: string;

  if (mode === "english") {
    if (isEnglishSource) {
      // Source is English - show Original: English, Translation: Amharic
      response = [
        "🇬🇧 Original:",
        post.originalText,
        "",
        "🇪🇹 Translation:",
        post.translatedText,
      ].join("\n");
    } else {
      // Source is not English - show English translation and Amharic
      if (!post.englishText) {
        ctx.reply("❌ English translation not available for this post.");
        return;
      }
      response = [
        "🇬🇧 English:",
        post.englishText,
        "",
        "🇪🇹 Amharic:",
        post.translatedText,
      ].join("\n");
    }
  } else {
    // /original - always show original source
    response = [
      `📝 Original (${post.sourceLang.toUpperCase()}):`,
      post.originalText,
      "",
      "🇪🇹 Translation:",
      post.translatedText,
    ].join("\n");
  }

  ctx.reply(response);
}

async function handleChannelPost(ctx: Context, isEdited = false): Promise<void> {
  const message = ctx.channelPost || ctx.editedChannelPost;
  if (!message) return;

  const chat = message.chat;
  const channelId = `@${chat.username || chat.id}`;
  const messageId = message.message_id;

  // Check if channel is monitored
  const monitoredChannels = getChannels();
  const isMonitored = monitoredChannels.some(
    (c) => c.username.toLowerCase() === channelId.toLowerCase()
  );

  if (!isMonitored) return;

  // Check if already processed
  if (isProcessed(channelId, messageId)) return;

  // Extract text content
  let text = "";
  if ("text" in message && message.text) {
    text = message.text;
  } else if ("caption" in message && message.caption) {
    text = message.caption;
  }

  if (!text || text.trim().length === 0) return;

  try {
    await processAndPublish(ctx.api, channelId, messageId, text.trim());
  } catch (error) {
    console.error(`Error processing post from ${channelId}:`, error);
  }
}
