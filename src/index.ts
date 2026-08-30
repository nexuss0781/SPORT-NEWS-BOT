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
import { processAndPublish, MediaPayload } from "./services/publisher";
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

  const replied = message.reply_to_message;
  const repliedMessageId = replied.message_id;
  const chatId = message.chat.id;
  const cfg = await getConfig();

  // Find the original post by target message ID (in this chat)
  const post = await getProcessedPostByTargetMessage(chatId, repliedMessageId);

  if (!post) {
    ctx.reply("❌ Could not find the original post. It may have been processed before this feature was added.");
    return;
  }

  const sig = cfg.signature ? `\n\n—\n${cfg.signature}` : "";
  let content: string;

  if (mode === "english") {
    if (post.sourceLang === "en") {
      content = [
        "🇬🇧 Original:",
        post.originalText,
        "",
        "🇪🇹 Translation:",
        post.translatedText,
      ].join("\n") + sig;
    } else {
      content = [
        "🇬🇧 English:",
        post.englishText || post.originalText,
        "",
        "📢 Amharic:",
        post.translatedText,
      ].join("\n") + sig;
    }
  } else {
    content = [
      `📝 Original (${(post.sourceLang || "?").toUpperCase()}):`,
      post.originalText,
      "",
      "🇪🇹 Translation:",
      post.translatedText,
    ].join("\n") + sig;
  }

  const hasMedia =
    Boolean((replied as any).photo) ||
    Boolean((replied as any).video) ||
    Boolean((replied as any).animation) ||
    Boolean((replied as any).document) ||
    Boolean((replied as any).audio) ||
    Boolean((replied as any).voice);

  try {
    if (hasMedia) {
      await ctx.api.editMessageCaption(chatId, repliedMessageId, { caption: content });
    } else {
      await ctx.api.editMessageText(chatId, repliedMessageId, content);
    }
  } catch (e) {
    await ctx.reply(content);
  }
}

async function handleChannelPost(ctx: Context, isEdited = false): Promise<void> {
  const message = ctx.channelPost || ctx.editedChannelPost;
  if (!message) return;

  const chat = message.chat;
  const channelId = `@${chat.username || chat.id}`;
  const messageId = message.message_id;

  // Check if channel is monitored
  const monitoredChannels = await getChannels();
  const isMonitored = monitoredChannels.some(
    (c) => c.username.toLowerCase() === channelId.toLowerCase()
  );

  if (!isMonitored) return;

  // Check if already processed
  if (await isProcessed(channelId, messageId)) return;

  // Extract text content
  let text = "";
  if ("text" in message && message.text) {
    text = message.text;
  } else if ("caption" in message && message.caption) {
    text = message.caption;
  }

  if (!text || text.trim().length === 0) {
    if (!isMediaMessage(message)) return;
  }

  try {
    const media = extractMedia(message);
    await processAndPublish(ctx.api, channelId, messageId, text.trim(), media);
  } catch (error) {
    console.error(`Error processing post from ${channelId}:`, error);
  }
}

function isMediaMessage(message: any): boolean {
  return Boolean(
    message?.photo ||
    message?.video ||
    message?.animation ||
    message?.document ||
    message?.audio ||
    message?.voice
  );
}

function extractMedia(message: any): MediaPayload | undefined {
  if (message?.photo && message.photo.length) {
    const best = message.photo[message.photo.length - 1];
    return { kind: "photo", value: best.file_id, width: best.width, height: best.height };
  }
  if (message?.video) {
    return {
      kind: "video",
      value: message.video.file_id,
      fileName: message.video.file_name,
      mimeType: message.video.mime_type,
      duration: message.video.duration,
      width: message.video.width,
      height: message.video.height,
    };
  }
  if (message?.animation) {
    return {
      kind: "animation",
      value: message.animation.file_id,
      fileName: message.animation.file_name,
      mimeType: message.animation.mime_type,
      duration: message.animation.duration,
      width: message.animation.width,
      height: message.animation.height,
    };
  }
  if (message?.audio) {
    return {
      kind: "audio",
      value: message.audio.file_id,
      fileName: message.audio.file_name,
      mimeType: message.audio.mime_type,
      duration: message.audio.duration,
    };
  }
  if (message?.document) {
    return {
      kind: "document",
      value: message.document.file_id,
      fileName: message.document.file_name,
      mimeType: message.document.mime_type,
    };
  }
  return undefined;
}
