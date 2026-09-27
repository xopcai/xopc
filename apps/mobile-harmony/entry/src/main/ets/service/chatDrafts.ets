import { XopcChatAttachment, XopcContextRef } from '../model/chat';
import { localSessionStore } from './localSessionStore';

export interface XopcChatDraft { text: string; refs: XopcContextRef[]; files: XopcChatAttachment[]; }
export class XopcChatDrafts {
  private writes: Promise<void> = Promise.resolve();
  async read(scope: string): Promise<XopcChatDraft | undefined> {
    if (!scope) return undefined;
    await this.writes;
    const raw = await localSessionStore.readComposer(scope);
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
    const payload = !draft.text.trim() && !draft.refs.length && !draft.files.length ? undefined : JSON.stringify(draft);
    const pending = this.writes.then((): Promise<void> => localSessionStore.writeComposer(scope, payload));
    this.writes = pending.catch((_error: Error): void => {});
    await pending;
  }
  private normalized(value: XopcChatDraft): XopcChatDraft {
    return { text: value.text.slice(0, 20000),
      refs: value.refs.filter((ref: XopcContextRef): boolean => !!ref && ['note', 'task'].includes(ref.kind)
        && typeof ref.sourceId === 'string' && typeof ref.expectedVersion === 'string').slice(0, 5)
        .map((ref: XopcContextRef): XopcContextRef => ({ kind: ref.kind, sourceId: ref.sourceId, expectedVersion: ref.expectedVersion, title: ref.title || '' })),
      files: value.files.filter((file: XopcChatAttachment): boolean => !!file && typeof file.type === 'string'
        && typeof file.data === 'string' && (file.data.length > 0 || !!file.workspaceRelativePath || !!file.uri?.startsWith('media://'))
        && typeof file.name === 'string' && typeof file.mimeType === 'string'
        && Number.isFinite(file.size) && file.size >= 0).slice(0, 10)
        .map((file: XopcChatAttachment): XopcChatAttachment => ({ type: file.type, name: file.name, mimeType: file.mimeType,
          size: file.size, data: file.data, uri: file.uri, duration: file.duration, workspaceRelativePath: file.workspaceRelativePath })) };
  }
}
