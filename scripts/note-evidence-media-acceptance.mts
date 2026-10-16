import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import type { DiscussionAnnotation } from '@xopcai/gateway-contract';
import { getSqliteDatabase } from '../src/storage/sqlite/transaction.js';
import { DiscussionService } from '../src/discussions/service.js';
import { replaceTranscriptSegments } from '../src/discussions/revisions.js';
import { getDiscussionCapture,updateDiscussionCapture } from '../src/discussions/repository.js';
import { NotesService,NotesStore } from '../src/notes/index.js';
import { ProjectService } from '../src/projects/index.js';
import { openXopcDatabase,closeXopcDatabase,resetXopcDatabaseSingletonForTest } from '../src/storage/sqlite/index.js';
import { forEachNormalizedAudioSegment } from '../src/voice/audio/normalize.js';
import { decodeWavToMonoFloat32 } from '../src/voice/audio/wav.js';

const reportPath = resolve(process.argv[2] ?? 'docs/design/technical/note-evidence-browser-2026-10-16.json');
const report = JSON.parse(await readFile(reportPath,'utf8'));
assert.equal(report.passed,true);
const directory = await mkdtemp(join(tmpdir(),'xopc-evidence-media-'));
process.env.XOPC_STATE_DIR = directory;
resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory,'xopc.db') });
const notes = new NotesService(new NotesStore()); await notes.initialize();
const service = new DiscussionService(notes,new ProjectService());
const consentPolicyVersion = service.settings().consentPolicyVersion; service.acknowledgeConsent(consentPolicyVersion);
const checks: unknown[] = [];
try {
  for (const scenario of [{ name: 'recovered',marks: report.originalMarks },{ name: 'paused',marks: report.pausedMarks }]) {
    const source = await readFile(join(report.directory,`${scenario.name}.webm`));
    const original: DiscussionAnnotation = scenario.marks[0].annotation;
    assert.ok(original.anchor.offsetMs !== undefined);
    const createInput = { clientRequestId: `evidence-${scenario.name}`,consentPolicyVersion,source: 'web' as const };
    const created = await service.create(createInput); const id = created.discussion.id;
    await service.uploadRecordingChunk(id,0,createHash('sha256').update(source).digest('hex'),new Blob([source]).stream());
    await service.sealRecording(id,{ chunkCount: 1,lastSequence: -1,mimeType: 'audio/webm',fileName: 'original.webm' }); await service.processRecordingJob();
    assert.equal(service.recordingJob(id)?.state,'completed');
    const capture = getDiscussionCapture(id)!; const duration = capture.durationMs!;
    replaceTranscriptSegments(id,Array.from({ length: Math.ceil(duration / 1000) },(_,index) => ({ text: `Verified source interval ${index}`,startedAtMs: index * 1000,endedAtMs: Math.min(duration,(index + 1) * 1000) })));
    service.saveAnnotation(id,{ id: original.id,kind: original.kind,text: 'Synthetic microphone acceptance highlight',anchor: original.anchor,expectedRevision: 0 });
    const mark = (await service.annotations(id))[0];
    if (mark.state !== 'located') console.log(JSON.stringify({ scenario: scenario.name,anchor: original.anchor,duration,timeline: getSqliteDatabase().prepare('SELECT timeline_json FROM discussion_media_timeline WHERE discussion_id=?').get(id) }));
    assert.equal(mark.state,'located'); assert.ok(mark.evidence?.segments.length);
    if (original.anchor.coordinate === 'pcm') assert.ok(Math.abs(original.anchor.offsetMs! - mark.positionMs!) < 1,'Packet audio time must locate the actual decoded transcript despite pause timestamps');
    const range = mark.playback[0]; assert.ok(range);
    const clip = await service.audioClip(id,range.startedAtMs,range.endedAtMs,new AbortController().signal);
    const path = join(directory,`${scenario.name}-clip.wav`); await writeFile(path,clip);
    let decoded = 0;
    await forEachNormalizedAudioSegment({ filePath: path },async bytes => { decoded += decodeWavToMonoFloat32(bytes).durationSeconds * 1000; });
    assert.ok(Math.abs(decoded - (range.endedAtMs - range.startedAtMs)) < 100);
    const version = service.transcript(id)!;
    const referenced = mark.evidence!.segments[0];
    service.saveAnnotation(id,{ id: 'historical',kind: 'question',text: 'My interpretation, not a recording fact',anchor: { type: 'transcript',capturedAt: Date.now(),transcriptRevision: version.revision,segmentIds: [referenced.sequence] },expectedRevision: 0 });
    service.correctSegment(id,referenced.sequence,'Corrected current source',version.segments.find(segment => segment.sequence === referenced.sequence)!.revision);
    const historical = (await service.annotations(id)).find(row => row.annotation.id === 'historical')!;
    assert.equal(historical.evidence!.stale,true); assert.equal(historical.evidence!.segments[0].text,referenced.text);
    assert.equal((await service.create(createInput)).note.id,created.note.id);
    checks.push({ scenario: scenario.name,noteId: created.note.id,sourceSha256: capture.audioSha256,markerCoordinate: original.anchor.coordinate ?? 'encoded',markerOffsetMs: original.anchor.offsetMs,normalizedMarkerMs: mark.positionMs,playback: mark.playback,clipDurationMs: decoded,historicalRevision: historical.evidence!.transcriptRevision });
    updateDiscussionCapture(id,{ status: 'needs_attention' });
  }
  closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory,'xopc.db') });
  const restartedNotes = new NotesService(new NotesStore()); await restartedNotes.initialize();
  const restarted = new DiscussionService(restartedNotes,new ProjectService());
  for (const capture of restarted.list().items) {
    const annotations = await restarted.annotations(capture.id); assert.equal(annotations.length,2);
    assert.equal(annotations.find(row => row.annotation.id === 'historical')!.evidence!.stale,true);
  }
  assert.equal(restarted.list().total,2);
  report.gatewayEvidence = { passed: true,directory,checks,sqliteRestartRetainsAnnotations: true };
  await writeFile(reportPath,JSON.stringify(report,null,2) + '\n');
  console.log(JSON.stringify({ passed: true,reportPath,checks: checks.length }));
} finally { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); }
