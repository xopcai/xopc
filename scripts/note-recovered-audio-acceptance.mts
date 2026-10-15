/** Verify that a crashed browser's actual saved container passes the production ingestion pipeline. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const reportPath = resolve(process.argv[2] ?? 'docs/design/technical/note-recording-browser-2026-10-15.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(report.passed, true, 'Browser recovery must pass first');
const directory = mkdtempSync(join(tmpdir(), 'xopc-recovered-ingestion-'));
process.env.XOPC_STATE_DIR = directory;
process.env.XOPC_CONFIG_PATH = join(directory, 'xopc.json');
process.env.XOPC_CONFIG = process.env.XOPC_CONFIG_PATH;
process.env.XOPC_LOG_DIR = join(directory, 'logs');
process.env.XOPC_LOG_LEVEL = 'fatal';
writeFileSync(process.env.XOPC_CONFIG_PATH, '{}');
const { DISCUSSION_CHUNK_MAX_BYTES } = await import('../packages/gateway-contract/src/index.js');
const { openXopcDatabase, closeXopcDatabase } = await import('../src/storage/sqlite/index.js');
const { NotesService, NotesStore } = await import('../src/notes/index.js');
const { ProjectService } = await import('../src/projects/index.js');
const { DiscussionService } = await import('../src/discussions/service.js');
const { forEachNormalizedAudioSegment } = await import('../src/voice/audio/normalize.js');
const { decodeWavToMonoFloat32 } = await import('../src/voice/audio/wav.js');
const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
openXopcDatabase({ path: join(directory, 'xopc.db') });
try {
  const notes = new NotesService(new NotesStore()); await notes.initialize();
  const service = new DiscussionService(notes, new ProjectService());
  service.acknowledgeConsent(service.settings().consentPolicyVersion);
  const created = await service.create({ clientRequestId: crypto.randomUUID(), source: 'web', consentPolicyVersion: service.settings().consentPolicyVersion });
  const source = readFileSync(join(report.directory, 'recovered.webm'));
  let chunks = 0;
  for (let offset = 0; offset < source.length; offset += DISCUSSION_CHUNK_MAX_BYTES) {
    const chunk = source.subarray(offset, offset + DISCUSSION_CHUNK_MAX_BYTES);
    await service.uploadRecordingChunk(created.discussion.id, chunks++, sha256(chunk), new Blob([chunk]).stream());
  }
  await service.sealRecording(created.discussion.id, { chunkCount: chunks, mimeType: 'audio/webm', fileName: 'recovered.webm', lastSequence: -1 });
  await service.processRecordingJob();
  const detail = (await service.get(created.discussion.id))!;
  assert.ok(detail.discussion.audioAttachmentId, 'Production ingestion must attach the recovered original');
  const attached = await notes.getAttachmentPath(detail.note.id, detail.discussion.audioAttachmentId!);
  assert.equal(sha256(readFileSync(attached!.filePath)), sha256(source));
  let decodedDurationMs = 0;
  const segments = await forEachNormalizedAudioSegment({ filePath: attached!.filePath }, async buffer => {
    decodedDurationMs += decodeWavToMonoFloat32(buffer).durationSeconds * 1000;
  });
  assert.ok(Math.abs(decodedDurationMs - report.checks[0].savedDurationMs) < 1_000);
  report.gatewayIngestion = { passed: true, directory, chunks, segments, bytes: source.length,
    sha256: sha256(source), decodedDurationMs, attachmentId: detail.discussion.audioAttachmentId, discussionId: detail.discussion.id };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.gatewayIngestion));
} finally { closeXopcDatabase(); }
