import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ chunk: vi.fn(), annotations: vi.fn() }));
vi.mock('../discussion-annotation-store', () => ({ listLocalAnnotations: mocks.annotations }));
vi.mock('../discussion-draft-store', () => ({ getDiscussionDraftChunk: mocks.chunk }));
import { recordingRecoveryArchive, canExportOriginal, originalRecordingBytes } from '../recording-local-export';
import type { DiscussionDraft } from '../discussion-types';
const draft: DiscussionDraft = { id: 'recording', startedAt: 1, updatedAt: 4, mimeType: 'audio/webm',
  durationMs: 6000, chunkCount: 3, state: 'stopped', lastSequence: -1,
  epochs: [{ firstChunk: 0, mimeType: 'audio/webm', startedAt: 1 }, { firstChunk: 2, mimeType: 'audio/webm', startedAt: 9000, previousEndedAt: 4 }] };
beforeEach(() => { vi.stubGlobal('Blob', NodeBlob); mocks.chunk.mockReset(); mocks.annotations.mockResolvedValue([]); });
afterEach(() => vi.unstubAllGlobals());
it('exports retained original bytes with hashes, epoch boundaries and explicit missing chunks', async () => {
  mocks.chunk.mockImplementation(async (_id: string, index: number) => index === 1 ? undefined : { blob: new Blob([`original-${index}`]) });
  const parts: Uint8Array[] = [];
  for await (const part of recordingRecoveryArchive(draft)) parts.push(part);
  const archive = Buffer.concat(parts);
  const entries: Record<string, Buffer> = {};
  for (let offset = 0; archive[offset];) {
    const header = archive.subarray(offset, offset + 512);
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0/g, ''), 8);
    const name = header.subarray(0, 100).toString().split('\0')[0];
    entries[name] = archive.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  expect(entries['chunks/000000.bin'].toString()).toBe('original-0');
  expect(entries['chunks/000002.bin'].toString()).toBe('original-2');
  const manifest = JSON.parse(entries['manifest.json'].toString());
  expect(manifest.draft.epochs).toEqual(draft.epochs);
  expect(manifest.chunks[1]).toEqual({ index: 1, missing: true });
  expect(manifest.chunks[0].sha256).toHaveLength(64);
});
it('reads one chunk on demand and propagates export failures without deleting source audio', async () => {
  mocks.chunk.mockResolvedValueOnce({ blob: new Blob(['original']) }).mockRejectedValue(new Error('DISK_READ_FAILED'));
  const stream = recordingRecoveryArchive(draft);
  await stream.next(); expect(mocks.chunk).toHaveBeenCalledTimes(1);
  await stream.next(); await stream.next();
  await expect(stream.next()).rejects.toThrow('DISK_READ_FAILED');
});

it('exports a proven single container byte-for-byte and chooses a recovery package for interrupted or resumed media', async () => {
  const single = { ...draft, epochs: undefined, chunkCount: 1, saveOutcome: 'complete' as const,
    mediaCoverage: { version: 1 as const, status: 'verified' as const, verifiedThroughMs: 3000, observedThroughMs: 3000, committedChunkCount: 1 } };
  expect(canExportOriginal(single)).toBe(true); expect(canExportOriginal({ ...single, saveOutcome: 'interrupted' })).toBe(false);
  expect(canExportOriginal({ ...single, epochs: draft.epochs })).toBe(false);
  mocks.chunk.mockResolvedValue({ blob: new Blob(['immutable original']) });
  const parts: Uint8Array[] = []; for await (const part of originalRecordingBytes(single)) parts.push(part);
  expect(Buffer.concat(parts).toString()).toBe('immutable original');
});

it('exports retained source even when the separate annotation store cannot be read', async () => {
  mocks.annotations.mockRejectedValue(new Error('ANNOTATION_DB_UNAVAILABLE')); mocks.chunk.mockResolvedValue({ blob: new Blob(['original']) });
  const parts: Uint8Array[] = []; for await (const part of recordingRecoveryArchive({ ...draft,chunkCount: 1 })) parts.push(part);
  const text = Buffer.concat(parts).toString(); expect(text).toContain('original'); expect(text).toContain('annotationReadError'); expect(text).toContain('ANNOTATION_DB_UNAVAILABLE');
});
