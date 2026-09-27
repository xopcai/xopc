import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGatewayStore } from '@/stores/gateway-store';
import { composerDraftStorage } from '../session/local-session-drafts';
import type { Attachment } from '../attachments/attachment-utils';
import type { ComposerContextRef } from './composer.types';
import type { UseComposerEditorReturn } from './use-composer-editor';
import type { UseComposerAttachmentsReturn } from './use-composer-attachments';

type SavedComposer = { text: string; attachments: Attachment[]; refs: ComposerContextRef[] };
type ActiveDraft = {
  scope: string; ready: boolean; dirty: boolean; observe: boolean; snapshot: SavedComposer;
  storage: ReturnType<typeof composerDraftStorage<SavedComposer>>;
};
const sameItems = <T,>(left: T[], right: T[]) => left.length === right.length && left.every((item, index) => item === right[index]);

export function usePersistedComposer(id: string | null | undefined, editor: UseComposerEditorReturn,
  attachments: UseComposerAttachmentsReturn, refs: ComposerContextRef[], setRefs: (refs: ComposerContextRef[]) => void): void {
  const identity = useGatewayStore(state => state.conversationId);
  const scope = identity && id ? JSON.stringify([identity, id]) : '';
  const current = useRef({ editor, attachments, refs, setRefs });
  current.current = { editor, attachments, refs, setRefs };
  const active = useRef<ActiveDraft | undefined>(undefined);
  const previousScope = useRef('');
  const [hydration, setHydration] = useState(0);
  const writes = useRef(Promise.resolve());

  useLayoutEffect(() => {
    if (!scope || !id) { active.current = undefined; return; }
    const entry: ActiveDraft = { scope, ready: false, dirty: false, observe: false,
      snapshot: { text: current.current.editor.valueRef.current, attachments: current.current.attachments.attachmentsRef.current, refs: current.current.refs },
      storage: composerDraftStorage<SavedComposer>(id) };
    active.current = entry;
    if (previousScope.current && previousScope.current !== scope) {
      current.current.editor.resetEditor();
      current.current.attachments.clearAttachments();
      current.current.setRefs([]);
      entry.snapshot = { text: '', attachments: [], refs: [] };
    }
    previousScope.current = scope;
    let loaded = false;
    void entry.storage.read().then(saved => {
      loaded = true;
      if (active.current !== entry) return;
      const live = current.current;
      // Never replace text or attachments entered while IndexedDB was opening.
      if (saved && !entry.dirty && !live.editor.valueRef.current && !live.attachments.attachmentsRef.current.length && !live.refs.length) {
        live.editor.resetEditor({ nextText: saved.text });
        live.attachments.setAttachments(saved.attachments);
        live.setRefs(saved.refs);
      }
    }).catch(error => { console.warn('Composer draft restoration failed', error); })
      .finally(() => {
        if (active.current !== entry) return;
        entry.ready = loaded;
        setHydration(value => value + 1);
      });
    return () => { if (active.current === entry) active.current = undefined; };
  }, [scope, id]);

  useLayoutEffect(() => {
    const entry = active.current;
    if (!entry || entry.scope !== scope) return;
    if (!entry.observe) { entry.observe = true; return; }
    const snapshot = { text: editor.value, attachments: attachments.attachments, refs };
    if (snapshot.text !== entry.snapshot.text || !sameItems(snapshot.attachments, entry.snapshot.attachments)
      || !sameItems(snapshot.refs, entry.snapshot.refs)) entry.dirty = true;
    entry.snapshot = snapshot;
  }, [scope, editor.value, attachments.attachments, refs]);

  useEffect(() => {
    const entry = active.current;
    if (!entry || entry.scope !== scope || (!entry.ready && !entry.dirty)) return;
    const snapshot: SavedComposer = { text: editor.value, attachments: attachments.attachments, refs };
    const payload = snapshot.text || snapshot.attachments.length || refs.length ? snapshot : undefined;
    writes.current = writes.current.catch(() => {}).then(() => entry.storage.write(payload))
      .catch(error => { console.warn('Composer draft persistence failed', error); });
  }, [scope, hydration, editor.value, attachments.attachments, refs]);
}
