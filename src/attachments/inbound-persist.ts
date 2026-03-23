/**
 * Persist inbound channel / Web UI uploads under the configured workspace so
 * session transcripts can reference stable paths (read_file + Web UI preview).
 */

import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { createLogger } from '../utils/logger.js';

const log = createLogger('InboundPersist');

/** Files live under `<workspace>/.xopcbot/inbound/<session>/` */
export const INBOUND_REL_ROOT = '.xopcbot/inbound';

export interface InboundAttachmentInput {
  type: string;
  mimeType?: string;
  data?: string;
  name?: string;
  size?: number;
  /** Set after persist */
  workspaceRelativePath?: string;
}

function sanitizeSessionSegment(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 180) || 'session';
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'file';
  return base.slice(0, 200);
}

function isImageAttachment(att: InboundAttachmentInput): boolean {
  return att.type === 'image' || att.type === 'photo' || att.mimeType?.startsWith('image/') === true;
}

function decodeBase64Payload(data: string): Buffer {
  const trimmed = data.trim();
  const b64 = trimmed.startsWith('data:') ? (trimmed.split(/base64,/)[1] ?? trimmed) : trimmed;
  return Buffer.from(b64.replace(/\s/g, ''), 'base64');
}

/**
 * Write non-image attachments with binary data to disk; returns a shallow copy
 * of each attachment with `workspaceRelativePath` set (POSIX-style, `/` separators).
 */
export async function persistInboundAttachmentsToWorkspace(
  workspaceRoot: string,
  sessionKey: string,
  attachments: InboundAttachmentInput[] | undefined,
): Promise<InboundAttachmentInput[] | undefined> {
  if (!attachments?.length) return attachments;

  const sessionSeg = sanitizeSessionSegment(sessionKey);
  const inboundAbs = resolve(workspaceRoot, '.xopcbot', 'inbound', sessionSeg);
  await mkdir(inboundAbs, { recursive: true });

  const out: InboundAttachmentInput[] = [];

  for (const att of attachments) {
    if (att.workspaceRelativePath) {
      out.push({ ...att });
      continue;
    }
    if (isImageAttachment(att)) {
      out.push({ ...att });
      continue;
    }
    if (!att.data || att.data.length === 0) {
      out.push({ ...att });
      continue;
    }

    try {
      const buf = decodeBase64Payload(att.data);
      const id = randomBytes(8).toString('hex');
      const fname = `${id}_${sanitizeFilename(att.name || 'file')}`;
      const absFile = join(inboundAbs, fname);
      await writeFile(absFile, buf);

      const workspaceRelativePath = ['.xopcbot', 'inbound', sessionSeg, fname].join('/');

      log.debug({ sessionKey, workspaceRelativePath, bytes: buf.length }, 'Inbound file persisted');

      out.push({
        ...att,
        workspaceRelativePath,
        size: att.size ?? buf.length,
      });
    } catch (err) {
      log.warn({ err, sessionKey, name: att.name }, 'Failed to persist inbound attachment');
      out.push({ ...att });
    }
  }

  return out;
}

/**
 * Build transcript text for a non-image file for the LLM (includes machine-readable path lines).
 */
export function formatInboundFileTextBlock(
  att: InboundAttachmentInput,
  workspaceRootAbs: string,
): string {
  const name = att.name || 'unknown';
  const mime = att.mimeType || 'unknown type';
  const size = att.size ?? 0;
  const head = `[File: ${name} (${mime}, ${size} bytes)]`;
  if (!att.workspaceRelativePath) {
    return head;
  }
  const rel = att.workspaceRelativePath.replace(/\\/g, '/');
  const abs = resolve(workspaceRootAbs, ...rel.split('/').filter(Boolean));
  return `${head}\nxopcbot-path:rel:${rel}\nxopcbot-path:abs:${abs}`;
}

/**
 * Remove inbound file transcript blocks from a string (e.g. auto session titles).
 * Matches Web UI `stripInboundFileMachineText`, plus bare `[File: …]` lines when paths are absent.
 */
export function stripInboundFileMetadataFromText(text: string): string {
  if (!text.includes('[File:') && !text.includes('xopcbot-path:')) return text;
  let out = text;
  out = out.replace(
    /\s*\[File:[^\]]+\]\s*\r?\nxopcbot-path:rel:[^\r\n]+\r?\n\s*xopcbot-path:abs:[^\r\n]+/g,
    '',
  );
  out = out.replace(/\s*\[File:[^\]]+\]\s+xopcbot-path:rel:\S+\s+xopcbot-path:abs:\S+/g, '');
  out = out.replace(/\s*\[File:[^\]]+\]\s*xopcbot-path:rel:\S+\s*xopcbot-path:abs:\S+/g, '');
  out = out.replace(/\s*\[File:[^\]]+\]\s*/g, ' ');
  return out.replace(/\n{3,}/g, '\n\n').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Resolve a stored relative path and ensure it stays under workspace `.xopcbot/inbound/`.
 */
export function resolveSafeInboundFilePath(workspaceRoot: string, relRaw: string): string | null {
  const rel = relRaw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.includes('..') || !rel.startsWith(`${INBOUND_REL_ROOT}/`)) {
    return null;
  }
  const abs = resolve(workspaceRoot, ...rel.split('/'));
  const root = resolve(workspaceRoot);
  if (!abs.startsWith(root)) {
    return null;
  }
  return abs;
}
