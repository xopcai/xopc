/**
 * Persist outbound TTS audio under `<workspace>/.xopcbot/tts/<session>/`.
 */

import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('OutboundTtsPersist');

export const TTS_REL_ROOT = '.xopcbot/tts';

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

export async function persistOutboundTtsAudio(
  workspaceRoot: string,
  sessionKey: string,
  audioBuffer: Buffer,
  format: string,
): Promise<{
  workspaceRelativePath: string;
  name: string;
  size: number;
}> {
  const sessionSeg = sanitizeSessionSegment(sessionKey);
  const dirAbs = resolve(workspaceRoot, '.xopcbot', 'tts', sessionSeg);
  await mkdir(dirAbs, { recursive: true });
  const ext = extForFormat(format);
  const fname = `assist_${Date.now()}_${randomBytes(4).toString('hex')}.${ext}`;
  const absFile = join(dirAbs, fname);
  await writeFile(absFile, audioBuffer);
  const workspaceRelativePath = ['.xopcbot', 'tts', sessionSeg, fname].join('/');
  log.debug({ sessionKey, workspaceRelativePath, bytes: audioBuffer.length }, 'TTS audio persisted');
  return {
    workspaceRelativePath,
    name: fname,
    size: audioBuffer.length,
  };
}

/**
 * Resolve a stored relative path under `.xopcbot/tts/` (same safety rules as inbound).
 */
export function resolveSafeTtsFilePath(workspaceRoot: string, relRaw: string): string | null {
  const rel = relRaw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.includes('..') || !rel.startsWith(`${TTS_REL_ROOT}/`)) {
    return null;
  }
  const abs = resolve(workspaceRoot, ...rel.split('/'));
  const root = resolve(workspaceRoot);
  if (!abs.startsWith(root)) {
    return null;
  }
  return abs;
}
