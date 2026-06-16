/**
 * Persist inbound uploads to the global media store (`{stateDir}/media/inbound/`).
 */

import { createLogger } from '../../utils/logger.js';
import {
  MEDIA_MAX_BYTES,
  parseMediaUri,
  readMediaReference,
  resolveMediaReference,
  saveMediaBuffer,
} from '../../media/index.js';
import type { InboundAttachmentInput, MediaRef } from '../../media/types.js';
import { mediaRefFromUri, toMediaRef } from './inbound-types.js';

const log = createLogger('InboundPersist');

export type { InboundAttachmentInput, MediaRef } from '../../media/types.js';
export { isImageInboundAttachment, isVoiceInboundAttachment } from './attachment-classifiers.js';
export { toMediaRef, mediaRefFromUri } from './inbound-types.js';

/** Decode base64 or data-URL payload (composer wire + voice STT). */
export function decodeInboundAttachmentBase64(data: string): Buffer {
  const trimmed = data.trim();
  const b64 = trimmed.startsWith('data:') ? (trimmed.split(/base64,/)[1] ?? trimmed) : trimmed;
  return Buffer.from(b64.replace(/\s/g, ''), 'base64');
}

/**
 * Write attachments with binary `data` to the media store; returns metadata-only refs.
 */
export async function persistInboundAttachments(
  attachments: InboundAttachmentInput[] | undefined,
  opts?: { maxBytes?: number },
): Promise<MediaRef[] | undefined> {
  if (!attachments?.length) return undefined;

  const maxBytes = opts?.maxBytes ?? MEDIA_MAX_BYTES;
  const out: MediaRef[] = [];

  for (const att of attachments) {
    if (att.uri?.trim()) {
      const resolved = await resolveMediaReference(att.uri.trim());
      out.push(
        mediaRefFromUri(att, resolved.uri, resolved.path, resolved.bucket, resolved.id),
      );
      continue;
    }

    if (!att.data || att.data.length === 0) {
      throw new Error(`Inbound attachment "${att.name ?? 'file'}" is missing data and uri`);
    }

    const buf = decodeInboundAttachmentBase64(att.data);
    const saved = await saveMediaBuffer(buf, {
      contentType: att.mimeType,
      bucket: 'inbound',
      maxBytes,
      originalFilename: att.name,
    });

    log.debug({ uri: saved.uri, bytes: saved.size, name: att.name }, 'Inbound attachment persisted');

    out.push(toMediaRef(att, saved));
  }

  return out.length ? out : undefined;
}

/** Read attachment bytes by media URI (voice STT, tools). */
export async function readInboundAttachmentBuffer(uri: string): Promise<Buffer> {
  const { buffer } = await readMediaReference(uri);
  return buffer;
}

export function assertMediaUri(uri: string): void {
  parseMediaUri(uri);
}
