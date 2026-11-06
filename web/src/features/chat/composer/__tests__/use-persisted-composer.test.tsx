// @vitest-environment jsdom
import { act, useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGatewayStore } from '@/stores/gateway-store';
import { deliverExternalIntake } from '../external-intake-receiver';
import { usePersistedComposer, type SavedEditSession } from '../use-persisted-composer';
import type { UseComposerEditorReturn } from '../use-composer-editor';
import type { UseComposerAttachmentsReturn } from '../use-composer-attachments';
import type { Attachment } from '../../attachments/attachment-utils';
import type { ComposerContextRef } from '../composer.types';

const storage = vi.hoisted(() => ({ reads: new Map<string, (value: unknown) => void>(), write: vi.fn() }));
vi.mock('../../session/local-session-drafts', () => ({ composerDraftStorage: (id: string) => ({
  read: () => new Promise(resolve => storage.reads.set(id, resolve)),
  write: (value: unknown) => storage.write(id, value),
}) }));
let savedEdit: SavedEditSession | undefined;
const restoreEditor = vi.fn();
let edit: (value: string) => void;
let text: string;
let fillDraft: () => void;
let clearDraft: () => void;
let visibleAttachments: Attachment[];
let visibleRefs: ComposerContextRef[];
const fixtureAttachment: Attachment = { id: 'file', type: 'document', name: 'draft.txt', mimeType: 'text/plain', size: 1, content: 'YQ==' };
const fixtureRef: ComposerContextRef = { kind: 'note', sourceId: 'note', expectedVersion: '1', title: 'Draft note' };
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function Harness({ id, handoffTarget }: { id: string | null; handoffTarget?: string }) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [refs, setRefs] = useState<ComposerContextRef[]>([]);
  const targetRef = useRef(handoffTarget); targetRef.current = handoffTarget;
  const getHandoffTarget = useCallback(() => targetRef.current, []);
  const valueRef = useRef(value); valueRef.current = value;
  const attachmentsRef = useRef(attachments); attachmentsRef.current = attachments;
  fillDraft = () => { setValue('private draft'); setAttachments([fixtureAttachment]); setRefs([fixtureRef]); };
  clearDraft = () => { setValue(''); setAttachments([]); setRefs([]); };
  edit = setValue; text = value;
  visibleAttachments = attachments; visibleRefs = refs;
  usePersistedComposer(id, { value, valueRef, resetEditor: options => {
    valueRef.current = options?.nextText ?? ''; setValue(valueRef.current);
  } } as UseComposerEditorReturn, { attachments, attachmentsRef, setAttachments: (next: Attachment[]) => { attachmentsRef.current = next; setAttachments(next); },
    clearAttachments: () => { attachmentsRef.current = []; setAttachments([]); } } as unknown as UseComposerAttachmentsReturn,
    refs, setRefs, savedEdit ? { snapshot: () => savedEdit!, restore: restoreEditor } : undefined,
    undefined, getHandoffTarget);
  return null;
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  savedEdit = undefined; restoreEditor.mockReset();
  storage.reads.clear(); storage.write.mockReset().mockResolvedValue(undefined);
  useGatewayStore.setState({ conversationId: 'gateway:principal' });
  container = document.createElement('div'); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); });
const render = async (id: string | null, handoffTarget?: string) => {
  await act(async () => root.render(<Harness id={id} handoffTarget={handoffTarget} />));
};
const restore = async (id: string, value: string) => { await act(async () => storage.reads.get(id)!({ text: value, attachments: [], refs: [] })); };

it('isolates the existing session draft when opening a new project composer', async () => {
  await render('existing');
  await restore('existing', '');
  await act(async () => fillDraft());

  await render(null);

  expect({ text, attachments: visibleAttachments, refs: visibleRefs }).toEqual({ text: '', attachments: [], refs: [] });
  expect(storage.write).toHaveBeenLastCalledWith('existing', expect.objectContaining({
    text: 'private draft', attachments: [fixtureAttachment], refs: [fixtureRef],
  }));
});

it.each([undefined, 'prepared'])('isolates an unrelated conversation while the preparation target is %s', async target => {
  await render(null);
  await act(async () => fillDraft());

  await render('existing', target);
  expect({ text, attachments: visibleAttachments, refs: visibleRefs }).toEqual({ text: '', attachments: [], refs: [] });
  await restore('existing', 'existing draft');
  expect(text).toBe('existing draft');
  expect(storage.write).not.toHaveBeenCalledWith('existing', expect.objectContaining({ text: 'private draft' }));
});

it('carries the full draft into its prepared session and deletes it after send', async () => {
  await render('previous');
  await restore('previous', 'previous draft');
  await render(null);
  await act(async () => fillDraft());

  await render('prepared', 'prepared');
  await act(async () => storage.reads.get('prepared')!(undefined));
  expect(storage.write).toHaveBeenLastCalledWith('prepared', expect.objectContaining({
    text: 'private draft', attachments: [fixtureAttachment], refs: [fixtureRef],
  }));
  await act(async () => clearDraft());
  expect(storage.write).toHaveBeenLastCalledWith('prepared', undefined);
});

it('restores persisted content and removes the record when the composer is cleared', async () => {
  await render('one'); await restore('one', 'unsent');
  expect(text).toBe('unsent');
  await act(async () => edit(''));
  expect(storage.write).toHaveBeenLastCalledWith('one', undefined);
});
it('waits for a sent draft to be deleted before restoring a remounted composer', async () => {
  await render('one');
  await restore('one', 'older draft');
  let finishSave!: () => void;
  storage.write.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve; }));
  await act(async () => edit('/skill:review https://example.test/pull/123'));
  await act(async () => edit(''));
  await act(async () => root.render(null));

  storage.reads.delete('one');
  await render('one');
  const readBeforeDeletion = storage.reads.get('one');
  if (readBeforeDeletion) {
    await restore('one', '/skill:review https://example.test/pull/123');
  }
  await act(async () => finishSave());
  if (!readBeforeDeletion) await act(async () => storage.reads.get('one')!(undefined));

  expect(storage.write).toHaveBeenLastCalledWith('one', undefined);
  expect(text).toBe('');
});
it('does not overwrite typing while storage is opening', async () => {
  await render('one'); await act(async () => edit('new typing'));
  await restore('one', 'older draft');
  expect(text).toBe('new typing');
  expect(storage.write).toHaveBeenLastCalledWith('one', expect.objectContaining({ text: 'new typing' }));
});
it('ignores a previous conversation hydration after navigation', async () => {
  await render('one'); await render('two'); await restore('one', 'wrong conversation');
  expect(text).toBe('');
  await restore('two', 'correct conversation');
  expect(text).toBe('correct conversation');
  expect(storage.write.mock.calls.some(([id, value]) => id === 'two' && value?.text === 'wrong conversation')).toBe(false);
});
it('does not resurrect a draft after typing and clearing during hydration', async () => {
  await render('one'); await act(async () => edit('new typing'));
  await act(async () => edit(''));
  await restore('one', 'older draft');
  expect(text).toBe('');
  expect(storage.write).toHaveBeenLastCalledWith('one', undefined);
});
it('persists edits before navigation even if the initial read is pending', async () => {
  await render('one'); await act(async () => edit('keep me'));
  await render('two');
  expect(storage.write).toHaveBeenCalledWith('one', expect.objectContaining({ text: 'keep me' }));
  await restore('one', 'outdated'); await restore('two', 'second');
  expect(text).toBe('second');
});

it('appends external attachments after hydration, preserves text and records delivery before acknowledgement', async () => {
  await render('one');
  const file: Attachment = { id: 'intake:file', type: 'image', name: 'photo.png', mimeType: 'image/png', size: 3, content: 'AAH/' };
  const delivery = deliverExternalIntake(JSON.stringify(['gateway:principal', 'one']), 'batch-1', [file]);
  await restore('one', 'keep this question');
  await act(async () => { await delivery; });
  expect(text).toBe('keep this question');
  expect(storage.write).toHaveBeenLastCalledWith('one', expect.objectContaining({
    text: 'keep this question', attachments: [file], intakeReceipts: ['batch-1'],
  }));
  await act(async () => { await deliverExternalIntake(JSON.stringify(['gateway:principal', 'one']), 'batch-1', [file]); });
  expect(storage.write.mock.calls.at(-1)?.[1].attachments).toEqual([file]);
});
it('does not acknowledge an import when draft persistence fails and permits a safe retry', async () => {
  await render('one'); await restore('one', 'question');
  const file: Attachment = { id: 'intake:file', type: 'document', name: 'a.txt', mimeType: 'text/plain', size: 1, content: 'YQ==' };
  storage.write.mockRejectedValueOnce(new Error('disk full'));
  await act(async () => {
    await expect(deliverExternalIntake(JSON.stringify(['gateway:principal', 'one']), 'batch-1', [file])).rejects.toThrow('disk full');
  });
  await act(async () => { await deliverExternalIntake(JSON.stringify(['gateway:principal', 'one']), 'batch-1', [file]); });
  expect(storage.write).toHaveBeenLastCalledWith('one', expect.objectContaining({ attachments: [file], intakeReceipts: ['batch-1'] }));
});

it('restores the editing identity and pre-edit drafts with the active draft', async () => {
  savedEdit = { mode: { kind: 'editFollowUp', inputId: 'pending', version: 2 },
    drafts: { compose: { text: 'Original unsent draft', attachments: [], contextRefs: [] } } };
  await render('one');
  await act(async () => storage.reads.get('one')!({ text: 'Edited follow-up', attachments: [], refs: [], editSession: savedEdit }));
  expect(text).toBe('Edited follow-up');
  expect(restoreEditor).toHaveBeenCalledWith(savedEdit);
  await act(async () => edit('New edit'));
  expect(storage.write).toHaveBeenLastCalledWith('one', expect.objectContaining({ text: 'New edit', editSession: savedEdit }));
});

it('does not resurrect an old editor when its identity changes during hydration', async () => {
  const oldEdit: SavedEditSession = { mode: { kind: 'editFollowUp', inputId: 'old', version: 1 }, drafts: {} };
  savedEdit = oldEdit;
  await render('one');
  savedEdit = { mode: { kind: 'compose' }, drafts: {} };
  await render('one');
  await act(async () => storage.reads.get('one')!({ text: 'Old edited text', attachments: [], refs: [], editSession: oldEdit }));
  expect(text).toBe('');
  expect(restoreEditor).not.toHaveBeenCalled();
});
