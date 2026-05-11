import type { ImageContent, MessageAttachment, MessageContent } from '@/features/chat/messages.types';
import {
  extractFilePathsFromToolResult,
  extractWorkspaceRelativeMentionsFromAssistantMarkdown,
  type ExtractedFilePath,
} from '@/features/chat/tool-result-file-paths';

/**
 * Tool names that typically add or change workspace files on success.
 * (Avoid broad listing tools like `list_dir` / `read_file` whose output is not a stable “generated file” set.)
 */
const TOOL_NAMES_WITH_WORKSPACE_OUTPUT = new Set<string>(['write_file', 'edit_file', 'image_generate']);

function normalizeToolResultString(result: string | undefined | unknown): string {
  if (result == null) {
    return '';
  }
  if (typeof result === 'string') {
    return result;
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function mergeExtractedPaths(accum: ExtractedFilePath[], from: readonly ExtractedFilePath[]): void {
  const seen = new Set(accum.map((p) => p.workspaceRelativePath ?? p.absolutePath));
  for (const p of from) {
    const k = p.workspaceRelativePath ?? p.absolutePath;
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    accum.push(p);
  }
}

/**
 * Union of workspace file paths from selected tools in one assistant turn (one merged bubble).
 */
export function collectAssistantWorkspaceOutputPaths(
  content: MessageContent[] | undefined,
): ExtractedFilePath[] {
  if (!content?.length) {
    return [];
  }
  const out: ExtractedFilePath[] = [];
  for (const b of content) {
    if (b.type !== 'tool_use') {
      continue;
    }
    const t = b;
    if (t.status !== 'done') {
      continue;
    }
    if (!TOOL_NAMES_WITH_WORKSPACE_OUTPUT.has(t.name)) {
      continue;
    }
    const text = normalizeToolResultString(t.result);
    if (!text.trim()) {
      continue;
    }
    mergeExtractedPaths(out, extractFilePathsFromToolResult(text));
  }
  for (const b of content) {
    if (b.type !== 'text') {
      continue;
    }
    const narrative = (b.text ?? '').trim();
    if (!narrative) {
      continue;
    }
    mergeExtractedPaths(out, extractWorkspaceRelativeMentionsFromAssistantMarkdown(narrative));
  }
  return out;
}

/**
 * Reuses the same preview payload shape as {@link message-bubble} `imageContentToPreviewAttachment`.
 */
export function imageBlockToMessageAttachment(block: ImageContent, index: number): MessageAttachment | null {
  const raw = block.source?.data?.trim();
  if (!raw) {
    return null;
  }
  const m = raw.match(/^data:([^;]+);base64,([\s\S]+)$/i);
  if (m?.[1] && m[2]) {
    const b64 = m[2].replace(/\s/g, '');
    return {
      name: `image-${index + 1}`,
      mimeType: m[1],
      type: 'image',
      content: b64,
      data: b64,
    };
  }
  if (raw.startsWith('data:')) {
    return {
      name: `image-${index + 1}`,
      mimeType: 'image/png',
      type: 'image',
      content: raw,
      data: raw,
    };
  }
  const compact = raw.replace(/\s/g, '');
  return {
    name: `image-${index + 1}`,
    mimeType: 'image/png',
    type: 'image',
    content: compact,
    data: compact,
  };
}

export function imageContentBlocksToAttachments(blocks: ImageContent[] | undefined): MessageAttachment[] {
  if (!blocks?.length) {
    return [];
  }
  const out: MessageAttachment[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const att = imageBlockToMessageAttachment(blocks[i], i);
    if (att) {
      out.push(att);
    }
  }
  return out;
}
