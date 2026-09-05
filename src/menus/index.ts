import { InlineKeyboard } from "grammy";

// Main Menu
export function getMainMenu(): { text: string; keyboard: InlineKeyboard } {
  const text = [
    "╔══════════════════════════╗",
    "║   🤖 SPORT NEWS BOT     ║",
    "║   Amharic Translation    ║",
    "╚══════════════════════════╝",
    "",
    "Welcome to the control panel.",
    "Select an option below:",
  ].join("\n");

  const keyboard = new InlineKeyboard()
    .text("📺 Channels", "menu:channels")
    .text("🎞 Reels", "menu:reels")
    .row()
    .text("⚙️ Settings", "menu:settings")
    .text("📊 Status", "menu:status")
    .row()
    .text("❓ Help", "menu:help");

  return { text, keyboard };
}

// Channels Menu
export function getChannelsMenu(): { text: string; keyboard: InlineKeyboard } {
  const text = [
    "╔══════════════════════════╗",
    "║   📺 CHANNEL MANAGEMENT  ║",
    "╚══════════════════════════╝",
    "",
    "Source Channels = where posts",
    "are fetched (no admin needed).",
    "Target Channels = where posts",
    "are published (bot is admin).",
    "",
    "You can enter multiple channels",
    "separated by comma or space:",
    "",
    "Example: @sky @united @goal",
  ].join("\n");

  const keyboard = new InlineKeyboard()
    .text("📥 Source Channels", "channel:add")
    .text("📤 Target Channels", "channel:target")
    .row()
    .text("➖ Remove Channel", "channel:remove")
    .text("📋 List Channels", "channel:list")
    .row()
    .text("◀️ Back", "menu:main");

  return { text, keyboard };
}

// Settings Menu
export function getSettingsMenu(showEnglish: boolean, showOriginal: boolean, signature: string, reelsMode = false): { text: string; keyboard: InlineKeyboard } {
  const text = [
    "╔══════════════════════════╗",
    "║   ⚙️ BOT SETTINGS        ║",
    "╚══════════════════════════╝",
    "",
    `${signature ? `✍️ Signature:\n${signature}` : "✍️ Signature: Not set"}`,
    "",
    `🇬🇧 English Display:  ${showEnglish ? "✅ ON" : "❌ OFF"}`,
    `📝 Original Display: ${showOriginal ? "✅ ON" : "❌ OFF"}`,
    `🎞 Reels Mode:       ${reelsMode ? "✅ ON (manual queue)" : "❌ OFF (auto-post)"}`,
    "",
    "Settings:",
  ].join("\n");

  const englishBtn = showEnglish
    ? "🇬🇧 English: ✅ ON"
    : "🇬🇧 English: ❌ OFF";
  const originalBtn = showOriginal
    ? "📝 Original: ✅ ON"
    : "📝 Original: ❌ OFF";
  const reelsBtn = reelsMode
    ? "🎞 Reels: ✅ ON"
    : "🎞 Reels: ❌ OFF";

  const keyboard = new InlineKeyboard()
    .text(englishBtn, "setting:toggle:english")
    .row()
    .text(originalBtn, "setting:toggle:original")
    .row()
    .text(reelsBtn, "setting:toggle:reels")
    .row()
    .text("✍️ Change Signature", "setting:signature")
    .text("🌐 Set Language", "setting:language")
    .row()
    .text("◀️ Back", "menu:main");

  return { text, keyboard };
}

// Status Menu
export function getStatusMenu(data: {
  channels: number;
  target: string[];
  signature: string;
  showEnglish: boolean;
  showOriginal: boolean;
  reelsEnabled: boolean;
  reelsQueued: number;
}): { text: string; keyboard: InlineKeyboard } {
  const targets = data.target.length > 0 ? data.target.join(", ") : "Not set";
  const text = [
    "╔══════════════════════════╗",
    "║   📊 BOT STATUS          ║",
    "╚══════════════════════════╝",
    "",
    `📺 Sources: ${data.channels} channels`,
    `📤 Targets: ${targets}`,
    `✍️ Signature: ${data.signature || "Not set"}`,
    `🇬🇧 English: ${data.showEnglish ? "ON" : "OFF"}`,
    `📝 Original: ${data.showOriginal ? "ON" : "OFF"}`,
    `🎞 Reels: ${data.reelsEnabled ? "ON (manual)" : "OFF (auto)"} • Queue: ${data.reelsQueued}`,
  ].join("\n");

  const keyboard = new InlineKeyboard()
    .text("🔄 Refresh", "menu:status")
    .row()
    .text("◀️ Back", "menu:main");

  return { text, keyboard };
}

// Help Menu
export function getHelpMenu(): { text: string; keyboard: InlineKeyboard } {
  const text = [
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
  ].join("\n");

  const keyboard = new InlineKeyboard()
    .text("◀️ Back", "menu:main");

  return { text, keyboard };
}

// Reels Home (dashboard)
export function getReelsHomeMenu(stats: {
  queued: number;
  posted: number;
  skipped: number;
}): { text: string; keyboard: InlineKeyboard } {
  const text = [
    "╔══════════════════════════╗",
    "║        🎞 REELS          ║",
    "╚══════════════════════════╝",
    "",
    "📰 Scroll through the queued",
    "sport news. Every post is",
    "pre-translated and ready",
    "to review.",
    "",
    "• Edit ✏️ or Patch 🩹 the text",
    "• Toggle Original vs Translation",
    "• Attach Media 🖼",
    "• Then Post 📤 or Skip ⏭",
    "• 🔗 opens the source post",
    "",
    "📊 Queue Stats:",
    `🗞 Queued: ${stats.queued}`,
    `✅ Posted: ${stats.posted}`,
    `⏭ Skipped: ${stats.skipped}`,
    "",
    "Scroll through each post one",
    "at a time. Start below:",
  ].join("\n");

  const keyboard = new InlineKeyboard()
    .text("▶️ Start", "menu:reels:start")
    .row()
    .text("◀️ Back", "menu:main");

  return { text, keyboard };
}

// Confirm Dialog
export function getConfirmDialog(message: string, confirmAction: string, cancelAction: string): { text: string; keyboard: InlineKeyboard } {
  const text = `⚠️ ${message}`;

  const keyboard = new InlineKeyboard()
    .text("✅ Confirm", confirmAction)
    .text("❌ Cancel", cancelAction);

  return { text, keyboard };
}

// Add Source Channels Prompt
export function getAddChannelPrompt(): { text: string; keyboard: InlineKeyboard } {
  const text = [
    "╔══════════════════════════╗",
    "║   📥 ADD SOURCE CHANNELS ║",
    "╚══════════════════════════╝",
    "",
    "Send channel username(s),",
    "multiple separated by",
    "comma or space:",
    "",
    "Example: @sky_sports @united",
    "Example: @sky_sports, @united",
    "",
    "Or send /cancel to go back.",
  ].join("\n");

  const keyboard = new InlineKeyboard()
    .text("❌ Cancel", "menu:channels");

  return { text, keyboard };
}

// Remove Channel Prompt
export function getRemoveChannelPrompt(channels: string[]): { text: string; keyboard: InlineKeyboard } {
  let text = [
    "╔══════════════════════════╗",
    "║   ➖ REMOVE CHANNEL       ║",
    "╚══════════════════════════╝",
    "",
    "Select channel to remove:",
  ].join("\n");

  const keyboard = new InlineKeyboard();

  if (channels.length === 0) {
    text += "\n\nNo channels to remove.";
    keyboard.text("◀️ Back", "menu:channels");
  } else {
    for (const ch of channels) {
      keyboard.text(`🗑 ${ch}`, `channel:confirmremove:${ch}`).row();
    }
    keyboard.text("❌ Cancel", "menu:channels");
  }

  return { text, keyboard };
}

// Set Target Prompt
export function getSetTargetPrompt(): { text: string; keyboard: InlineKeyboard } {
  const text = [
    "╔══════════════════════════╗",
    "║   📤 ADD TARGET CHANNELS ║",
    "╚══════════════════════════╝",
    "",
    "Send target channel username(s),",
    "multiple separated by comma or",
    "space. This REPLACES the current",
    "target list:",
    "",
    "Example: @sport_news @sport_news2",
    "",
    "Or send /cancel to go back.",
  ].join("\n");

  const keyboard = new InlineKeyboard()
    .text("❌ Cancel", "menu:channels");

  return { text, keyboard };
}

// Set Signature Prompt
export function getSetSignaturePrompt(currentSignature: string): { text: string; keyboard: InlineKeyboard } {
  const text = [
    "╔══════════════════════════╗",
    "║   ✍️ CHANGE SIGNATURE    ║",
    "╚══════════════════════════╝",
    "",
    `Current signature:\n${currentSignature || "None"}`,
    "",
    "Send the NEW signature text.",
    "It replaces the current one:",
    "",
    "Example: SHARE ⬅️",
    "🤳@Ethio_Utd ✅",
    "",
    "Or send /cancel to go back.",
  ].join("\n");

  const keyboard = new InlineKeyboard()
    .text("❌ Cancel", "menu:settings");

  return { text, keyboard };
}

// Set Language Prompt
export function getSetLanguagePrompt(): { text: string; keyboard: InlineKeyboard } {
  const text = [
    "╔══════════════════════════╗",
    "║   🌐 SET TRANSLATION LANG ║",
    "╚══════════════════════════╝",
    "",
    "Select target language:",
  ].join("\n");

  const keyboard = new InlineKeyboard()
    .text("🇪🇹 Amharic", "setting:setlang:am")
    .text("🇸🇦 Arabic", "setting:setlang:ar")
    .row()
    .text("🇫🇷 French", "setting:setlang:fr")
    .text("🇪🇸 Spanish", "setting:setlang:es")
    .row()
    .text("🇩🇪 German", "setting:setlang:de")
    .text("🇵🇹 Portuguese", "setting:setlang:pt")
    .row()
    .text("❌ Cancel", "menu:settings");

  return { text, keyboard };
}
