import { InlineKeyboard } from "grammy";

// Main Menu
export function getMainMenu(isOwnerRole = true): { text: string; keyboard: InlineKeyboard } {
  const header = [
    "╔══════════════════════════╗",
    "║   🤖 SPORT NEWS BOT     ║",
    "║   Amharic Translation    ║",
    "╚══════════════════════════╝",
    "",
  ].join("\n");

  const keyboard = new InlineKeyboard();
  if (isOwnerRole) {
    const text = header + [
      "Welcome to the control panel.",
      "Select an option below:",
    ].join("\n");
    keyboard
      .text("📺 Channels", "menu:channels")
      .text("🎞 Reels", "menu:reels")
      .row()
      .text("⚙️ Settings", "menu:settings")
      .text("📊 Status", "menu:status")
      .row()
      .text("❓ Help", "menu:help");
    return { text, keyboard };
  }

  const text = header + [
    "Welcome! You have journalistic",
    "access — review and post news.",
  ].join("\n");
  keyboard
    .text("🎞 Reels", "menu:reels")
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
    .text("👥 Roles & Access", "setting:roles")
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
    "• Edit ✏️ the text",
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

// Roles & Access Menu
export function getRolesMenu(data: {
  owners: { id: number; name: string; removable?: boolean }[];
  admins: { id: number; name: string; removable?: boolean }[];
}): { text: string; keyboard: InlineKeyboard } {
  let ownerLines = "";
  for (const o of data.owners) {
    ownerLines += `👑 ${o.name}${o.removable === false ? " (operator)" : ""} (${o.id})\n`;
  }
  let adminLines = "";
  for (const a of data.admins) adminLines += `📰 ${a.name} (${a.id})\n`;

  const text = [
    "╔══════════════════════════╗",
    "║   👥 ROLES & ACCESS      ║",
    "╚══════════════════════════╝",
    "",
    "👑 Owners — full control:",
    "settings, channels, roles,",
    "and publishing.",
    (data.owners.length ? ownerLines : "(none beyond operator)").trimEnd(),
    "",
    "📰 Admins (Journalists) —",
    "review & post the news queue",
    "only: publish, skip, edit,",
    "toggle, attach media.",
    (data.admins.length ? adminLines : "(none)").trimEnd(),
    "",
    "Add users by @username.",
  ].join("\n");

  const keyboard = new InlineKeyboard();
  for (const o of data.owners) {
    if (o.removable === false) continue;
    keyboard.text(`👑 ${o.name} (${o.id})`, `setting:role:remove:owner:${o.id}`).row();
  }
  for (const a of data.admins) {
    if (a.removable === false) continue;
    keyboard.text(`📰 ${a.name} (${a.id})`, `setting:role:remove:admin:${a.id}`).row();
  }
  keyboard
    .text("👑 ➕ Add Owner", "setting:role:add:owner")
    .text("📰 ➕ Add Admin", "setting:role:add:admin")
    .row()
    .text("◀️ Back", "menu:settings");

  return { text, keyboard };
}

// Add Role Prompt
export function getAddRolePrompt(role: "owner" | "admin"): { text: string; keyboard: InlineKeyboard } {
  const roleLabel = role === "owner" ? "👑 OWNER (full control)" : "📰 ADMIN / JOURNALIST (posts news)";
  const text = [
    "╔══════════════════════════╗",
    `║   ➕ ADD ${role === "owner" ? "OWNER" : "ADMIN"}         ║`,
    "╚══════════════════════════╝",
    "",
    `New role: ${roleLabel}`,
    "",
    "Send the user's @username:",
    "",
    "Example: @sport_journalist",
    "",
    "Or send /cancel to go back.",
  ].join("\n");

  const keyboard = new InlineKeyboard()
    .text("❌ Cancel", "setting:roles");

  return { text, keyboard };
}
