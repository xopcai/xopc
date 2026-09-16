import { XopcChatAttachment } from '../model/chat';

export const MAX_ATTACHMENT_BYTES: number = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL: number = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS: number = 10;

export function attachmentMime(name: string): string {
  const extension = name.toLowerCase().split('.').pop() ?? '';
  switch (extension) {
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'pdf': return 'application/pdf';
    case 'txt': return 'text/plain';
    case 'md': return 'text/markdown';
    case 'csv': return 'text/csv';
    case 'json': return 'application/json';
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    default: return 'application/octet-stream';
  }
}

export function validateAttachmentSize(size: number, current: XopcChatAttachment[]): void {
  if (current.length >= MAX_ATTACHMENTS) throw new Error('ATTACHMENT_LIMIT_10');
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('EMPTY_ATTACHMENT');
  if (size > MAX_ATTACHMENT_BYTES) throw new Error('ATTACHMENT_LIMIT_10_MB');
  if (current.reduce((total: number, file: XopcChatAttachment): number => total + file.size, 0) + size > MAX_ATTACHMENT_TOTAL) {
    throw new Error('ATTACHMENT_TOTAL_LIMIT_20_MB');
  }
}

export function chatInputIdentity(content: string, attachments: XopcChatAttachment[]): string {
  return JSON.stringify({ content, attachments });
}
