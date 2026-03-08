import { createLogger } from '../utils/logger.js';

const log = createLogger('TTS:Preprocess');

export interface PreprocessOptions {
  maxLength?: number;
  stripMarkdown?: boolean;
  normalizeWhitespace?: boolean;
}

export interface PreprocessResult {
  text: string;
  wasTruncated: boolean;
  originalLength: number;
  finalLength: number;
}

export function stripMarkdown(text: string): string {
  return (
    text
      .replace(/```[\s\S]*?```/g, (match) => {
        const content = match.replace(/```(\w+)?\n?/, '').replace(/```$/, '');
        return content.trim();
      })
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(.+?)\1/g, '$2')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s*>\s*/gm, '')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/^(---+|\*\*\*+|___+)\s*$/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/<[^>]+>/g, '')
  );
}

export function normalizeWhitespace(text: string): string {
  return (
    text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .trim()
  );
}

export function truncateText(text: string, maxLength: number): { text: string; wasTruncated: boolean } {
  if (text.length <= maxLength) {
    return { text, wasTruncated: false };
  }

  let truncateAt = maxLength - 3;
  while (truncateAt > 0 && text[truncateAt] !== ' ' && text[truncateAt] !== '\n') {
    truncateAt--;
  }

  if (truncateAt <= maxLength * 0.8) {
    truncateAt = maxLength - 3;
  }

  return {
    text: text.slice(0, truncateAt).trim() + '...',
    wasTruncated: true,
  };
}

export function preprocessText(
  text: string,
  options: PreprocessOptions = {}
): PreprocessResult {
  const {
    maxLength = 4096,
    stripMarkdown: shouldStripMarkdown = true,
    normalizeWhitespace: shouldNormalizeWhitespace = true,
  } = options;

  const originalLength = text.length;
  let processed = text;

  if (shouldStripMarkdown) {
    processed = stripMarkdown(processed);
    log.debug({ originalLength, afterMarkdown: processed.length }, 'Stripped markdown');
  }

  if (shouldNormalizeWhitespace) {
    processed = normalizeWhitespace(processed);
    log.debug({ afterWhitespace: processed.length }, 'Normalized whitespace');
  }

  const { text: finalText, wasTruncated } = truncateText(processed, maxLength);

  if (wasTruncated) {
    log.warn(
      { originalLength, finalLength: finalText.length, maxLength },
      'Text truncated for TTS'
    );
  }

  return {
    text: finalText,
    wasTruncated,
    originalLength,
    finalLength: finalText.length,
  };
}

export function checkTTSSuitability(text: string): { suitable: boolean; reason?: string } {
  const trimmed = text.trim();

  if (trimmed.length < 10) {
    return { suitable: false, reason: 'Text too short for TTS (min 10 chars)' };
  }

  const codePattern = /[{};\[\]\(\)=><]/g;
  const codeMatches = trimmed.match(codePattern);
  const codeRatio = codeMatches ? codeMatches.length / trimmed.length : 0;
  if (codeRatio > 0.3) {
    return { suitable: false, reason: 'Text appears to be mostly code' };
  }

  if (/^(https?:\/\/\S+\s*)+$/.test(trimmed)) {
    return { suitable: false, reason: 'Text contains only URLs' };
  }

  return { suitable: true };
}
