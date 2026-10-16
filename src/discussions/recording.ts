import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { DISCUSSION_AUDIO_MAX_BYTES, DISCUSSION_CHUNK_MAX_BYTES, DISCUSSION_MAX_DURATION_MS, type DiscussionRecordingChunk, type DiscussionRecordingManifest } from '@xopcai/gateway-contract';

import { resolveNoteMediaDir } from '../notes/paths.js';
import type { NotesService } from '../notes/service.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { forEachNormalizedAudioSegment } from '../voice/audio/normalize.js';
import { decodeWavToMonoFloat32 } from '../voice/audio/wav.js';

import { pcmEpoch, probeMediaEpoch, type MediaEpoch, type RecordingTimeline } from './media-timeline.js';
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

export function validateRecordingManifest(capture: DiscussionCapture, input: DiscussionRecordingManifest): void {
  if (input.containerMode !== undefined && (input.containerMode !== 'independent_wav' || input.mimeType !== 'audio/wav')) throw invalid('Unsupported recording container');
  if (input.events !== undefined && (!Array.isArray(input.events) || input.events.length > 1000 || input.events.some(event => !event || !Number.isSafeInteger(event.recordedAt) || event.recordedAt < 0 || !Number.isSafeInteger(event.savedMs) || event.savedMs < 0 || event.savedMs > DISCUSSION_MAX_DURATION_MS || !['start', 'resume', 'interrupted', 'seal'].includes(event.kind)))) throw invalid('Invalid recording events');
  if (input.epochs !== undefined) {
    if (input.containerMode || !Array.isArray(input.epochs) || input.epochs.length < 2 || input.epochs.length > 100
      || input.epochs.some((epoch, index) => !epoch || !Number.isSafeInteger(epoch.firstChunk)
        || (index === 0 ? epoch.firstChunk !== 0 : epoch.firstChunk <= input.epochs![index - 1]!.firstChunk)
        || epoch.firstChunk >= input.chunkCount || !Number.isSafeInteger(epoch.startedAt) || epoch.startedAt < 0
        || (epoch.previousEndedAt !== undefined && (!Number.isSafeInteger(epoch.previousEndedAt) || epoch.previousEndedAt < 0))
        || typeof epoch.mimeType !== 'string' || !['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav'].includes(epoch.mimeType.split(';')[0]!))) throw invalid('Invalid recording epochs');
  }
  const mimeType = input.mimeType.split(';')[0];
  if (!['audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4'].includes(mimeType!)) throw invalid('Unsupported audio type');
  const chunks = listRecordingChunks(capture.id);
  if (!Number.isSafeInteger(input.chunkCount) || input.chunkCount < 1 || chunks.length !== input.chunkCount || chunks.some((chunk, index) => chunk.sequence !== index)) throw invalid('Recording has missing chunks');
}

export async function completeRecording(capture: DiscussionCapture, input: DiscussionRecordingManifest, notes: NotesService, assertLease: () => void, signal: AbortSignal): Promise<DiscussionCapture> {
  validateRecordingManifest(capture, input);
  const chunks = listRecordingChunks(capture.id);
  const target = join(directory(capture), `assembled-${randomUUID()}`);
  const file = await open(target, 'w');
  const hash = createHash('sha256');
  let epochs: MediaEpoch[] | undefined;
  try {
  try {
    if (input.epochs) {
      epochs = await assembleEpochs(capture, input, notes, file, signal, assertLease);
    } else {
    if (input.containerMode === 'independent_wav') {
      const samples = chunks.reduce((total, chunk) => total + (chunk.bytes - 44) / 2, 0);
      if (!Number.isSafeInteger(samples) || samples <= 0 || samples > 16000 * DISCUSSION_MAX_DURATION_MS / 1000) throw invalid('Invalid PCM recording duration');
      const header = recordingWavHeader(samples);
      hash.update(header);
      await file.writeFile(header);
    }
    for (const chunk of chunks) {
      const chunkHash = createHash('sha256');
      let bytes = 0;
      try {
        if (input.containerMode === 'independent_wav') {
          signal.throwIfAborted();
          const buffers: Buffer[] = [];
          for await (const buffer of createReadStream(join(directory(capture), String(chunk.sequence)))) {
            signal.throwIfAborted();
            bytes += buffer.length;
            if (bytes > DISCUSSION_CHUNK_MAX_BYTES || bytes > chunk.bytes) throw invalid('Stored WAV chunk is corrupt');
            buffers.push(buffer);
          }
          const data = Buffer.concat(buffers, bytes);
          if (data.length !== chunk.bytes || data.length <= 44 || data.length > DISCUSSION_CHUNK_MAX_BYTES || data.length % 2 !== 0
            || !data.subarray(0, 44).equals(recordingWavHeader((data.length - 44) / 2))
            || createHash('sha256').update(data).digest('hex') !== chunk.sha256) throw invalid('Stored WAV chunk is corrupt');
          hash.update(data.subarray(44));
          await file.writeFile(data.subarray(44));
          continue;
        }
        for await (const buffer of createReadStream(join(directory(capture), String(chunk.sequence)))) {
          signal.throwIfAborted();
          hash.update(buffer);
          chunkHash.update(buffer);
          bytes += buffer.length;
          await file.writeFile(buffer);
        }
        if (bytes !== chunk.bytes || chunkHash.digest('hex') !== chunk.sha256) throw invalid('Stored recording chunk is corrupt');
      } catch (error) {
        if (!signal.aborted && (error instanceof DiscussionServiceError || (error as NodeJS.ErrnoException).code === 'ENOENT')) {
          assertLease();
          getSqliteDatabase().prepare('DELETE FROM discussion_recording_chunks WHERE discussion_id=? AND sequence=?').run(capture.id, chunk.sequence);
        }
        throw error;
      }
    }
    }
    await file.sync();
  } finally { await file.close(); }
    // Decode all media before accepting it, with bounded memory and duration.
    let durationMs = 0;
    await forEachNormalizedAudioSegment({ filePath: target, segmentSeconds: 30, maxDurationSeconds: DISCUSSION_MAX_DURATION_MS / 1_000, signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]) }, async (buffer) => {
      durationMs += decodeWavToMonoFloat32(buffer).durationSeconds * 1_000;
    });
    if (durationMs < 1_000) throw invalid('Recording must contain at least one second of audio');
    const latest = getDiscussionCapture(capture.id);
    if (!latest || latest.status === 'cancelled' || latest.audioDeletedAt) throw new DiscussionServiceError('conflict', 'Recording was deleted or cancelled');
    assertLease();
    const audioSha256 = input.epochs ? await hashFile(target, signal) : hash.digest('hex');
    const outputMime = input.epochs ? 'audio/wav' : input.mimeType;
    const timeline: RecordingTimeline = { primary: input.epochs || input.containerMode === 'independent_wav' || outputMime.includes('wav') ? 'pcm' : 'encoded',
      epochs: epochs ?? [outputMime.includes('wav') ? pcmEpoch(durationMs) : await probeMediaEpoch(target, durationMs, 0, signal)] };
    if (input.events?.length) {
      const events = await notes.addAttachment(capture.noteId, { name: `recording-events-${capture.id}.json`,
        buffer: Buffer.from(JSON.stringify({ version: 1, discussionId: capture.id, events: input.events })),
        mimeType: 'application/json', retainWithoutReference: true }, `meeting-events:${capture.id}`);
      if (!events) throw new Error('Discussion note is missing');
      const saved = await notes.getAttachmentPath(capture.noteId, events.id);
      if (!saved) throw new Error('Saved recording events are missing');
      const durable = await open(saved.filePath, 'r');
      try { await durable.sync(); } finally { await durable.close(); }
    }
    const attachment = await notes.addAttachment(capture.noteId, {
      name: input.epochs ? 'meeting-resumed.wav' : input.fileName.trim().slice(0, 200) || 'meeting.webm', buffer: { filePath: target }, mimeType: outputMime,
      duration: Math.round(durationMs / 1_000), retainWithoutReference: true,
    }, `meeting-recording:${capture.id}`);
    if (!attachment) throw new DiscussionServiceError('not_found', 'Discussion note not found');
    const persisted = await notes.getAttachmentPath(capture.noteId, attachment.id);
    if (!persisted) throw new Error('Saved recording file is missing');
    const savedFile = await open(persisted.filePath, 'r');
    try { await savedFile.sync(); } finally { await savedFile.close(); }
    const savedDirectory = await open(resolveNoteMediaDir(capture.noteId), 'r');
    try { await savedDirectory.sync(); } finally { await savedDirectory.close(); }

    const updated = runSqliteWriteTransaction(() => {
      assertLease();
      getSqliteDatabase().prepare('INSERT OR REPLACE INTO discussion_media_timeline (discussion_id,audio_sha256,timeline_json) VALUES (?,?,?)').run(capture.id, audioSha256, JSON.stringify(timeline));
      return updateDiscussionCapture(capture.id, {
        status: 'stopping',
        audioAttachmentId: attachment.id, mimeType: outputMime, audioSha256,
        durationMs: Math.round(durationMs), audioSizeBytes: attachment.size,
      }, ['recording', 'stopping', 'needs_attention']);
    });
    if (!updated) throw new DiscussionServiceError('conflict', 'Recording changed while completing');
    await removeRecordingChunks(capture);
    return updated;
  } finally { await rm(target, { force: true }); }
}

async function hashFile(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const buffer of createReadStream(path)) { signal.throwIfAborted(); hash.update(buffer); }
  return hash.digest('hex');
}

/** Independent recorder containers stay immutable; only decoded PCM is joined for playback/STT. */
async function assembleEpochs(capture: DiscussionCapture, input: DiscussionRecordingManifest, notes: NotesService,
  output: Awaited<ReturnType<typeof open>>, signal: AbortSignal, assertLease: () => void): Promise<MediaEpoch[]> {
  const epochs: MediaEpoch[] = [];
  const chunks = listRecordingChunks(capture.id);
  const sources: { attachmentId: string; sha256: string; firstChunk: number; startedAt: number; previousEndedAt?: number; durationMs: number }[] = [];
  let samples = 0;
  await output.writeFile(recordingWavHeader(0));
  for (const [index, epoch] of input.epochs!.entries()) {
    const path = join(directory(capture), `epoch-${randomUUID()}`);
    const source = await open(path, 'wx');
    try {
      try {
        const end = input.epochs![index + 1]?.firstChunk ?? chunks.length;
        for (const chunk of chunks.slice(epoch.firstChunk, end)) {
          try {
            let bytes = 0;
            const hash = createHash('sha256');
            for await (const buffer of createReadStream(join(directory(capture), String(chunk.sequence)))) {
              signal.throwIfAborted(); bytes += buffer.length; hash.update(buffer); await source.writeFile(buffer);
            }
            if (bytes !== chunk.bytes || hash.digest('hex') !== chunk.sha256) throw invalid('Stored recording chunk is corrupt');
          } catch (error) {
            if (!signal.aborted && (error instanceof DiscussionServiceError || (error as NodeJS.ErrnoException).code === 'ENOENT')) {
              assertLease();
              getSqliteDatabase().prepare('DELETE FROM discussion_recording_chunks WHERE discussion_id=? AND sequence=?').run(capture.id, chunk.sequence);
            }
            throw error;
          }
        }
        await source.sync();
      } finally { await source.close(); }
      let epochSamples = 0;
      await forEachNormalizedAudioSegment({ filePath: path, segmentSeconds: 30,
        maxDurationSeconds: DISCUSSION_MAX_DURATION_MS / 1000, signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]) }, async buffer => {
        const audio = decodeWavToMonoFloat32(buffer);
        const pcm = Buffer.alloc(audio.samples.length * 2);
        for (let i = 0; i < audio.samples.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(audio.samples[i]! * 32768))), i * 2);
        samples += audio.samples.length; epochSamples += audio.samples.length;
        if (samples > 16000 * DISCUSSION_MAX_DURATION_MS / 1000) throw invalid('Recording exceeds duration limit');
        await output.writeFile(pcm);
      });
      if (!epochSamples) throw invalid('Recording epoch has no decodable audio');
      const epochDuration = epochSamples / 16;
      epochs.push(epoch.mimeType.includes('wav') ? pcmEpoch(epochDuration, (samples - epochSamples) / 16) : await probeMediaEpoch(path, epochDuration, (samples - epochSamples) / 16, signal));
      assertLease(); signal.throwIfAborted();
      const sha256 = await hashFile(path, signal);
      const extension = epoch.mimeType.includes('mp4') ? 'm4a' : epoch.mimeType.includes('ogg') ? 'ogg' : epoch.mimeType.includes('wav') ? 'wav' : 'webm';
      const attachment = await notes.addAttachment(capture.noteId, { name: `recording-part-${capture.id}-${index + 1}.${extension}`,
        buffer: { filePath: path }, mimeType: epoch.mimeType, retainWithoutReference: true }, `meeting-source:${capture.id}:${index}:${sha256}`);
      if (!attachment) throw new Error('Discussion note is missing');
      const stored = await notes.getAttachmentPath(capture.noteId, attachment.id);
      if (!stored) throw new Error('Saved recording source is missing');
      const durable = await open(stored.filePath, 'r');
      try { await durable.sync(); } finally { await durable.close(); }
      sources.push({ ...epoch, attachmentId: attachment.id, sha256, durationMs: epochSamples / 16 });
    } finally { await rm(path, { force: true }); }
  }
  await output.write(recordingWavHeader(samples), 0, 44, 0);
  assertLease(); signal.throwIfAborted();
  const manifestAttachment = await notes.addAttachment(capture.noteId, { name: `recording-sources-${capture.id}.json`,
    buffer: Buffer.from(JSON.stringify({ version: 1, discussionId: capture.id, noteId: capture.noteId, sources })),
    mimeType: 'application/json', retainWithoutReference: true }, `meeting-sources:${capture.id}`);
  if (!manifestAttachment) throw new Error('Discussion note is missing');
  const manifestFile = await notes.getAttachmentPath(capture.noteId, manifestAttachment.id);
  if (!manifestFile) throw new Error('Saved recording manifest is missing');
  const durable = await open(manifestFile.filePath, 'r');
  try { await durable.sync(); } finally { await durable.close(); }
  return epochs;
}

function recordingWavHeader(samples: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + samples * 2, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36);
  header.writeUInt32LE(samples * 2, 40);
  return header;
}

export async function removeRecordingChunks(capture: DiscussionCapture): Promise<void> {
  await rm(directory(capture), { recursive: true, force: true });
  getSqliteDatabase().prepare('DELETE FROM discussion_recording_chunks WHERE discussion_id = ?').run(capture.id);
}
