import { beforeEach, expect, it, vi } from 'vitest';
import type { Note } from '../types.js';
import type { DiscussionDetail } from '../../discussions/types.js';

const mocks = vi.hoisted(() => ({ records: new Map<string, { payload: unknown; noteUpdatedAt: number; contextVersion: string }>(), transcribe: vi.fn() }));
vi.mock('../../storage/sqlite/index.js', () => ({
  getNoteAgentContextRecord: (id: string) => mocks.records.get(id),
  upsertNoteAgentContextRecord: (record: { noteId: string; payload: unknown; noteUpdatedAt: number; contextVersion: string }) => mocks.records.set(record.noteId, record),
}));
vi.mock('../../voice/stt/index.js', () => ({ isSTTAvailable: () => true, mergeSttConfigFromAppConfig: () => ({}), transcribe: mocks.transcribe }));
vi.mock('../../agent/image/understanding/runtime.js', () => ({ describeImagesWithFallback: vi.fn() }));
vi.mock('../../agent/image/tool-model-config.js', () => ({ resolveImageModelConfigForTool: () => undefined }));

import { buildNoteAgentContextArtifact } from '../agent-context.js';

const note = { id: 'note', title: 'Meeting', markdown: 'My own observations', kind: 'voice', status: 'inbox', remoteVersion: 3, createdAt: 1, updatedAt: 2,
  tags: [], attachments: [{ id: 'audio', type: 'audio', fileName: 'meeting.wav', mimeType: 'audio/wav', size: 100 }],
} as unknown as Note;
const meeting = () => ({ discussion: { id: 'meeting', audioAttachmentId: 'audio' }, transcript: { revision: 7, text: 'Confirmed words', segments: [
  { sequence: 1, status: 'confirmed', speakerLabel: 'A', rawText: 'Original', displayText: 'Corrected words' },
  { sequence: 2, status: 'transcribing', rawText: 'Unconfirmed words' },
] }, organization: { revision: 2, organization: { summary: 'Published conclusion' } } }) as unknown as DiscussionDetail;
const notesService = { getAttachmentPath: vi.fn(), updateNote: vi.fn() };
beforeEach(() => { mocks.records.clear(); vi.clearAllMocks(); });

it('provides versioned meeting references and editable personal Markdown without transcribing audio again', async () => {
  const result = await buildNoteAgentContextArtifact({ note, notesService, meeting: meeting() });
  expect(result.text).toContain('My own observations');
  expect(result.text).toContain('Published conclusion');
  expect(result.text).toContain('[segment 1] A: Corrected words');
  expect(result.text).not.toContain('Unconfirmed words');
  expect(result.text).toContain('expectedRevision');
  expect(result.contextVersion).toBe('2:meeting:7:2');
  expect(notesService.getAttachmentPath).not.toHaveBeenCalled();
  expect(mocks.transcribe).not.toHaveBeenCalled();
});

it('invalidates the context cache when meeting text changes independently of the note', async () => {
  const first = await buildNoteAgentContextArtifact({ note, notesService, meeting: meeting() });
  const newer = meeting(); newer.transcript.revision = 8; newer.transcript.segments[0]!.displayText = 'Latest correction';
  const second = await buildNoteAgentContextArtifact({ note, notesService, meeting: newer });
  expect(second.contextVersion).not.toBe(first.contextVersion);
  expect(second.text).toContain('Latest correction');
  expect(second.text).not.toContain('Corrected words');
});

it('retains normal note context versions for notes without a meeting', async () => {
  const result = await buildNoteAgentContextArtifact({ note: { ...note, attachments: [] }, notesService });
  expect(result.contextVersion).toBe('2');
  expect(result.text).not.toContain('Meeting reference');
});
