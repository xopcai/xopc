import { common } from '@kit.AbilityKit';
import { deriveNoteTitle } from '../common/noteMarkdown';
import { reconcileNoteSave, XopcNoteSaveReconciliation } from '../common/noteSync';
import {
  XopcNote, XopcNoteAiEditResult, XopcNoteDraft, XopcNoteHistoryEntry, XopcNoteIndexEntry, XopcNoteMetadataPatch,
  XopcNoteSnapshot, XopcNoteStatus, XopcNoteSyncState
} from '../model/note';
import { XopcNoteRepository } from '../repository/noteRepository';
import { XopcNoteDraftStore } from '../service/noteDraftStore';
import { XopcDeviceCrypto } from '../service/deviceCrypto';
import { XopcNoteMediaService } from '../service/noteMedia';
import { XopcChatAttachment } from '../model/chat';

const LOCAL_NOTE_PREFIX = 'local:';
const AUTOSAVE_DELAY_MS = 650;

/** State machine for the native notes list, editor, conflict handling, history and AI preview. */
@ObservedV2
export class XopcNoteViewModel {
  @Trace items: XopcNoteIndexEntry[] = [];
  @Trace selected?: XopcNote;
  @Trace draft?: XopcNoteDraft;
  @Trace remoteConflict?: XopcNote;
  @Trace history: XopcNoteHistoryEntry[] = [];
  @Trace snapshot?: XopcNoteSnapshot;
  @Trace aiPreview?: XopcNoteAiEditResult;
  @Trace loading: boolean = false;
  @Trace loadingMore: boolean = false;
  @Trace saving: boolean = false;
  @Trace openingConversation: boolean = false;
  @Trace openingId: string = '';
  @Trace error: string = '';
  @Trace search: string = '';
  @Trace status: XopcNoteStatus | '' = '';
  @Trace hasMore: boolean = false;
  @Trace editing: boolean = false;
  @Trace showingHistory: boolean = false;
  @Trace showingAi: boolean = false;
  @Trace editorRevision: number = 0;
  @Trace selecting: boolean = false;
  @Trace selectedIds: string[] = [];
  @Trace selectedText: string = '';
  private repository: XopcNoteRepository = new XopcNoteRepository();
  private drafts: XopcNoteDraftStore = new XopcNoteDraftStore();
  private crypto: XopcDeviceCrypto = new XopcDeviceCrypto();
  private media: XopcNoteMediaService = new XopcNoteMediaService();
  private generation: number = 0;
  private saveTimer: number = -1;

  async start(context: common.Context, initialId: string = '', initialStatus: XopcNoteStatus | '' = ''): Promise<void> {
    this.status = initialStatus;
    if (initialId) this.openingId = initialId;
    try {
      await this.drafts.initialize(context);
      if (initialId && this.openingId !== initialId) return;
      if (initialId) await this.open(initialId); else await this.list();
      void this.flushPending(initialId);
    } catch (error) { this.error = (error as Error).message; }
  }

  dispose(): void {
    this.generation++;
    this.cancelSaveTimer();
  }

  async list(more: boolean = false): Promise<void> {
    if (this.loading || this.loadingMore) return;
    const generation = ++this.generation;
    if (more) this.loadingMore = true; else this.loading = true;
    this.error = '';
    try {
      const result = await this.repository.list(this.search, this.status, more ? this.items.length : 0);
      if (generation !== this.generation) return;
      const remoteItems = more ? this.items.concat(result.items.filter((item: XopcNoteIndexEntry): boolean =>
        !this.items.some((current: XopcNoteIndexEntry): boolean => current.id === item.id))) : result.items;
      this.items = more ? remoteItems : await this.mergePendingDrafts(remoteItems);
      this.hasMore = result.hasMore ?? false;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally {
      if (generation === this.generation) { this.loading = false; this.loadingMore = false; }
    }
  }

  async open(id: string): Promise<void> {
    if (this.loading) return;
    this.openingId = id;
    this.selected = undefined; this.draft = undefined; this.editing = false;
    if (id.startsWith(LOCAL_NOTE_PREFIX)) {
      const local = await this.drafts.load(id);
      if (!local) { this.error = 'NOTE_DRAFT_NOT_FOUND'; this.openingId = ''; return; }
      this.selected = undefined; this.draft = local; this.remoteConflict = undefined;
      this.editing = true; this.history = []; this.snapshot = undefined; this.aiPreview = undefined;
      this.openingId = '';
      this.editorRevision++;
      return;
    }
    const generation = ++this.generation;
    this.loading = true; this.error = ''; this.remoteConflict = undefined;
    try {
      const note = await this.repository.detail(id);
      const local = await this.drafts.load(id);
      if (generation !== this.generation) return;
      this.selected = note;
      if (local && local.syncState !== 'clean') {
        this.draft = local;
        if (local.baseRevision !== (note.remoteVersion ?? 1)) {
          this.draft = this.copyDraft(local, { syncState: 'conflict' }); this.remoteConflict = note;
        }
      } else {
        this.draft = this.draftFromNote(note);
      }
      this.editing = false; this.history = []; this.snapshot = undefined; this.aiPreview = undefined;
      this.editorRevision++;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) { this.loading = false; this.openingId = ''; } }
  }

  create(): void {
    if (this.loading) return;
    const now = Date.now();
    const noteId = LOCAL_NOTE_PREFIX + this.crypto.uuid();
    this.selected = undefined;
    this.draft = {
      noteId, title: '', markdown: '', baseRevision: 0, localVersion: 1, updatedAt: now,
      syncState: 'dirty', mutationId: this.crypto.uuid()
    };
    this.remoteConflict = undefined; this.editing = true; this.error = '';
    this.editorRevision++;
    void this.persistAndSchedule();
  }

  updateTitle(value: string): void { this.updateDraft(value, this.draft?.markdown ?? ''); }
  updateMarkdown(value: string): void { this.updateDraft(this.draft?.title ?? '', value); }

  private updateDraft(title: string, markdown: string): void {
    const current = this.draft;
    if (!current || (current.title === title && current.markdown === markdown)) return;
    this.draft = this.copyDraft(current, { title, markdown, localVersion: current.localVersion + 1,
      updatedAt: Date.now(), syncState: 'dirty' });
    this.remoteConflict = undefined;
    void this.persistAndSchedule();
  }

  private async persistAndSchedule(): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    try { await this.drafts.save(draft); }
    catch (error) { this.error = (error as Error).message; return; }
    this.cancelSaveTimer();
    this.saveTimer = setTimeout((): void => { void this.saveNow(); }, AUTOSAVE_DELAY_MS);
  }

  async saveNow(): Promise<boolean> {
    this.cancelSaveTimer();
    const draft = this.draft;
    if (!draft || this.saving || draft.syncState === 'clean' || draft.syncState === 'conflict') return draft?.syncState === 'clean';
    this.saving = true; this.error = '';
    this.draft = this.copyDraft(draft, { syncState: 'saving' });
    try {
      await this.drafts.save(this.draft);
      let note: XopcNote;
      if (draft.noteId.startsWith(LOCAL_NOTE_PREFIX)) {
        note = await this.repository.create(this.copyDraft(draft, { title: deriveNoteTitle(draft.title, draft.markdown) }));
      } else {
        const result = await this.repository.sync(this.copyDraft(draft, { title: deriveNoteTitle(draft.title, draft.markdown) }));
        if (result.conflict) {
          this.remoteConflict = result.note;
          this.draft = this.copyDraft(this.draft ?? draft, { syncState: 'conflict' });
          await this.drafts.save(this.draft);
          this.error = 'NOTE_REVISION_CONFLICT';
          return false;
        }
        note = result.note;
      }
      const wasLocal = draft.noteId.startsWith(LOCAL_NOTE_PREFIX);
      if (wasLocal) await this.drafts.remove(draft.noteId);
      const reconciliation: XopcNoteSaveReconciliation = reconcileNoteSave(draft, this.draft, note, this.crypto.uuid());
      this.selected = note; this.draft = reconciliation.draft; this.remoteConflict = undefined;
      this.replaceIndex(note);
      if (reconciliation.needsSync) {
        await this.persistAndSchedule();
        return true;
      }
      await this.drafts.save(reconciliation.draft);
      return true;
    } catch (error) {
      const current = this.draft;
      if (current) {
        const state: XopcNoteSyncState = this.isConflict(error) ? 'conflict' : 'offline';
        this.draft = this.copyDraft(current, { syncState: state });
        try { await this.drafts.save(this.draft); } catch (_storeError) {}
      }
      this.error = (error as Error).message;
      return false;
    } finally { this.saving = false; }
  }

  async closeEditor(): Promise<void> {
    if (await this.saveNow()) this.editing = false;
  }

  async openConversation(): Promise<string> {
    if (!this.draft || this.saving || this.openingConversation) return '';
    if (!await this.saveNow()) return '';
    const note = this.selected;
    if (!note || this.draft?.syncState !== 'clean') {
      if (!this.error) this.error = 'NOTE_SYNC_REQUIRED';
      return '';
    }
    this.openingConversation = true; this.error = '';
    try { return (await this.repository.openConversation(note.id)).conversationId; }
    catch (error) { this.error = (error as Error).message; return ''; }
    finally { this.openingConversation = false; }
  }

  async resolveConflict(useLocal: boolean): Promise<void> {
    const draft = this.draft; const remote = this.remoteConflict;
    if (!draft || !remote) return;
    if (!useLocal) {
      const clean = this.draftFromNote(remote);
      await this.drafts.save(clean);
      this.selected = remote; this.draft = clean; this.remoteConflict = undefined; this.error = '';
      return;
    }
    this.draft = this.copyDraft(draft, { baseRevision: remote.remoteVersion ?? 1, syncState: 'dirty', updatedAt: Date.now() });
    this.remoteConflict = undefined;
    await this.drafts.save(this.draft);
    await this.saveNow();
  }

  async togglePin(): Promise<void> {
    const note = this.selected;
    if (!note || this.saving) return;
    await this.updateMetadata({ pinned: !note.pinned });
  }

  async archive(): Promise<void> { await this.updateMetadata({ status: 'archived' }); }

  async updateTags(tags: string[]): Promise<void> {
    const normalized = tags.map((tag: string): string => tag.trim()).filter((tag: string): boolean => Boolean(tag));
    await this.updateMetadata({ tags: Array.from(new Set<string>(normalized)) });
  }

  async attach(context: common.Context, source: 'file' | 'photo' | 'camera'): Promise<void> {
    if (!this.draft || this.saving) return;
    try {
      const picked = source === 'file' ? await this.media.pickFile(context)
        : await this.media.pickPhoto(context, source === 'camera');
      if (!picked) return;
      await this.attachPayload(picked);
    } catch (error) { this.error = (error as Error).message; }
  }

  async attachPayload(payload: XopcChatAttachment): Promise<boolean> {
    if (!this.draft || this.saving) return false;
    const saved = await this.saveNow();
    const note = this.selected;
    if (!saved || !note) return false;
    this.saving = true; this.error = '';
    let insertedMarkdown = '';
    try {
      const attachment = await this.media.upload(note.id, payload, this.crypto.uuid());
      const escapedName = attachment.fileName.replace(/([\\\[\]])/g, '\\$1');
      const target = 'xopc-attachment://notes/' + encodeURIComponent(note.id) + '/' + encodeURIComponent(attachment.id);
      insertedMarkdown = attachment.type === 'image' ? '![' + escapedName + '](' + target + ')'
        : '[' + escapedName + '](' + target + ')';
    } catch (error) { this.error = (error as Error).message; }
    finally { this.saving = false; }
    if (!insertedMarkdown) return false;
    const current = this.draft?.markdown ?? '';
    this.updateMarkdown(current.replace(/\s+$/, '') + (current.trim() ? '\n\n' : '') + insertedMarkdown);
    this.editorRevision++;
    return this.saveNow();
  }

  async remove(): Promise<void> {
    const note = this.selected;
    if (!note || this.saving) return;
    this.saving = true; this.error = '';
    try {
      await this.repository.remove(note, this.crypto.uuid());
      await this.drafts.remove(note.id);
      this.items = this.items.filter((item: XopcNoteIndexEntry): boolean => item.id !== note.id);
      this.selected = undefined; this.draft = undefined; this.editing = false;
    } catch (error) { this.error = (error as Error).message; }
    finally { this.saving = false; }
  }

  toggleSelection(id: string): void {
    this.selecting = true;
    this.selectedIds = this.selectedIds.includes(id) ? this.selectedIds.filter((value: string): boolean => value !== id)
      : this.selectedIds.concat([id]);
    if (!this.selectedIds.length) this.selecting = false;
  }

  clearSelection(): void { this.selecting = false; this.selectedIds = []; }

  async batch(action: 'pin' | 'archive' | 'delete'): Promise<void> {
    if (this.saving || !this.selectedIds.length) return;
    this.saving = true; this.error = '';
    const targets = this.selectedIds;
    try {
      for (const id of targets) {
        if (id.startsWith(LOCAL_NOTE_PREFIX)) {
          if (action === 'delete') await this.drafts.remove(id);
          continue;
        }
        const note = await this.repository.detail(id);
        if (action === 'delete') await this.repository.remove(note, this.crypto.uuid());
        else if (action === 'archive') await this.repository.updateMetadata(note, { status: 'archived' });
        else await this.repository.updateMetadata(note, { pinned: true });
        await this.drafts.remove(id);
      }
      this.clearSelection();
      await this.list();
    } catch (error) { this.error = (error as Error).message; }
    finally { this.saving = false; }
  }

  private async updateMetadata(patch: XopcNoteMetadataPatch): Promise<void> {
    const note = this.selected;
    if (!note || this.saving) return;
    this.saving = true; this.error = '';
    try {
      const updated = await this.repository.updateMetadata(note, patch);
      this.selected = updated;
      const draft = this.draft;
      if (draft) { this.draft = this.copyDraft(draft, { baseRevision: updated.remoteVersion ?? 1 }); await this.drafts.save(this.draft); }
      this.replaceIndex(updated);
    } catch (error) { this.error = (error as Error).message; }
    finally { this.saving = false; }
  }

  async loadHistory(): Promise<void> {
    const note = this.selected;
    if (!note) return;
    this.loading = true; this.error = '';
    try { this.history = (await this.repository.history(note.id)).entries; this.showingHistory = true; }
    catch (error) { this.error = (error as Error).message; }
    finally { this.loading = false; }
  }

  async loadSnapshot(timestamp: number): Promise<void> {
    const note = this.selected;
    if (!note) return;
    this.loading = true; this.error = '';
    try { this.snapshot = await this.repository.snapshot(note.id, timestamp); }
    catch (error) { this.error = (error as Error).message; }
    finally { this.loading = false; }
  }

  restoreSnapshotToDraft(): void {
    const snapshot = this.snapshot; const draft = this.draft;
    if (!snapshot || !draft) return;
    this.updateDraft(snapshot.title ?? draft.title, snapshot.markdown);
    this.editorRevision++;
    this.snapshot = undefined; this.showingHistory = false; this.editing = true;
  }

  async previewAi(instruction: string): Promise<void> {
    const note = this.selected; const draft = this.draft;
    if (!note || !draft || !instruction.trim()) return;
    this.loading = true; this.error = '';
    try { this.aiPreview = await this.repository.previewAiEdit(note, instruction, draft.markdown, this.selectedText); }
    catch (error) { this.error = (error as Error).message; }
    finally { this.loading = false; }
  }

  async applyAiPreview(): Promise<void> {
    const preview = this.aiPreview; const draft = this.draft;
    if (!preview || !draft) return;
    let title = draft.title;
    let tags: string[] | undefined = undefined;
    let status: XopcNoteStatus | undefined = undefined;
    preview.patch.operations.forEach((operation): void => {
      if (operation.type !== 'updateMetadata') return;
      if (operation.title !== undefined) title = operation.title;
      if (operation.tags !== undefined) tags = operation.tags;
      if (operation.status !== undefined) status = operation.status;
    });
    this.updateDraft(title, this.repository.applyAiEdit(draft.markdown, preview));
    this.editorRevision++;
    this.aiPreview = undefined; this.showingAi = false; this.editing = true;
    await this.saveNow();
    if (tags !== undefined || status !== undefined) await this.updateMetadata({ tags, status });
  }

  aiPreviewMarkdown(): string {
    const preview = this.aiPreview;
    return preview ? this.repository.applyAiEdit(this.draft?.markdown ?? '', preview) : '';
  }

  aiOriginalMarkdown(): string { return this.draft?.markdown ?? ''; }

  discardAiPreview(): void { this.aiPreview = undefined; }

  backToList(): void {
    this.generation++; this.loading = false;
    this.cancelSaveTimer();
    this.selected = undefined; this.draft = undefined; this.remoteConflict = undefined; this.openingId = '';
    this.editing = false; this.showingHistory = false; this.showingAi = false;
    void this.list();
  }

  private async flushPending(excludedId: string = ''): Promise<void> {
    const pending = await this.drafts.pending();
    for (const draft of pending) {
      if (draft.noteId === excludedId || draft.syncState === 'conflict') continue;
      try {
        if (draft.noteId.startsWith(LOCAL_NOTE_PREFIX)) {
          const note = await this.repository.create(draft);
          await this.drafts.remove(draft.noteId); await this.drafts.save(this.draftFromNote(note));
          this.items = this.items.filter((item: XopcNoteIndexEntry): boolean => item.id !== draft.noteId);
          this.replaceIndex(note);
        } else {
          const result = await this.repository.sync(draft);
          if (result.conflict) await this.drafts.save(this.copyDraft(draft, { syncState: 'conflict' }));
          else { await this.drafts.save(this.draftFromNote(result.note)); this.replaceIndex(result.note); }
        }
      } catch (_error) { return; }
    }
  }

  private draftFromNote(note: XopcNote): XopcNoteDraft {
    return {
      noteId: note.id, title: note.title ?? '', markdown: note.markdown,
      baseRevision: note.remoteVersion ?? 1, localVersion: note.localVersion ?? 1,
      updatedAt: note.updatedAt, syncState: 'clean', mutationId: this.crypto.uuid()
    };
  }

  private copyDraft(draft: XopcNoteDraft, change: XopcNoteDraftChange): XopcNoteDraft {
    return {
      noteId: change.noteId !== undefined ? change.noteId : draft.noteId,
      title: change.title !== undefined ? change.title : draft.title,
      markdown: change.markdown !== undefined ? change.markdown : draft.markdown,
      baseRevision: change.baseRevision !== undefined ? change.baseRevision : draft.baseRevision,
      localVersion: change.localVersion !== undefined ? change.localVersion : draft.localVersion,
      updatedAt: change.updatedAt !== undefined ? change.updatedAt : draft.updatedAt,
      syncState: change.syncState !== undefined ? change.syncState : draft.syncState,
      mutationId: change.mutationId !== undefined ? change.mutationId : draft.mutationId
    };
  }

  private replaceIndex(note: XopcNote): void {
    const entry: XopcNoteIndexEntry = {
      id: note.id, title: note.title, kind: note.kind, status: note.status, createdAt: note.createdAt,
      updatedAt: note.updatedAt, pinned: note.pinned, tags: note.tags,
      snippet: note.markdown.replace(/[#*_`>\-\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120),
      groupId: note.groupId, lastOpenedAt: note.lastOpenedAt, taskDone: note.taskMeta?.done, taskDueAt: note.taskMeta?.dueAt
    };
    this.items = [entry].concat(this.items.filter((item: XopcNoteIndexEntry): boolean => item.id !== note.id));
  }

  private async mergePendingDrafts(remoteItems: XopcNoteIndexEntry[]): Promise<XopcNoteIndexEntry[]> {
    const pending = await this.drafts.pending();
    const localEntries = pending.filter((draft: XopcNoteDraft): boolean => draft.noteId.startsWith(LOCAL_NOTE_PREFIX))
      .filter((draft: XopcNoteDraft): boolean => !this.search.trim()
        || (draft.title + '\n' + draft.markdown).toLowerCase().includes(this.search.trim().toLowerCase()))
      .filter((_draft: XopcNoteDraft): boolean => !this.status || this.status === 'inbox')
      .map((draft: XopcNoteDraft): XopcNoteIndexEntry => ({
        id: draft.noteId,
        title: deriveNoteTitle(draft.title, draft.markdown),
        kind: 'thought',
        status: 'inbox',
        createdAt: draft.updatedAt,
        updatedAt: draft.updatedAt,
        snippet: draft.markdown.replace(/[#*_`>\-\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
      }));
    return localEntries.concat(remoteItems.filter((item: XopcNoteIndexEntry): boolean =>
      !localEntries.some((local: XopcNoteIndexEntry): boolean => local.id === item.id)));
  }

  private isConflict(error: Error): boolean { return error.message.includes('409') || error.message.includes('CONFLICT'); }
  private cancelSaveTimer(): void { if (this.saveTimer >= 0) clearTimeout(this.saveTimer); this.saveTimer = -1; }
}

interface XopcNoteDraftChange {
  noteId?: string;
  title?: string;
  markdown?: string;
  baseRevision?: number;
  localVersion?: number;
  updatedAt?: number;
  syncState?: XopcNoteSyncState;
  mutationId?: string;
}
