import { XopcChatAttachment, XopcContextRef } from '../model/chat';
import { XopcSecureStore } from './secureStore';

export interface XopcChatDraft { text: string; refs: XopcContextRef[]; files: XopcChatAttachment[]; }
export class XopcChatDrafts {
  private store: XopcSecureStore = new XopcSecureStore();
  async read(scope: string): Promise<XopcChatDraft | undefined> {
    if (!scope) return undefined;
    const raw = await this.store.read('chat-draft:' + scope);
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw) as XopcChatDraft;
      if (typeof value.text !== 'string' || !Array.isArray(value.refs) || !Array.isArray(value.files)) return undefined;
      return this.normalized(value);
    } catch (_) { return undefined; }
  }
  async save(scope: string, value: XopcChatDraft): Promise<void> {
    if (!scope) return;
    const draft = this.normalized(value);
    if (!draft.text.trim() && !draft.refs.length && !draft.files.length) await this.store.remove('chat-draft:' + scope);
    else await this.store.write('chat-draft:' + scope, JSON.stringify(draft));
  }
  private normalized(value: XopcChatDraft): XopcChatDraft {
    return { text: value.text.slice(0, 20000),
      refs: value.refs.filter((ref: XopcContextRef): boolean => !!ref && ['note', 'task'].includes(ref.kind)
        && typeof ref.sourceId === 'string' && typeof ref.expectedVersion === 'string').slice(0, 5)
        .map((ref: XopcContextRef): XopcContextRef => ({ kind: ref.kind, sourceId: ref.sourceId, expectedVersion: ref.expectedVersion, title: ref.title || '' })),
      files: value.files.filter((file: XopcChatAttachment): boolean => !!file && typeof file.workspaceRelativePath === 'string'
        && !!file.workspaceRelativePath && !file.data && !file.uri && typeof file.name === 'string' && typeof file.mimeType === 'string'
        && Number.isFinite(file.size) && file.size >= 0).slice(0, 10)
        .map((file: XopcChatAttachment): XopcChatAttachment => ({ type: file.type, name: file.name, mimeType: file.mimeType,
          size: file.size, data: '', workspaceRelativePath: file.workspaceRelativePath })) };
  }
}
