import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { DISCUSSION_AUDIO_MAX_BYTES, DISCUSSION_CHUNK_MAX_BYTES, DISCUSSION_MAX_DURATION_MS, type DiscussionRecordingChunk } from '@xopcai/gateway-contract';

import { resolveNoteMediaDir } from '../notes/paths.js';
import type { NotesService } from '../notes/service.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { forEachNormalizedAudioSegment } from '../voice/audio/normalize.js';
import { decodeWavToMonoFloat32 } from '../voice/local/wav.js';

import { DiscussionServiceError } from './errors.js';
import { getDiscussionCapture, updateDiscussionCapture } from './repository.js';
import type { DiscussionCapture } from './types.js';

const invalid = (message: string) => new DiscussionServiceError('invalid_input', message);
const directory = (capture: DiscussionCapture) => join(resolveNoteMediaDir(capture.noteId), '.recording');

export function listRecordingChunks(id: string): DiscussionRecordingChunk[] {
  return getSqliteDatabase().prepare('SELECT sequence, sha256, bytes FROM discussion_recording_chunks WHERE discussion_id = ? ORDER BY sequence').all(id) as unknown as DiscussionRecordingChunk[];
}

/** Called under the discussion mutation queue. Receipt follows durable disk write. */
export async function saveRecordingChunk(capture: DiscussionCapture, sequence: number, sha256: string, body: ReadableStream<Uint8Array>) {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 10_000 || !/^[a-f0-9]{64}$/.test(sha256)) throw invalid('Invalid recording chunk metadata');
  const chunks = listRecordingChunks(capture.id);
  const existing = chunks.find((chunk) => chunk.sequence === sequence);
  if (existing) {
    await body.cancel();
    if (existing.sha256 !== sha256) throw new DiscussionServiceError('conflict', 'Chunk already contains different audio');
    return existing;
  }
  const root = directory(capture);
  await mkdir(root, { recursive: true });
  const temporary = join(root, `${sequence}-${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx');
  const reader = body.getReader();
  const hash = createHash('sha256');
  let bytes = 0;
  const previousBytes = chunks.reduce((total, chunk) => total + chunk.bytes, 0);
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > DISCUSSION_CHUNK_MAX_BYTES || previousBytes + bytes > DISCUSSION_AUDIO_MAX_BYTES) throw invalid('Recording exceeds upload size limit');
      hash.update(next.value);
      await file.writeFile(next.value);
    }
    if (!bytes || hash.digest('hex') !== sha256) throw invalid('Recording chunk checksum mismatch');
    await file.sync();
    await file.close();
    const latest = getDiscussionCapture(capture.id);
    if (!latest || latest.status === 'cancelled' || latest.audioDeletedAt) throw new DiscussionServiceError('conflict', 'Recording was deleted or cancelled');
    await rename(temporary, join(root, String(sequence)));
    const dir = await open(root, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
    getSqliteDatabase().prepare('INSERT INTO discussion_recording_chunks (discussion_id, sequence, sha256, bytes) VALUES (?, ?, ?, ?)').run(capture.id, sequence, sha256, bytes);
    return { sequence, sha256, bytes };
  } finally {
    await reader.cancel().catch(() => undefined);
    await file.close().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}

export async function completeRecording(capture: DiscussionCapture, input: { chunkCount: number; mimeType: string; fileName: string }, notes: NotesService): Promise<DiscussionCapture> {
  const mimeType = input.mimeType.split(';')[0];
  if (!['audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4'].includes(mimeType!)) throw invalid('Unsupported audio type');
  const chunks = listRecordingChunks(capture.id);
  if (!Number.isSafeInteger(input.chunkCount) || input.chunkCount < 1 || chunks.length !== input.chunkCount || chunks.some((chunk, index) => chunk.sequence !== index)) throw invalid('Recording has missing chunks');
  const target = join(directory(capture), 'assembled');
  const file = await open(target, 'w');
  const hash = createHash('sha256');
  try {
  try {
    for (const chunk of chunks) {
      const chunkHash = createHash('sha256');
      let bytes = 0;
      try {
        for await (const buffer of createReadStream(join(directory(capture), String(chunk.sequence)))) {
          hash.update(buffer);
          chunkHash.update(buffer);
          bytes += buffer.length;
          await file.writeFile(buffer);
        }
        if (bytes !== chunk.bytes || chunkHash.digest('hex') !== chunk.sha256) throw invalid('Stored recording chunk is corrupt');
      } catch (error) {
        getSqliteDatabase().prepare('DELETE FROM discussion_recording_chunks WHERE discussion_id=? AND sequence=?').run(capture.id, chunk.sequence);
        throw error;
      }
    }
    await file.sync();
  } finally { await file.close(); }
    // Decode all media before accepting it, with bounded memory and duration.
    let durationMs = 0;
    await forEachNormalizedAudioSegment({ filePath: target, segmentSeconds: 30, maxDurationSeconds: DISCUSSION_MAX_DURATION_MS / 1_000, signal: AbortSignal.timeout(180_000) }, async (buffer) => {
      durationMs += decodeWavToMonoFloat32(buffer).durationSeconds * 1_000;
    });
    if (durationMs < 1_000) throw invalid('Recording must contain at least one second of audio');
    const latest = getDiscussionCapture(capture.id);
    if (!latest || latest.status === 'cancelled' || latest.audioDeletedAt) throw new DiscussionServiceError('conflict', 'Recording was deleted or cancelled');
    const audioSha256 = hash.digest('hex');
    const attachment = await notes.addAttachment(capture.noteId, {
      name: input.fileName.trim().slice(0, 200) || 'meeting.webm', buffer: { filePath: target }, mimeType: input.mimeType,
      duration: Math.round(durationMs / 1_000), retainWithoutReference: true,
    }, `meeting-recording:${capture.id}`);
    if (!attachment) throw new DiscussionServiceError('not_found', 'Discussion note not found');
    const persisted = await notes.getAttachmentPath(capture.noteId, attachment.id);
    if (!persisted) throw new Error('Saved recording file is missing');
    const savedFile = await open(persisted.filePath, 'r');
    try { await savedFile.sync(); } finally { await savedFile.close(); }
    const savedDirectory = await open(resolveNoteMediaDir(capture.noteId), 'r');
    try { await savedDirectory.sync(); } finally { await savedDirectory.close(); }

    const updated = updateDiscussionCapture(capture.id, {
      audioAttachmentId: attachment.id, mimeType: input.mimeType, audioSha256,
      durationMs: Math.round(durationMs), audioSizeBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
    }, ['recording', 'stopping', 'needs_attention']);
    if (!updated) throw new DiscussionServiceError('conflict', 'Recording changed while completing');
    await removeRecordingChunks(capture);
    return updated;
  } finally { await rm(target, { force: true }); }
}

export async function removeRecordingChunks(capture: DiscussionCapture): Promise<void> {
  await rm(directory(capture), { recursive: true, force: true });
  getSqliteDatabase().prepare('DELETE FROM discussion_recording_chunks WHERE discussion_id = ?').run(capture.id);
}
