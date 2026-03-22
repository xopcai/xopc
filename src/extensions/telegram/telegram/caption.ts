/**
 * Telegram Caption Utilities
 *
 * Handles splitting text for media captions vs follow-up messages.
 * Telegram captions have a 1024 character limit.
 */

const TELEGRAM_CAPTION_LIMIT = 1024;

export interface CaptionSplit {
  /** The caption (max 1024 chars) */
  caption: string;
  /** Remaining text to send as follow-up */
  followUpText: string | undefined;
  /** Whether the text was split */
  wasSplit: boolean;
}

/**
 * Split text into caption and follow-up text
 * Tries to split at natural boundaries (paragraphs, sentences)
 */
export function splitTelegramCaption(text: string): CaptionSplit {
  if (!text || text.length <= TELEGRAM_CAPTION_LIMIT) {
    return {
      caption: text || '',
      followUpText: undefined,
      wasSplit: false,
    };
  }

  // Try to find a good split point before the limit
  let splitIndex = findGoodSplitPoint(text, TELEGRAM_CAPTION_LIMIT);

  // If no good split point, force split at limit
  if (splitIndex <= 0) {
    splitIndex = TELEGRAM_CAPTION_LIMIT;
  }

  const caption = text.slice(0, splitIndex).trim();
  const followUpText = text.slice(splitIndex).trim();

  return {
    caption,
    followUpText: followUpText || undefined,
    wasSplit: true,
  };
}

/**
 * Find a good split point near the limit
 * Prefers: paragraph break > sentence break > word break
 */
function findGoodSplitPoint(text: string, limit: number): number {
  // Search backwards from limit
  const searchStart = Math.min(limit, text.length);
  const searchEnd = Math.max(0, limit - 200); // Look back up to 200 chars

  // 1. Look for paragraph break (double newline)
  for (let i = searchStart; i >= searchEnd; i--) {
    if (text.slice(i - 2, i) === '\n\n') {
      return i;
    }
  }

  // 2. Look for sentence break (.!? followed by space or end)
  const sentencePattern = /[.!?]\s+/g;
  let match;
  let lastMatchIndex = -1;

  while ((match = sentencePattern.exec(text)) !== null) {
    if (match.index > searchEnd && match.index <= searchStart) {
      lastMatchIndex = match.index + 1; // Include the punctuation
    } else if (match.index > searchStart) {
      break;
    }
  }

  if (lastMatchIndex > 0) {
    return lastMatchIndex;
  }

  // 3. Look for word break (space)
  for (let i = searchStart; i >= searchEnd; i--) {
    if (text[i] === ' ' || text[i] === '\n') {
      return i;
    }
  }

  // 4. Force split at limit
  return limit;
}


