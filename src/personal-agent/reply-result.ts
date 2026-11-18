import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';

import type { TurnOutcomeDeliverable } from '@xopcai/gateway-contract';

import { deleteMediaUris } from '../media/session-references.js';
import { MEDIA_ARTIFACT_MAX_BYTES, resolveMediaBufferPath, saveMediaBuffer } from '../media/store.js';
import { tryParseMediaUri } from '../media/uri.js';
import { isAvailableDeliverable } from '../tasks/task-deliverables.js';
import { createLogger } from '../utils/logger.js';
import type { PersonalReplyPacket } from './reply-composer.js';
import { sanitizePersonalResultFileLinks } from './result-file-links.js';

const log = createLogger('PersonalReplyComposer');
const INLINE_REPORT_LIMIT = 600;

export interface PersonalReplyResult {
  /** Absent when a file already delivered to the conversation contains the complete report. */
  attachment?: TurnOutcomeDeliverable & { uri: string };
}

export function isLongPersonalReport(report: string): boolean {
  return report.length > INLINE_REPORT_LIMIT && Array.from(report).length > INLINE_REPORT_LIMIT;
}

export async function preparePersonalReplyResult(packet: PersonalReplyPacket): Promise<PersonalReplyResult | undefined> {
  if (!isLongPersonalReport(packet.report)) return undefined;
  const bytes = Buffer.from(sanitizePersonalResultFileLinks(packet.report));
  if (!bytes.length) return undefined;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const existing = packet.delivery.outcome.deliverables.find(item => item.sha256 === sha256
    && item.uri?.startsWith('media://outbound/') && item.capabilities.includes('download')
    && isAvailableDeliverable(item, Date.now()));
  const mediaRef = existing?.uri && tryParseMediaUri(existing.uri);
  if (mediaRef && mediaRef.bucket === 'outbound') {
    const file = await lstat(resolveMediaBufferPath(mediaRef.id, mediaRef.bucket)).catch(() => undefined);
    if (file?.isFile() && file.size === bytes.length) return {};
  }
  const zh = /[\u3400-\u9fff]/u.test(packet.objective);
  try {
    const media = await saveMediaBuffer(bytes, {
      bucket: 'outbound', contentType: 'text/markdown', maxBytes: MEDIA_ARTIFACT_MAX_BYTES,
      originalFilename: 'full-result.md',
    });
    return { attachment: {
      artifactId: media.id, title: zh ? '完整结果.md' : 'Full result.md', kind: 'document',
      mimeType: media.contentType, sizeBytes: media.size, sha256, availability: 'available',
      location: 'artifact_store', uri: media.uri, capabilities: ['preview', 'download'],
    } };
  } catch (err) {
    log.warn({ err, taskRunId: packet.delivery.taskRunId }, 'Could not attach the full task result');
    return undefined;
  }
}

export async function releasePersonalReplyResult(result: PersonalReplyResult | undefined): Promise<void> {
  if (result?.attachment) await deleteMediaUris([result.attachment.uri]);
}
