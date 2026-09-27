import { applyNotePatch } from '../common/noteMarkdown';
import {
  XopcNote, XopcNoteAiEditResult, XopcNoteDraft, XopcNoteHistoryResult, XopcNoteIndexEntry,
  XopcNoteConversationResult, XopcNoteList, XopcNoteMetadataPatch, XopcNoteResult, XopcNoteSnapshot,
  XopcNoteStatus, XopcNoteSyncResult
} from '../model/note';
import { gatewaySession } from '../service/gatewaySession';
import { XopcHttpError } from '../service/transport';

/** Gateway-backed note operations. Local draft persistence intentionally lives in a separate service. */
export class XopcNoteRepository {
  async list(search: string, status: XopcNoteStatus | '', offset: number = 0): Promise<XopcNoteList> {
    const query = encodeURIComponent(search.trim());
    const path = '/api/notes?limit=30&offset=' + offset + '&sortBy=updatedAt&sortOrder=desc&search=' + query
      + (status ? '&status=' + encodeURIComponent(status) : '');
    const result = JSON.parse(await gatewaySession.request(path)) as XopcNoteList;
    if (!Array.isArray(result.items)) throw new Error('INVALID_NOTE_LIST');
    result.items.forEach((item: XopcNoteIndexEntry): void => {
      if (!item.id || typeof item.updatedAt !== 'number') throw new Error('INVALID_NOTE_LIST');
    });
    return result;
  }

  async detail(id: string): Promise<XopcNote> {
    const result = JSON.parse(await gatewaySession.request('/api/notes/' + encodeURIComponent(id))) as XopcNoteResult;
    if (!result.note?.id || typeof result.note.markdown !== 'string') throw new Error('INVALID_NOTE');
    return result.note;
  }

  async openConversation(id: string): Promise<XopcNoteConversationResult> {
    const path = '/api/notes/' + encodeURIComponent(id) + '/chat';
    const result = JSON.parse(await gatewaySession.request(path, 'POST')) as XopcNoteConversationResult;
    if (!result.conversationId || result.sourceBinding?.kind !== 'note' || result.sourceBinding.sourceId !== id
      || typeof result.sourceBinding.version !== 'string') throw new Error('INVALID_NOTE_CONVERSATION');
    return result;
  }

  async create(draft: XopcNoteDraft): Promise<XopcNote> {
    const body = JSON.stringify({
      title: draft.title.trim(), markdown: draft.markdown, kind: 'thought', channel: 'app', platform: 'harmonyos'
    });
    const raw = await gatewaySession.request('/api/notes', 'POST', body, draft.mutationId);
    const result = JSON.parse(raw) as XopcNoteResult;
    if (!result.note?.id) throw new Error('INVALID_NOTE');
    return result.note;
  }

  async sync(draft: XopcNoteDraft): Promise<XopcNoteSyncResult> {
    const body = JSON.stringify({
      noteId: draft.noteId, title: draft.title.trim(), markdown: draft.markdown,
      localVersion: draft.localVersion, baseRemoteVersion: draft.baseRevision
    });
    try {
      const result = JSON.parse(await gatewaySession.request('/api/notes/sync', 'POST', body)) as XopcNoteSyncResult;
      if (!result.note?.id) throw new Error('INVALID_NOTE_SYNC');
      return result;
    } catch (error) {
      if (error instanceof XopcHttpError && error.status === 409 && error.body) {
        const result = JSON.parse(error.body) as XopcNoteSyncResult;
        if (result.conflict && result.note?.id) return result;
      }
      throw error as Error;
    }
  }

  async updateMetadata(note: XopcNote, patch: XopcNoteMetadataPatch): Promise<XopcNote> {
    const request: XopcNoteUpdateRequest = {
      pinned: patch.pinned, status: patch.status, tags: patch.tags, expectedRevision: note.remoteVersion ?? 1
    };
    const body = JSON.stringify(request);
    const result = JSON.parse(await gatewaySession.request('/api/notes/' + encodeURIComponent(note.id), 'PATCH', body)) as XopcNoteResult;
    if (!result.note?.id) throw new Error('INVALID_NOTE');
    return result.note;
  }

  async remove(note: XopcNote, mutationId: string): Promise<void> {
    const body = JSON.stringify({ expectedRevision: note.remoteVersion ?? 1 });
    await gatewaySession.request('/api/notes/' + encodeURIComponent(note.id), 'DELETE', body, mutationId);
  }

  async previewAiEdit(note: XopcNote, instruction: string, markdown: string,
    selectedText: string = ''): Promise<XopcNoteAiEditResult> {
    const selection = selectedText.trim();
    const first = selection ? markdown.indexOf(selection) : -1;
    const unique = first >= 0 && first === markdown.lastIndexOf(selection);
    const range: XopcNoteAiRange = unique ? { start: first, end: first + selection.length } : { start: 0, end: markdown.length };
    const context: XopcNoteAiContext = { type: unique ? 'selection' : 'note', range };
    const request: XopcNoteAiRequest = { instruction: instruction.trim(), markdown, context };
    const body = JSON.stringify(request);
    const result = JSON.parse(await gatewaySession.request('/api/notes/' + encodeURIComponent(note.id) + '/ai/edit', 'POST', body)) as XopcNoteAiEditResult;
    if (!result.patch?.id || !Array.isArray(result.patch.operations)) throw new Error('INVALID_AI_PATCH');
    return result;
  }

  applyAiEdit(markdown: string, result: XopcNoteAiEditResult): string {
    return applyNotePatch(markdown, result.patch.operations);
  }

  async history(id: string): Promise<XopcNoteHistoryResult> {
    const result = JSON.parse(await gatewaySession.request('/api/notes/' + encodeURIComponent(id) + '/history')) as XopcNoteHistoryResult;
    if (!Array.isArray(result.entries)) throw new Error('INVALID_NOTE_HISTORY');
    return result;
  }

  async snapshot(id: string, timestamp: number): Promise<XopcNoteSnapshot> {
    const result = JSON.parse(await gatewaySession.request('/api/notes/' + encodeURIComponent(id) + '/history/' + timestamp)) as XopcNoteSnapshot;
    if (result.noteId !== id || typeof result.markdown !== 'string') throw new Error('INVALID_NOTE_SNAPSHOT');
    return result;
  }
}

interface XopcNoteUpdateRequest extends XopcNoteMetadataPatch { expectedRevision: number; }
interface XopcNoteAiRange { start: number; end: number; }
interface XopcNoteAiContext { type: string; range: XopcNoteAiRange; }
interface XopcNoteAiRequest { instruction: string; markdown: string; context: XopcNoteAiContext; }
