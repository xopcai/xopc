import type { ImageContent, MessageAttachment, MessageContent } from '@/features/chat/messages/messages.types';
import {
  absolutePathSameAsWorkspaceRelative,
  extractFilePathsFromToolResult,
  extractWorkspaceRelativeMentionsFromAssistantMarkdown,
  looksLikeAbsoluteFilePath,
  type ExtractedFilePath,
} from '@/features/chat/tool-results/tool-result-file-paths';

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

/**
 * Combining merge: preserve the real absolute path AND the workspace-relative path
 * when both sides describe the same artifact. Earlier code replaced the entry wholesale
 * and let an assistant-markdown rel overwrite a tool-result abs — that turned external
 * files (whose abs lives outside the workspace) into a useless `rel:` sentinel and
 * silenced the import-to-workspace card.
 */
function preferExtractedPath(existing: ExtractedFilePath, incoming: ExtractedFilePath): ExtractedFilePath {
  const realAbs = looksLikeAbsoluteFilePath(existing.absolutePath)
    ? existing.absolutePath
    : looksLikeAbsoluteFilePath(incoming.absolutePath)
      ? incoming.absolutePath
      : existing.absolutePath;
  return {
    ...existing,
    absolutePath: realAbs,
    workspaceRelativePath: existing.workspaceRelativePath ?? incoming.workspaceRelativePath,
    fileName: existing.fileName || incoming.fileName,
    mimeType: existing.mimeType || incoming.mimeType,
  };
}

function artifactIndexKeys(p: ExtractedFilePath): string[] {
  const keys: string[] = [];
  const rel = normalizeWorkspaceRel(p.workspaceRelativePath);
  if (rel) keys.push(`rel:${rel}`);
  const abs = p.absolutePath?.replace(/\\/g, '/').trim();
  if (looksLikeAbsoluteFilePath(abs)) keys.push(`abs:${abs}`);
  return keys;
}

function buildArtifactIndex(accum: ExtractedFilePath[]): Map<string, number> {
  const index = new Map<string, number>();
  accum.forEach((p, i) => {
    for (const k of artifactIndexKeys(p)) index.set(k, i);
  });
  return index;
}

function findArtifactIndex(
  accum: ExtractedFilePath[],
  index: Map<string, number>,
  p: ExtractedFilePath,
): number {
  for (const k of artifactIndexKeys(p)) {
    const hit = index.get(k);
    if (hit !== undefined) return hit;
  }
  for (let i = 0; i < accum.length; i++) {
    if (pathsIndicateSameWorkspaceArtifact(accum[i], p)) return i;
  }
  return -1;
}

function mergeExtractedPaths(accum: ExtractedFilePath[], from: readonly ExtractedFilePath[]): void {
  const index = buildArtifactIndex(accum);
  for (const p of from) {
    const idx = findArtifactIndex(accum, index, p);
    if (idx >= 0) {
      accum[idx] = preferExtractedPath(accum[idx], p);
      for (const k of artifactIndexKeys(accum[idx])) index.set(k, idx);
      continue;
    }
    const newIdx = accum.length;
    accum.push(p);
    for (const k of artifactIndexKeys(p)) index.set(k, newIdx);
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
  if (att.uri?.startsWith('media://')) {
    return false;
  }
  const attRel = normalizeWorkspaceRel(undefined);
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
    // No rel on either side: dedupe by basename of the absolute path against the
    // attachment file name. Reaches the bare-mention case where the option-A filter
    // prevented merging the mention into the writer entry, so the entry only carries abs.
    if (!pr && !attRel && attName && looksLikeAbsoluteFilePath(p.absolutePath)) {
      if (fileNameKey(p.absolutePath) === attName) {
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

  // Exact workspace-relative writer keys (from tools that emit `workspaceRelativePaths`).
  const writerRels = new Set(
    out.flatMap((p) => {
      const v = normalizeWorkspaceRel(p.workspaceRelativePath);
      return v ? [v] : [];
    }),
  );
  // Basename-only keys from absolute writer paths (e.g. write_file -> "File written: /…/foo.html").
  // Cross-linking via these is intentionally fuzzy and gated by `mentionIsPathShaped`.
  const writerBasenames = new Set<string>();
  for (const p of out) {
    if (looksLikeAbsoluteFilePath(p.absolutePath)) {
      const base = fileNameKey(p.absolutePath);
      if (base) writerBasenames.add(base);
    }
  }

  for (const b of content) {
    if (b.type !== 'text') {
      continue;
    }
    const narrative = (b.text ?? '').trim();
    if (!narrative || (writerRels.size === 0 && writerBasenames.size === 0)) {
      continue;
    }
    const mentions = extractWorkspaceRelativeMentionsFromAssistantMarkdown(narrative);
    const matched = mentions.filter((m) => {
      const rel = normalizeWorkspaceRel(m.workspaceRelativePath);
      if (!rel) return false;
      // Exact rel-vs-rel match: always safe (writer and mention agree on the workspace-relative shape).
      if (writerRels.has(rel)) return true;
      // Basename cross-link: only allow when the mention has at least one `/` so we have
      // some namespace to disambiguate. Bare-name mentions (`README.md`) collide too often
      // across tool outputs and would false-positive (option A).
      if (rel.split('/').length < 2) return false;
      const name = fileNameKey(rel);
      return name.length > 0 && writerBasenames.has(name);
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
