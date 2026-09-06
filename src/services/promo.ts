// Detect posts that carry promotional inline buttons linking to another channel
// or external site. Handles both shapes:
//   - Bot API: message.reply_markup.inline_keyboard[][{ text, url }]
//   - MTProto: message.replyMarkup.rows[].buttons[KeyboardButtonUrl | ...]
export function hasInlineLinkButtons(message: any): boolean {
  if (!message) return false;

  const markup =
    message.reply_markup || // Bot API
    message.replyMarkup; // MTProto
  if (!markup) return false;

  const rows: any[] = Array.isArray(markup.inline_keyboard)
    ? markup.inline_keyboard // Bot API
    : Array.isArray(markup.rows)
      ? markup.rows // MTProto
      : [];

  for (const row of rows) {
    const buttons: any[] = Array.isArray(row) ? row : row?.buttons || [];
    for (const btn of buttons) {
      if (!btn) continue;
      // Bot API: url buttons link to a channel/site directly.
      if (btn.url) return true;
      // Bot API: web app / a.k.a. mini app buttons embed an external app too.
      if (btn.web_app?.url) return true;
      // MTProto inline buttons that open external links.
      const cls = btn.className;
      if (
        cls === "KeyboardButtonUrl" ||
        cls === "KeyboardButtonWebView" ||
        cls === "KeyboardButtonUrlAuth"
      ) {
        return true;
      }
    }
  }
  return false;
}

// Used by the monitor to decide whether a sourced fetch should be skipped.
export function isPromotionalPost(message: any): boolean {
  return hasInlineLinkButtons(message);
}