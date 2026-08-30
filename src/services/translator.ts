import { translate } from "@vitalets/google-translate-api";

const CHUNK_SIZE = 4500;

export async function translateToAmharic(
  text: string
): Promise<string> {
  if (!text || text.trim().length === 0) {
    return text;
  }

  // If text is short enough, translate directly
  if (text.length <= CHUNK_SIZE) {
    return await translateChunk(text);
  }

  // Split long text into chunks
  const chunks = splitText(text, CHUNK_SIZE);
  const translatedChunks: string[] = [];

  for (const chunk of chunks) {
    const translated = await translateChunk(chunk);
    translatedChunks.push(translated);
  }

  return translatedChunks.join("\n\n");
}

async function translateChunk(text: string): Promise<string> {
  try {
    const result = await translate(text, { to: "am" });
    return result.text;
  } catch (error) {
    console.error("Translation error:", error);
    // Return original text if translation fails
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
