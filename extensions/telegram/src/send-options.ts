/**
 * Telegram Send Options Utilities
 *
 * Build send options for Telegram API, parse data URLs, and resolve media methods.
 * Extracted to eliminate code duplication in outbound-sender.ts
 */

export interface TelegramSendParams {
  threadId?: string;
  replyToMessageId?: string;
  silent?: boolean;
  parseMode?: 'HTML' | 'Markdown';
  caption?: string;
}

export type TelegramMediaMethod = 'sendPhoto' | 'sendVideo' | 'sendAudio' | 'sendDocument' | 'sendVoice';

/**
 * Build Telegram API send options
 * Eliminates duplicate code across multiple send paths
 */
export function buildSendOptions(params: TelegramSendParams): Record<string, unknown> {
  const options: Record<string, unknown> = {
    parse_mode: params.parseMode ?? 'HTML',
  };

  if (params.threadId) {
    options.message_thread_id = parseInt(params.threadId, 10);
  }

  if (params.replyToMessageId) {
    options.reply_to_message_id = parseInt(params.replyToMessageId, 10);
  }

  if (params.silent) {
    options.disable_notification = true;
  }

  if (params.caption) {
    options.caption = params.caption;
  }

  return options;
}

/**
 * Parse data URL into mimeType and buffer
 * Supports: data:mime/type;base64,DATA
 */
export function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  const mimeType = match[1];
  const base64Data = match[2];

  // Buffer.from doesn't throw for invalid base64, it silently handles it
  const buffer = Buffer.from(base64Data, 'base64');
  return { mimeType, buffer };
}

/**
 * Resolve media method based on mime type or category
 */
export function resolveMediaMethod(mimeTypeOrCategory: string): TelegramMediaMethod {
  // Handle category-based resolution
  if (mimeTypeOrCategory === 'image' || mimeTypeOrCategory.startsWith('image/')) {
    return 'sendPhoto';
  }

  if (mimeTypeOrCategory === 'video' || mimeTypeOrCategory.startsWith('video/')) {
    return 'sendVideo';
  }

  if (mimeTypeOrCategory === 'voice') {
    return 'sendVoice';
  }

  // Opus codec in OGG is typically voice
  if (mimeTypeOrCategory.includes('opus')) {
    return 'sendVoice';
  }

  if (mimeTypeOrCategory === 'audio' || mimeTypeOrCategory.startsWith('audio/')) {
    return 'sendAudio';
  }

  // Default to document for unknown types
  return 'sendDocument';
}
