import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { registerExternalIntakeReceiver } from './external-intake-receiver';
import { MAX_CHAT_ATTACHMENTS } from '../constants';
import { useGatewayStore } from '@/stores/gateway-store';
import { composerDraftStorage } from '../session/local-session-drafts';
import type { Attachment } from '../attachments/attachment-utils';
import type { ComposerContextRef, ComposerMode, ComposerDraft } from './composer.types';
import type { UseComposerEditorReturn } from './use-composer-editor';
import type { UseComposerAttachmentsReturn } from './use-composer-attachments';

export type SavedEditSession = { mode: ComposerMode; drafts: Record<string, ComposerDraft> };
type SavedComposer = { editSession?: SavedEditSession; text: string; attachments: Attachment[]; refs: ComposerContextRef[]; intakeReceipts?: string[] };
type ActiveDraft = {
  receipts: string[]; scope: string; ready: boolean; dirty: boolean; observe: boolean; snapshot: SavedComposer;
  storage: ReturnType<typeof composerDraftStorage<SavedComposer>>;
};
const editModeIdentity = (mode?: ComposerMode) => mode?.kind === 'editTurn' ? `turn:${mode.turnId}`
  : mode?.kind === 'editFollowUp' ? `input:${mode.inputId}:${mode.version}` : 'compose';
const sameItems = <T,>(left: T[], right: T[]) => left.length === right.length && left.every((item, index) => item === right[index]);

// A newly mounted composer must wait for the previous instance's queued writes.
const pendingWrites = new Map<string, Promise<void>>();

function enqueueWrite(scope: string, write: () => Promise<void>): Promise<void> {
  const previous = pendingWrites.get(scope) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(write);
  pendingWrites.set(scope, pending);
  const clear = () => {
    if (pendingWrites.get(scope) === pending) pendingWrites.delete(scope);
  };
  void pending.then(clear, clear);
  return pending;
}

export function usePersistedComposer(id: string | null | undefined, editor: UseComposerEditorReturn,
  attachments: UseComposerAttachmentsReturn, refs: ComposerContextRef[], setRefs: (refs: ComposerContextRef[]) => void,
  editSession?: { snapshot: () => SavedEditSession; restore: (saved: SavedEditSession) => void },
  unboundDraftKey?: string, getDraftHandoffTarget?: () => string | undefined): void {
  const editorIdentity = editModeIdentity(editSession?.snapshot().mode);
  const identity = useGatewayStore(state => state.conversationId);
  const scope = identity && id ? JSON.stringify([identity, id]) : '';
  const current = useRef({ editor, attachments, refs, setRefs, editSession });
  current.current = { editor, attachments, refs, setRefs, editSession };
  const active = useRef<ActiveDraft | undefined>(undefined);
  const previousDraft = useRef<{ identity: string | undefined; id: typeof id; unboundDraftKey?: string } | undefined>(undefined);
  const [hydration, setHydration] = useState(0);

  useLayoutEffect(() => {
    const previous = previousDraft.current;
    previousDraft.current = { identity, id, unboundDraftKey };
    const isProjectHandoff = previous?.identity === identity && previous?.id === null
      && Boolean(id) && id === getDraftHandoffTarget?.();
    const draftChanged = previous && (previous.identity !== identity || previous.id !== id || previous.unboundDraftKey !== unboundDraftKey);
    const resetDraft = draftChanged && !isProjectHandoff;
    if (resetDraft) {
      current.current.editor.resetEditor();
      current.current.attachments.clearAttachments();
      current.current.setRefs([]);
    }
    if (!scope || !id) { active.current = undefined; return; }
    const entry: ActiveDraft = { receipts: [], scope, ready: false, dirty: false, observe: false,
      snapshot: {
        text: current.current.editor.valueRef.current,
        attachments: current.current.attachments.attachmentsRef.current,
        refs: resetDraft ? [] : current.current.refs,
        editSession: current.current.editSession?.snapshot(),
      },
      storage: composerDraftStorage<SavedComposer>(id) };
    active.current = entry;
    let loaded = false;
    const pendingWrite = pendingWrites.get(scope);
    const read = pendingWrite ? pendingWrite.catch(() => {}).then(() => entry.storage.read()) : entry.storage.read();
    void read.then(saved => {
      loaded = true;
      if (active.current !== entry) return;
      entry.receipts = saved?.intakeReceipts ?? [];
      const live = current.current;
      // Never replace text or attachments entered while IndexedDB was opening.
      if (saved && !entry.dirty && !live.editor.valueRef.current && !live.attachments.attachmentsRef.current.length && !live.refs.length) {
        live.editor.resetEditor({ nextText: saved.text });
        live.attachments.setAttachments(saved.attachments);
        live.setRefs(saved.refs);
        if (saved.editSession) live.editSession?.restore(saved.editSession);
      }
    }).catch(error => { console.warn('Composer draft restoration failed', error); })
      .finally(() => {
        if (active.current !== entry) return;
        entry.ready = loaded;
        setHydration(value => value + 1);
      });
    return () => { if (active.current === entry) active.current = undefined; };
  }, [scope, id, identity, unboundDraftKey, getDraftHandoffTarget]);

  useLayoutEffect(() => {
    const entry = active.current;
    if (!entry || entry.scope !== scope) return;
    if (!entry.observe) { entry.observe = true; return; }
    const snapshot = { text: editor.value, attachments: attachments.attachments, refs, editSession: current.current.editSession?.snapshot() };
    if (snapshot.text !== entry.snapshot.text || !sameItems(snapshot.attachments, entry.snapshot.attachments)
      || !sameItems(snapshot.refs, entry.snapshot.refs)
      || editModeIdentity(snapshot.editSession?.mode) !== editModeIdentity(entry.snapshot.editSession?.mode)) entry.dirty = true;
    entry.snapshot = snapshot;
  }, [scope, editor.value, attachments.attachments, refs, editorIdentity]);

  useEffect(() => {
    const entry = active.current;
    if (!entry || entry.scope !== scope || (!entry.ready && !entry.dirty)) return;
    const snapshot: SavedComposer = { text: editor.value, attachments: attachments.attachments, refs, editSession: current.current.editSession?.snapshot() };
    const payload = snapshot.text || snapshot.attachments.length || refs.length || snapshot.editSession?.mode.kind !== undefined && snapshot.editSession.mode.kind !== 'compose' ? snapshot : undefined;
    void enqueueWrite(scope, () => entry.storage.write(payload ? { ...payload, intakeReceipts: entry.receipts } : entry.receipts.length ? { text: '', attachments: [], refs: [], intakeReceipts: entry.receipts } : undefined))
      .catch(error => { console.warn('Composer draft persistence failed', error); });
  }, [scope, hydration, editor.value, attachments.attachments, refs, editorIdentity]);

  useEffect(() => {
    const entry = active.current;
    if (!entry?.ready || !scope) return;
    return registerExternalIntakeReceiver(scope, async (intakeId, incoming) => {
      await pendingWrites.get(scope)?.catch(() => {});
      if (active.current !== entry) throw new Error('Conversation changed. Please retry.');
      if (entry.receipts.includes(intakeId)) return;
      const live = current.current;
      const existing = live.attachments.attachmentsRef.current;
      const additions = incoming.filter(item => !existing.some(saved => saved.id === item.id));
      if (existing.length + additions.length > MAX_CHAT_ATTACHMENTS) throw new Error('A message supports at most 10 attachments. Remove attachments or choose another conversation.');
      live.attachments.setAttachments([...existing, ...additions]);
      entry.receipts.push(intakeId);
      try {
        const snapshot: SavedComposer = { text: live.editor.valueRef.current, attachments: live.attachments.attachmentsRef.current, refs: live.refs, intakeReceipts: entry.receipts.slice(), editSession: live.editSession?.snapshot() };
        await enqueueWrite(scope, () => entry.storage.write(snapshot));
      } catch (error) {
        entry.receipts = entry.receipts.filter(id => id !== intakeId);
        throw error;
      }
    });
  }, [scope, hydration]);

}
