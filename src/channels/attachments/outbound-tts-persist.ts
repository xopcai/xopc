/**
 * Persist outbound TTS audio under `<agentHome>/tts/<session>/`.
 */

import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { createLogger } from '../../utils/logger.js';
import { migrateTreeIfTargetMissing } from '../../config/migrate-internal-state.js';
import type { InternalAttachmentRoots } from './inbound-persist.js';

const log = createLogger('OutboundTtsPersist');

export const TTS_REL_ROOT = 'tts';

export const LEGACY_TTS_REL_PREFIX = '.xopcbot/tts';

function sanitizeSessionSegment(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 180) || 'session';
}

function extForFormat(format: string): string {
  const f = format.toLowerCase();
  if (f === 'opus' || f === 'ogg') return 'ogg';
  if (f === 'mp3' || f === 'mpeg') return 'mp3';
  if (f === 'wav') return 'wav';
  return 'bin';
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

export async function persistOutboundTtsAudio(
  agentHomeRoot: string,
  sessionKey: string,
  audioBuffer: Buffer,
  format: string,
): Promise<{
  workspaceRelativePath: string;
  name: string;
  size: number;
}> {
  const sessionSeg = sanitizeSessionSegment(sessionKey);
  const dirAbs = resolve(agentHomeRoot, TTS_REL_ROOT, sessionSeg);
  await mkdir(dirAbs, { recursive: true });
  const ext = extForFormat(format);
  const fname = `assist_${Date.now()}_${randomBytes(4).toString('hex')}.${ext}`;
  const absFile = join(dirAbs, fname);
  await writeFile(absFile, audioBuffer);
  const workspaceRelativePath = [TTS_REL_ROOT, sessionSeg, fname].join('/');
  log.debug({ sessionKey, workspaceRelativePath, bytes: audioBuffer.length }, 'TTS audio persisted');
  return {
    workspaceRelativePath,
    name: fname,
    size: audioBuffer.length,
  };
}

/**
 * Resolve a stored relative path under `tts/` or legacy `.xopcbot/tts/`.
 */
export function resolveSafeTtsFilePath(roots: InternalAttachmentRoots, relRaw: string): string | null {
  const rel = relRaw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.includes('..')) {
    return null;
  }

  if (rel.startsWith(`${TTS_REL_ROOT}/`)) {
    return resolveUnderRoot(roots.agentHome, rel, `${TTS_REL_ROOT}/`);
  }

  if (rel.startsWith(`${LEGACY_TTS_REL_PREFIX}/`)) {
    const legacy = roots.legacyWorkspace ?? roots.agentHome;
    const fromLegacy = resolveUnderRoot(legacy, rel, `${LEGACY_TTS_REL_PREFIX}/`);
    if (fromLegacy) {
      return fromLegacy;
    }
    return resolveUnderRoot(roots.agentHome, rel, `${LEGACY_TTS_REL_PREFIX}/`);
  }

  return null;
}

export function migrateLegacyTtsTree(agentHome: string, legacyWorkspace: string): void {
  migrateTreeIfTargetMissing(
    join(agentHome, TTS_REL_ROOT),
    join(legacyWorkspace, '.xopcbot', 'tts'),
  );
}
