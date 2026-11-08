import { open } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { MAX_CHAT_ATTACHMENTS, MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from '../gateway/chat-limits.js';
import type { TuiInboundAttachment } from './tui-backend.js';

export async function readTuiImageFiles(paths: string[]): Promise<TuiInboundAttachment[]> {
  if (paths.length > MAX_CHAT_ATTACHMENTS) throw new Error(`At most ${MAX_CHAT_ATTACHMENTS} images can be attached.`);
  const attachments: TuiInboundAttachment[] = [];
  for (const path of paths) {
    const file = await open(resolve(path), 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_WEBCHAT_ATTACHMENT_FILE_BYTES) throw new Error(`Image must be a file of at most ${MAX_WEBCHAT_ATTACHMENT_FILE_BYTES} bytes: ${path}`);
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_WEBCHAT_ATTACHMENT_FILE_BYTES) + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = await file.read(buffer, length, buffer.length - length, null);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (length > MAX_WEBCHAT_ATTACHMENT_FILE_BYTES) throw new Error(`Image grew beyond the size limit: ${path}`);
      const bytes = buffer.subarray(0, length);
      const mimeType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
          : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) ? 'image/gif'
            : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : undefined;
      if (!mimeType) throw new Error(`Unsupported image format: ${path}. Use PNG, JPEG, GIF or WebP.`);
      attachments.push({ type: 'image', mimeType, name: basename(path), size: length, data: bytes.toString('base64') });
    } finally { await file.close(); }
  }
  return attachments;
}
