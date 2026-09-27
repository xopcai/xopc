// @vitest-environment jsdom
import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGatewayStore } from '@/stores/gateway-store';
import { usePersistedComposer } from '../use-persisted-composer';
import type { UseComposerEditorReturn } from '../use-composer-editor';
import type { UseComposerAttachmentsReturn } from '../use-composer-attachments';
import type { Attachment } from '../../attachments/attachment-utils';
import type { ComposerContextRef } from '../composer.types';

const storage = vi.hoisted(() => ({ reads: new Map<string, (value: unknown) => void>(), write: vi.fn() }));
vi.mock('../../session/local-session-drafts', () => ({ composerDraftStorage: (id: string) => ({
  read: () => new Promise(resolve => storage.reads.set(id, resolve)),
  write: (value: unknown) => storage.write(id, value),
}) }));
let edit: (value: string) => void;
let text: string;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function Harness({ id }: { id: string }) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [refs, setRefs] = useState<ComposerContextRef[]>([]);
  const valueRef = useRef(value); valueRef.current = value;
  const attachmentsRef = useRef(attachments); attachmentsRef.current = attachments;
  edit = setValue; text = value;
  usePersistedComposer(id, { value, valueRef, resetEditor: options => {
    valueRef.current = options?.nextText ?? ''; setValue(valueRef.current);
  } } as UseComposerEditorReturn, { attachments, attachmentsRef, setAttachments,
    clearAttachments: () => setAttachments([]) } as unknown as UseComposerAttachmentsReturn, refs, setRefs);
  return null;
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  storage.reads.clear(); storage.write.mockReset().mockResolvedValue(undefined);
  useGatewayStore.setState({ conversationId: 'gateway:principal' });
  container = document.createElement('div'); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); });
const render = async (id: string) => { await act(async () => root.render(<Harness id={id} />)); };
const restore = async (id: string, value: string) => { await act(async () => storage.reads.get(id)!({ text: value, attachments: [], refs: [] })); };

it('restores persisted content and removes the record when the composer is cleared', async () => {
  await render('one'); await restore('one', 'unsent');
  expect(text).toBe('unsent');
  await act(async () => edit(''));
  expect(storage.write).toHaveBeenLastCalledWith('one', undefined);
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
