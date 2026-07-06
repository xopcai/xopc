import type { Message, MessageAttachment, MessageContent } from './messages.types';
import { mimeTypeFromFileName } from './tool-result-file-paths';
import {
  collapseExpandedSkillBlockForDisplay,
  stripExpandedAtFileBlocks,
  stripInboundFileMachineText,
  stripStartupContextForDisplay,
} from './wire-text-scrub';

export { stripInboundFileMachineText } from './wire-text-scrub';

function parseFileLineMeta(fileMeta: string): { name: string; mimeType: string; size: number } {
  const nameMatch = fileMeta.match(/^([^(]+?)\s*\(/);
  const name = nameMatch ? nameMatch[1].trim() : 'file';
  const mimeMatch = fileMeta.match(/\(\s*([^,]+)\s*,\s*(\d+)\s*bytes\s*\)/i);
  const mimeType = mimeMatch ? mimeMatch[1].trim() : mimeTypeFromFileName(name);
  const size = mimeMatch ? parseInt(mimeMatch[2], 10) : 0;
  return { name, mimeType, size };
}

function attachmentTypeFromMime(mimeType: string): string {
  return mimeType.startsWith('audio/') ? 'voice' : 'document';
}

function collectTextChunks(raw: unknown): string[] {
  const chunks: string[] = [];
  if (typeof raw === 'string') {
    chunks.push(raw);
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === 'object' && (item as { type?: string }).type === 'text') {
        const t = (item as { text?: string }).text;
        if (typeof t === 'string') chunks.push(t);
      }
    }
  }
  return chunks;
}

/** Parse `xopc-path:rel:` lines persisted into user message text into attachment rows. */
export function extractAttachmentsFromUserContent(raw: unknown): MessageAttachment[] | undefined {
  const text = collectTextChunks(raw).join('\n');
  if (!text.includes('xopc-path:rel:')) return undefined;

  const out: MessageAttachment[] = [];
  const seen = new Set<string>();

  const push = (fileMeta: string, rel: string) => {
    const trimmed = rel.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    const { name, mimeType, size } = parseFileLineMeta(fileMeta);
    out.push({
      name,
      mimeType,
      size,
      type: attachmentTypeFromMime(mimeType),
      workspaceRelativePath: trimmed,
    });
  };

  const reSingle = /\[File: ([^\]]+)\]\s*xopc-path:rel:(\S+)\s*xopc-path:abs:\S+/g;
  let m: RegExpExecArray | null;
  while ((m = reSingle.exec(text)) !== null) {
    push(m[1], m[2]);
  }

  const reMulti = /\[File: ([^\]]+)\]\s*\r?\nxopc-path:rel:([^\r\n]+)\r?\n\s*xopc-path:abs:[^\r\n]+/g;
  while ((m = reMulti.exec(text)) !== null) {
    push(m[1], m[2]);
  }

  return out.length ? out : undefined;
}

function attachmentStableKey(a: MessageAttachment): string {
  const rel = a.workspaceRelativePath?.replace(/\\/g, '/').trim();
  if (rel) return `rel:${rel}`;
  if (a.id) return `id:${a.id}`;
  return `name:${a.name ?? 'file'}|${a.mimeType ?? ''}`;
}

export function dedupeAttachments(
  list: MessageAttachment[] | undefined,
): MessageAttachment[] | undefined {
  if (!list?.length) return undefined;
  const out: MessageAttachment[] = [];
  const seen = new Set<string>();
  for (const a of list) {
    const k = attachmentStableKey(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out.length ? out : undefined;
}

export function mergeUserAttachments(
  wire: MessageAttachment[] | undefined,
  fromContent: MessageAttachment[] | undefined,
): MessageAttachment[] | undefined {
  return dedupeAttachments([...(wire ?? []), ...(fromContent ?? [])]);
}

export function applyStripToUserContent(
  role: Message['role'],
  blocks: MessageContent[],
): MessageContent[] {
  if (role !== 'user' && role !== 'user-with-attachments') return blocks;
  const mapped = blocks.map((b) => {
    if (b.type === 'text' && typeof b.text === 'string') {
      let stripped = stripStartupContextForDisplay(b.text);
      stripped = stripExpandedAtFileBlocks(stripped);
      stripped = stripInboundFileMachineText(stripped);
      return { ...b, text: collapseExpandedSkillBlockForDisplay(stripped) };
    }
    return b;
  });
  return mapped.filter((b) => {
    if (b.type === 'text' && (!b.text || !b.text.trim())) return false;
    return true;
  });
}
