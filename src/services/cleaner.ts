const TOKEN = /[@#][\p{L}\p{N}\p{M}_]+/gu;
const HANDLE = /@[\p{L}\p{N}\p{M}_]+/u;
const LINK_URL = /https?:\/\/[^\s)\]]*/g;
const LINK_TME = /\bt\.me\/[^\s)\]]*/g;
const LINK_WWW = /\bwww\.[^\s)\]]*/g;
const LINK_DETECT = /t(\.me|elegram|co)\/|https?:\/\/|www\./;
const CREDIT_MARKERS = /^\s*(منبع|source|sources?|credit|credits?|ادیت ارسالی)\s*[⬇️↓⚡…-]*\s*$/i;

export function isPromoLine(line: string, hadLink = false): boolean {
  if (!line) return false;

  const hasHandle = HANDLE.test(line);
  const tokens = (line.match(TOKEN) || []).length;

  const textChars = line
    .replace(TOKEN, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, "");

  if (textChars.length === 0) return true;

  if (hasHandle && (hadLink || tokens > 1)) return true;

  if (hadLink && tokens > 0) return true;

  if (tokens > 0 && textChars.length <= 2) return true;

  if (CREDIT_MARKERS.test(line)) return true;

  return false;
}

export function cleanContent(text: string): string {
  if (!text || text.trim().length === 0) return "";

  const lines = text.split("\n");
  const kept: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const hadLink = LINK_DETECT.test(line);

    let cleanedLine = line
      .replace(LINK_URL, "")
      .replace(LINK_TME, "")
      .replace(LINK_WWW, "")
      .replace(/\(\s*\)/g, "")
      .replace(/[()]+$/, "")
      .trim();

    if (!cleanedLine) continue;
    if (isPromoLine(cleanedLine, hadLink)) continue;
    kept.push(cleanedLine);
  }

  return kept.join("\n").trim();
}