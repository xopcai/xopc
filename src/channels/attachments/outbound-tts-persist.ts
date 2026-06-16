/**
 * Persist outbound TTS audio to `{stateDir}/media/tts/`.
 */

import { createLogger } from '../../utils/logger.js';
import { saveMediaBuffer } from '../../media/index.js';
import type { MediaRef } from '../../media/types.js';

const log = createLogger('OutboundTtsPersist');

function extForFormat(format: string): string {
  const f = format.toLowerCase();
  if (f === 'opus' || f === 'ogg') return '.ogg';
  if (f === 'mp3' || f === 'mpeg') return '.mp3';
  if (f === 'wav') return '.wav';
  return '.bin';
}

function mimeForFormat(format: string): string {
  const f = format.toLowerCase();
  if (f === 'opus' || f === 'ogg') return 'audio/ogg';
  if (f === 'mp3' || f === 'mpeg') return 'audio/mpeg';
  if (f === 'wav') return 'audio/wav';
  return 'application/octet-stream';
}

export async function persistOutboundTtsAudio(
  audioBuffer: Buffer,
  format: string,
): Promise<MediaRef> {
  const ext = extForFormat(format);
  const saved = await saveMediaBuffer(audioBuffer, {
    contentType: mimeForFormat(format),
    bucket: 'tts',
    originalFilename: `assist${ext}`,
  });

  log.debug({ uri: saved.uri, bytes: saved.size }, 'TTS audio persisted');

  return {
    id: saved.id,
    bucket: 'tts',
    type: 'voice',
    mimeType: saved.contentType,
    name: saved.id,
    size: saved.size,
    uri: saved.uri,
    path: saved.path,
  };
}
