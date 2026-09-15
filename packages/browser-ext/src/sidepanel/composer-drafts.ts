import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { BrowserAttachment } from './attachments';
import type { AttachedPageContext } from './page-context';
import { openDatabase } from './chat-state';

export type ComposerDraft = { text: string; attachments: BrowserAttachment[]; pages: AttachedPageContext[] };
export const EMPTY_DRAFT: ComposerDraft = { text: '', attachments: [], pages: [] };

async function readDraft(key: string): Promise<ComposerDraft | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
async function writeDraft(key: string, draft: ComposerDraft): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      const store = tx.objectStore('drafts');
      if (!draft.text && !draft.attachments.length && !draft.pages.length) store.delete(key);
      else store.put(draft, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

/** Each async operation keeps its originating key; late results cannot change another chat. */
export class ComposerDrafts {
  private records = new Map<string, ComposerDraft>();
  private listeners = new Set<() => void>();
  private pendingWrites = new Map<string, ComposerDraft>();
  private writing = false;
  constructor(private onError: (error: unknown) => void, private save = writeDraft, private read = readDraft) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  peek = (key: string) => this.records.get(key);
  get = (key: string) => this.records.get(key) ?? EMPTY_DRAFT;
  async load(key: string) {
    if (this.records.has(key)) return;
    let draft: ComposerDraft | undefined;
    try { draft = await this.read(key); }
    catch (cause) { this.onError(cause); }
    if (this.records.has(key)) return;
    // A reopened page may have changed while the panel was closed.
    this.records.set(key, draft ? { ...draft, pages: draft.pages.map(page => ({ ...page, stale: true })) } : EMPTY_DRAFT);
    this.listeners.forEach(listener => listener());
  }
  update(key: string, update: (current: ComposerDraft) => ComposerDraft) {
    const draft = update(this.get(key));
    this.records.set(key, draft);
    this.listeners.forEach(listener => listener());
    this.pendingWrites.set(key, draft);
    void this.flush();
  }
  private async flush() {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.pendingWrites.size) {
        const [key, draft] = this.pendingWrites.entries().next().value!;
        this.pendingWrites.delete(key);
        try { await this.save(key, draft); } catch (cause) { this.onError(cause); }
      }
    } finally { this.writing = false; }
  }
  invalidate(tabId: number) {
    for (const [key, draft] of this.records) {
      if (draft.pages.some(page => page.tabId === tabId && !page.stale)) {
        this.update(key, current => ({ ...current, pages: current.pages.map(page => page.tabId === tabId ? { ...page, stale: true } : page) }));
      }
    }
  }
}
export function useComposerDrafts(key: string, onError: (error: unknown) => void) {
  const store = useMemo(() => new ComposerDrafts(onError), []);
  const draft = useSyncExternalStore(store.subscribe, () => store.peek(key));
  useEffect(() => { void store.load(key).catch(onError); }, [store, key]);
  return { store, draft: draft ?? EMPTY_DRAFT, ready: draft !== undefined, update: (update: (current: ComposerDraft) => ComposerDraft) => store.update(key, update) };
}
