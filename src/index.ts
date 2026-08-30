import { Bot, Context } from "grammy";
import { registerAdminCommands } from "./handlers/admin";
import { registerStartCommands } from "./handlers/start";
import { config } from "./config";
import {
  getChannels,
  getConfig,
  isProcessed,
  markAsProcessed,
  getProcessedPostByTargetMessage,
} from "./services/storage";
import { translateToAmharic } from "./services/translator";

export function createBot(): Bot {
  const bot = new Bot(config.botToken);

  // Register command handlers
  registerStartCommands(bot);
  registerAdminCommands(bot);

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

  // Get config
  const cfg = getConfig();
  if (!cfg.targetChannel) return;

  // Extract text content
  let text = "";
  if ("text" in message && message.text) {
    text = message.text;
  } else if ("caption" in message && message.caption) {
    text = message.caption;
  }

  if (!text || text.trim().length === 0) return;

  try {
    // Translate to Amharic (and get English if needed)
    const { amharic, english, sourceLang } = await translateToAmharic(text);

    // Format post
    let postContent = "";

    // If showEnglish is on, show English above Amharic
    if (cfg.showEnglish && sourceLang !== "en") {
      postContent += `🇬🇧 English:\n${english}\n\n`;
    }

    // If source is English and showOriginal is on, show original format
    if (sourceLang === "en" && cfg.showOriginal) {
      postContent += `📝 Original:\n${text}\n\n🇪🇹 Translation:\n${amharic}`;
    } else {
      postContent += `📢 ${amharic}`;
    }

    // Add signature
    if (cfg.signature) {
      postContent += `\n\n—\n${cfg.signature}`;
    }

    // Send to target channel
    const targetChannel = cfg.targetChannel;
    let sentMessage;
    if (targetChannel) {
      sentMessage = await ctx.api.sendMessage(targetChannel, postContent);
    }

    // Mark as processed with original and translated text
    markAsProcessed({
      channelId,
      messageId,
      targetMessageId: sentMessage?.message_id,
      originalText: text,
      translatedText: amharic,
      englishText: english,
      sourceLang,
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Error processing post from ${channelId}:`, error);
  }
}
