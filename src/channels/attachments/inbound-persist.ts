/**
 * Persist inbound channel / Web UI uploads under the agent home dir so the markdown
 * workspace stays user-visible; session transcripts reference stable relative paths.
 */

import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { createLogger } from '../../utils/logger.js';
import { migrateTreeIfTargetMissing } from '../../config/migrate-internal-state.js';

const log = createLogger('InboundPersist');

/** New layout: `<agentHome>/inbound/<session>/` — rel paths use this prefix. */
export const INBOUND_REL_ROOT = 'inbound';

/** Legacy prefix under markdown workspace (still accepted for resolution). */
export const LEGACY_INBOUND_REL_PREFIX = '.xopcbot/inbound';

export interface InboundAttachmentInput {
  type: string;
  mimeType?: string;
  data?: string;
  name?: string;
  size?: number;
  /** Set after persist (relative to agent home or legacy workspace `.xopcbot/inbound/`). */
  workspaceRelativePath?: string;
}

export type InternalAttachmentRoots = {
  /** `…/agents/<id>/` — primary storage */
  agentHome: string;
  /** Markdown workspace; used to resolve legacy `.xopcbot/inbound/` paths */
  legacyWorkspace?: string;
};

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

/** Decode base64 or data-URL payload for inbound attachments (also used by voice STT). */
export function decodeInboundAttachmentBase64(data: string): Buffer {
  const trimmed = data.trim();
  const b64 = trimmed.startsWith('data:') ? (trimmed.split(/base64,/)[1] ?? trimmed) : trimmed;
  return Buffer.from(b64.replace(/\s/g, ''), 'base64');
}

function resolveUnderRoot(root: string, rel: string, requiredPrefix: string): string | null {
  const normalized = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..') || !normalized.startsWith(requiredPrefix)) {
    return null;
  }
  const abs = resolve(root, ...normalized.split('/'));
  const rootResolved = resolve(root);
  if (!abs.startsWith(rootResolved)) {
    return null;
  }
  return abs;
}

/**
 * Write non-image attachments with binary data to disk; returns a shallow copy
 * of each attachment with `workspaceRelativePath` set (POSIX-style, `/` separators).
 */
export async function persistInboundAttachmentsToWorkspace(
  agentHomeRoot: string,
  sessionKey: string,
  attachments: InboundAttachmentInput[] | undefined,
): Promise<InboundAttachmentInput[] | undefined> {
  if (!attachments?.length) return attachments;

  const sessionSeg = sanitizeSessionSegment(sessionKey);
  const inboundAbs = resolve(agentHomeRoot, INBOUND_REL_ROOT, sessionSeg);
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
      const buf = decodeInboundAttachmentBase64(att.data);
      const id = randomBytes(8).toString('hex');
      const fname = `${id}_${sanitizeFilename(att.name || 'file')}`;
      const absFile = join(inboundAbs, fname);
      await writeFile(absFile, buf);

      const workspaceRelativePath = [INBOUND_REL_ROOT, sessionSeg, fname].join('/');

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
  storageRootAbs: string,
): string {
  const name = att.name || 'unknown';
  const mime = att.mimeType || 'unknown type';
  const size = att.size ?? 0;
  const head = `[File: ${name} (${mime}, ${size} bytes)]`;
  if (!att.workspaceRelativePath) {
    return head;
  }
  const rel = att.workspaceRelativePath.replace(/\\/g, '/');
  const abs = resolve(storageRootAbs, ...rel.split('/').filter(Boolean));
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
 * Resolve a stored relative path under `inbound/` or legacy `.xopcbot/inbound/`.
 */
export function resolveSafeInboundFilePath(
  roots: InternalAttachmentRoots,
  relRaw: string,
): string | null {
  const rel = relRaw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.includes('..')) {
    return null;
  }

  if (rel.startsWith(`${INBOUND_REL_ROOT}/`)) {
    return resolveUnderRoot(roots.agentHome, rel, `${INBOUND_REL_ROOT}/`);
  }

  if (rel.startsWith(`${LEGACY_INBOUND_REL_PREFIX}/`)) {
    const legacy = roots.legacyWorkspace ?? roots.agentHome;
    const fromLegacy = resolveUnderRoot(legacy, rel, `${LEGACY_INBOUND_REL_PREFIX}/`);
    if (fromLegacy) {
      return fromLegacy;
    }
    return resolveUnderRoot(roots.agentHome, rel, `${LEGACY_INBOUND_REL_PREFIX}/`);
  }

  return null;
}

/** Move legacy `<workspace>/.xopcbot/inbound` → `<agentHome>/inbound` when the target tree is absent. */
export function migrateLegacyInboundTree(agentHome: string, legacyWorkspace: string): void {
  migrateTreeIfTargetMissing(
    join(agentHome, INBOUND_REL_ROOT),
    join(legacyWorkspace, '.xopcbot', 'inbound'),
  );
}
