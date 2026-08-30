import { Bot, Context } from "grammy";
import { registerAdminCommands } from "./handlers/admin";
import { registerStartCommands } from "./handlers/start";
import { config, isAdmin } from "./config";
import { getChannels, getConfig, isProcessed, markAsProcessed } from "./services/storage";
import { translateToAmharic } from "./services/translator";

export function createBot(): Bot {
  const bot = new Bot(config.botToken);

  // Register command handlers
  registerStartCommands(bot);
  registerAdminCommands(bot);

  // Handle channel posts
  bot.on("channel_post", async (ctx) => {
    await handleChannelPost(ctx);
  });

  // Handle edited channel posts
  bot.on("edited_channel_post", async (ctx) => {
    await handleChannelPost(ctx, true);
  });

  return bot;
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
    // Translate to Amharic
    const translatedText = await translateToAmharic(text);

    // Format post with signature
    let postContent = `📢 ${translatedText}`;
    if (cfg.signature) {
      postContent += `\n\n—\n${cfg.signature}`;
    }

    // Send to target channel
    const targetChannel = cfg.targetChannel;
    if (targetChannel) {
      await ctx.api.sendMessage(targetChannel, postContent, {
        parse_mode: "HTML",
      });
    }

    // Mark as processed
    markAsProcessed({
      channelId,
      messageId,
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Error processing post from ${channelId}:`, error);
  }
}
