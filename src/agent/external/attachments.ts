import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from '../../gateway/chat-limits.js';
import { readMediaReference } from '../../media/media-reference.js';
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
export async function prepareExternalAttachments(input: {
  attachments?: UserTurnAttachment[];
  cwd: string;
}): Promise<{
  attachments: ExternalTurnAttachment[];
  cleanup: () => Promise<void>;
}> {
  let stagedDir: string | undefined;
  const cleanup = async () => {
    if (stagedDir) await rm(stagedDir, { force: true, recursive: true });
  };

  const prepared: ExternalTurnAttachment[] = [];
  try {
    for (const [index, item] of (input.attachments ?? []).entries()) {
      const isImage = item.type === 'image' || Boolean(item.mimeType?.toLowerCase().startsWith('image/'));
      const maxBytes = isImage ? MAX_INLINE_IMAGE_BYTES : MAX_WEBCHAT_ATTACHMENT_FILE_BYTES;
      let mimeType = item.mimeType;
      let localPath: string | undefined;
      let bytes: Buffer | undefined;
      if (item.uri) {
        bytes = (await readMediaReference(item.uri, maxBytes)).buffer;
      } else if (item.data?.trim()) {
        const stripped = stripDataUrlPrefix(item.data.trim());
        mimeType ||= stripped.mimeType;
        bytes = Buffer.from(stripped.base64, 'base64');
      } else if (item.workspaceRelativePath?.trim()) {
        localPath = await realpath(resolve(input.cwd, item.workspaceRelativePath.trim()));
        const rel = relative(input.cwd, localPath);
        if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
          throw new Error('Attachment path is outside the workspace');
        }
        if (isImage) bytes = await readFile(localPath);
      } else {
        throw new Error(`Attachment "${item.name ?? index + 1}" has no readable content`);
      }

      if (bytes && bytes.byteLength > maxBytes) {
        throw new Error(`Attachment "${item.name ?? index + 1}" exceeds the external runtime size limit`);
      }
      if (bytes && !localPath) {
        stagedDir ??= await mkdtemp(join(tmpdir(), 'xopc-ext-att-'));
        const name = item.name?.replace(/[^a-zA-Z0-9._-]/g, '_') || `attachment${extensionFromMimeType(mimeType)}`;
        localPath = join(stagedDir, `${index + 1}-${name}`);
        await writeFile(localPath, bytes, { mode: 0o600 });
      }
      prepared.push({
        type: isImage ? 'image' : 'file',
        ...(item.name ? { name: item.name } : {}),
        ...(mimeType ? { mimeType } : {}),
        ...(localPath ? { localPath } : {}),
        ...(isImage && bytes ? { base64: bytes.toString('base64') } : {}),
      });
    }
  } catch (error) {
    await cleanup().catch(() => {});
    throw error;
  }
  return { attachments: prepared, cleanup };
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
