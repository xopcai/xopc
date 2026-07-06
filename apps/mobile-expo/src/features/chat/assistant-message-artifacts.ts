import type { ImageContent, MessageAttachment, MessageContent } from './messages.types';
import { normalizeGeneratedWorkspacePath } from './image-source-utils';
import { isMediaUri } from './media-uri';
import {
  absolutePathSameAsWorkspaceRelative,
  extractFilePathsFromToolResult,
  extractWorkspaceRelativeMentionsFromAssistantMarkdown,
  looksLikeAbsoluteFilePath,
  type ExtractedFilePath,
} from './tool-result-file-paths';

/**
 * Tool names that typically add or change workspace files on success.
 * (Avoid broad listing tools like `list_dir` / `read_file` whose output is not a stable “generated file” set.)
 */
export const TOOL_NAMES_WITH_WORKSPACE_OUTPUT = new Set<string>([
  'write_file',
  'edit_file',
  'image_generate',
]);

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

function normalizeWorkspaceRel(s: string | undefined): string {
  return (s ?? '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function pathsIndicateSameWorkspaceArtifact(a: ExtractedFilePath, b: ExtractedFilePath): boolean {
  const ar = normalizeWorkspaceRel(a.workspaceRelativePath);
  const br = normalizeWorkspaceRel(b.workspaceRelativePath);
  const aa = a.absolutePath;
  const ba = b.absolutePath;

  if (ar && br) return ar === br;
  if (ar && looksLikeAbsoluteFilePath(ba)) return absolutePathSameAsWorkspaceRelative(ba, ar);
  if (br && looksLikeAbsoluteFilePath(aa)) return absolutePathSameAsWorkspaceRelative(aa, br);
  if (looksLikeAbsoluteFilePath(aa) && looksLikeAbsoluteFilePath(ba)) {
    return aa.replace(/\\/g, '/').trim() === ba.replace(/\\/g, '/').trim();
  }
  return aa === ba;
}

/** Prefer workspace-relative entries so preview uses stable `workspaceRelativePath`. */
function preferExtractedPath(existing: ExtractedFilePath, incoming: ExtractedFilePath): ExtractedFilePath {
  if (incoming.workspaceRelativePath && !existing.workspaceRelativePath) {
    return incoming;
  }
  return existing;
}

function mergeExtractedPaths(accum: ExtractedFilePath[], from: readonly ExtractedFilePath[]): void {
  for (const p of from) {
    const idx = accum.findIndex((e) => pathsIndicateSameWorkspaceArtifact(e, p));
    if (idx >= 0) {
      accum[idx] = preferExtractedPath(accum[idx], p);
      continue;
    }
    accum.push(p);
  }
}

function isDocumentLikeAssistantAttachment(att: MessageAttachment): boolean {
  if (att.type === 'voice' || att.type === 'audio' || att.type === 'image') {
    return false;
  }
  if (att.mimeType?.startsWith('image/') || att.mimeType?.startsWith('audio/')) {
    return false;
  }
  return true;
}

/**
 * Drop document attachments that are already listed in the “Message output” workspace path strip
 * (same turn often carries both tool-derived paths and wire `attachments` with the same file).
 */
export function filterAssistantAttachmentsDedupedAgainstWorkspacePaths(
  attachments: MessageAttachment[] | undefined,
  workspacePaths: readonly ExtractedFilePath[],
): MessageAttachment[] | undefined {
  if (!attachments?.length || !workspacePaths.length) {
    return attachments;
  }
  const filtered = attachments.filter((att) => {
    if (!isDocumentLikeAssistantAttachment(att)) {
      return true;
    }
    return !attachmentOverlapsWorkspaceOutputPaths(att, workspacePaths);
  });
  return filtered.length === attachments.length ? attachments : filtered.length ? filtered : undefined;
}

function fileNameKey(path: string): string {
  const n = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return (n[n.length - 1] ?? path).trim().toLowerCase();
}

function attachmentOverlapsWorkspaceOutputPaths(
  att: MessageAttachment,
  paths: readonly ExtractedFilePath[],
): boolean {
  const attRel = normalizeWorkspaceRel(att.workspaceRelativePath);
  const attName = (att.name ?? '').trim().toLowerCase();
  for (const p of paths) {
    const pr = normalizeWorkspaceRel(p.workspaceRelativePath);
    if (pr && attRel && attRel === pr) {
      return true;
    }
    if (pr && !attRel && attName && fileNameKey(pr) === attName) {
      return true;
    }
    if (looksLikeAbsoluteFilePath(p.absolutePath) && attRel) {
      if (absolutePathSameAsWorkspaceRelative(p.absolutePath, attRel)) {
        return true;
      }
    }
  }
  return false;
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

  const writerRelKeys = new Set(
    out.map((p) => normalizeWorkspaceRel(p.workspaceRelativePath)).filter(Boolean),
  );
  for (const p of out) {
    if (looksLikeAbsoluteFilePath(p.absolutePath)) {
      const base = fileNameKey(p.absolutePath);
      if (base) writerRelKeys.add(base);
    }
  }

  for (const b of content) {
    if (b.type !== 'text') {
      continue;
    }
    const narrative = (b.text ?? '').trim();
    if (!narrative || writerRelKeys.size === 0) {
      continue;
    }
    const mentions = extractWorkspaceRelativeMentionsFromAssistantMarkdown(narrative);
    const matched = mentions.filter((m) => {
      const rel = normalizeWorkspaceRel(m.workspaceRelativePath);
      if (rel && writerRelKeys.has(rel)) return true;
      const name = fileNameKey(rel || m.fileName);
      return name.length > 0 && writerRelKeys.has(name);
    });
    mergeExtractedPaths(out, matched);
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
  if (isMediaUri(raw)) {
    return {
      name: `image-${index + 1}`,
      mimeType: block.source?.media_type || 'image/png',
      type: 'image',
      uri: raw,
    };
  }
  const generatedPath = normalizeGeneratedWorkspacePath(raw);
  if (generatedPath) {
    return {
      name: generatedPath.split('/').filter(Boolean).pop() || `image-${index + 1}`,
      mimeType: block.source?.media_type || 'image/png',
      type: 'image',
      workspaceRelativePath: generatedPath,
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
