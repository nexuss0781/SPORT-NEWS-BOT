import { translate } from "@vitalets/google-translate-api";

const CHUNK_SIZE = 4500;

export async function translateToAmharic(
  text: string
): Promise<{ amharic: string; english: string; sourceLang: string }> {
  if (!text || text.trim().length === 0) {
    return { amharic: text, english: text, sourceLang: "en" };
  }

  // Detect source language
  const sourceLang = await detectLanguage(text);

  // If already English, just translate to Amharic
  if (sourceLang === "en") {
    const amharic = await translateChunk(text, "am");
    return { amharic, english: text, sourceLang: "en" };
  }

  // For non-English: translate to English first, then to Amharic
  let englishText = text;
  if (sourceLang !== "en") {
    englishText = await translateChunk(text, "en");
  }

  const amharic = await translateChunk(englishText, "am");
  return { amharic, english: englishText, sourceLang };
}

export async function translateToEnglish(text: string): Promise<string> {
  if (!text || text.trim().length === 0) {
    return text;
  }
  return await translateChunk(text, "en");
}

export async function detectLanguage(text: string): Promise<string> {
  try {
    const result = await translate(text, { to: "en" });
    return (result as any).from?.language?.iso || "en";
  } catch {
    return "en";
  }
}

async function translateChunk(text: string, targetLang: string): Promise<string> {
  try {
    const result = await translate(text, { to: targetLang });
    return result.text;
  } catch (error) {
    console.error("Translation error:", error);
    return text;
  }
}

function splitText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split("\n\n");
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length + 2 > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      // If single paragraph exceeds max, split by sentences
      if (paragraph.length > maxLength) {
        const sentences = paragraph.split(/(?<=[.!?])\s+/);
        let sentenceChunk = "";
        for (const sentence of sentences) {
          if (sentenceChunk.length + sentence.length + 1 > maxLength) {
            if (sentenceChunk) chunks.push(sentenceChunk);
            sentenceChunk = sentence;
          } else {
            sentenceChunk = sentenceChunk
              ? `${sentenceChunk} ${sentence}`
              : sentence;
          }
        }
        if (sentenceChunk) {
          currentChunk = sentenceChunk;
        } else {
          currentChunk = "";
        }
      } else {
        currentChunk = paragraph;
      }
    } else {
      currentChunk = currentChunk
        ? `${currentChunk}\n\n${paragraph}`
        : paragraph;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}
