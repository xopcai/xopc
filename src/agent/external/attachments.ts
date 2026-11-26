import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { UserTurnAttachment } from '../../gateway/user-turn-input.js';
import type { ExternalTurnAttachment } from './types.js';

const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;

function extensionFromMimeType(mimeType?: string): string {
  switch ((mimeType ?? '').toLowerCase()) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'application/pdf':
      return '.pdf';
    default:
      return '.bin';
  }
}

function stripDataUrlPrefix(raw: string): { mimeType?: string; base64: string } {
  const match = raw.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (match) return { mimeType: match[1], base64: match[2] };
  return { base64: raw };
}

/**
 * Normalize webchat `UserTurnAttachment` items into a uniform representation
 * usable by any external runtime driver (both local file paths for CLI tools
 * like Codex `localImage` and base64 payloads for ACP `image` content blocks).
 */
export function prepareExternalAttachments(input: {
  attachments?: UserTurnAttachment[];
  cwd: string;
  runId: string;
}): {
  attachments: ExternalTurnAttachment[];
  cleanup: () => void;
} {
  const raw = input.attachments ?? [];
  if (raw.length === 0) {
    return { attachments: [], cleanup: () => {} };
  }

  let stagedDir: string | undefined;
  const ensureStagedDir = () => {
    if (!stagedDir) {
      stagedDir = join(tmpdir(), `xopc-ext-att-${input.runId.replace(/[^a-zA-Z0-9_-]/g, '')}`);
      mkdirSync(stagedDir, { recursive: true });
    }
    return stagedDir;
  };

  const prepared: ExternalTurnAttachment[] = [];
  raw.forEach((item, index) => {
    const isImage = item.type === 'image' || (item.mimeType?.toLowerCase().startsWith('image/') ?? false);
    const kind: ExternalTurnAttachment['type'] = isImage ? 'image' : 'file';
    let mimeType = item.mimeType;
    let base64: string | undefined;
    let localPath: string | undefined;

    if (item.workspaceRelativePath?.trim()) {
      localPath = resolve(input.cwd, item.workspaceRelativePath.trim());
    }

    if (item.data?.trim()) {
      const stripped = stripDataUrlPrefix(item.data.trim());
      if (!mimeType && stripped.mimeType) mimeType = stripped.mimeType;
      const buf = Buffer.from(stripped.base64, 'base64');
      if (buf.byteLength <= MAX_INLINE_IMAGE_BYTES) {
        base64 = stripped.base64;
        if (!localPath) {
          const safeName = item.name?.replace(/[^a-zA-Z0-9._-]/g, '_')
            || `attachment-${index + 1}${extensionFromMimeType(mimeType)}`;
          localPath = join(ensureStagedDir(), safeName);
          writeFileSync(localPath, buf);
        }
      }
    } else if (isImage && localPath) {
      try {
        const buf = readFileSync(localPath);
        if (buf.byteLength <= MAX_INLINE_IMAGE_BYTES) {
          base64 = buf.toString('base64');
        }
      } catch {
        // Best-effort base64 load for ACP drivers.
      }
    }

    prepared.push({
      type: kind,
      ...(item.name ? { name: item.name } : {}),
      ...(mimeType ? { mimeType } : {}),
      ...(localPath ? { localPath } : {}),
      ...(base64 ? { base64 } : {}),
      ...(item.workspaceRelativePath ? { workspaceRelativePath: item.workspaceRelativePath } : {}),
    });
  });

  return {
    attachments: prepared,
    cleanup: () => {
      if (stagedDir) rmSync(stagedDir, { force: true, recursive: true });
    },
  };
}

/** Format non-image file attachments as concise context lines prepended to the prompt. */
export function formatFileAttachmentsContext(attachments: ReadonlyArray<ExternalTurnAttachment>): string {
  const files = attachments.filter((att) => att.type === 'file' && (att.workspaceRelativePath || att.localPath || att.name));
  if (files.length === 0) return '';
  const lines = files.map((file) => {
    const loc = file.workspaceRelativePath || file.localPath || file.name;
    return `- ${loc}${file.mimeType ? ` (${file.mimeType})` : ''}`;
  });
  return `Attached files:\n${lines.join('\n')}\n\n`;
}
