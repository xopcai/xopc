import { filePreviewKind } from '../common/filePreview';
import { XopcHistoryMedia } from '../model/chat';
import { XopcFile, XopcFileResult, XopcFileSpaceResult, XopcFileWrite } from '../model/files';
import { gatewaySession } from '../service/gatewaySession';

interface XopcDocumentResolve { spaceId: string; path: string; }

export function managedFileMedia(file: XopcFile): XopcHistoryMedia {
  return { id: file.id, fileId: file.id, name: file.name, type: 'file', mimeType: file.mimeType,
    size: file.size, uri: 'xopc-file:' + encodeURIComponent(file.id) };
}

@ObservedV2
export class XopcFileDocumentViewModel {
  @Trace resource?: XopcFile;
  @Trace editing: boolean = false;
  @Trace busy: boolean = false;
  @Trace content: string = '';
  @Trace savedContent: string = '';
  @Trace error: string = '';
  private generation: number = 0;

  reset(): void {
    this.generation++; this.resource = undefined; this.editing = false; this.busy = false;
    this.content = ''; this.savedContent = ''; this.error = '';
  }
  canEdit(): boolean {
    const file = this.resource;
    if (!file || file.size > 1024 * 1024 || !file.capabilities.includes('edit') || !file.capabilities.includes('preview')) return false;
    return ['text', 'markdown', 'html'].includes(filePreviewKind(file.name, file.mimeType));
  }
  dirty(): boolean { return this.editing && this.content !== this.savedContent; }

  async inspect(file: XopcHistoryMedia, conversationId: string): Promise<void> {
    this.reset(); const generation = this.generation;
    try {
      let path = '';
      let body = '';
      if (file.uri.startsWith('xopc-file:')) {
        path = '/api/files/' + encodeURIComponent(decodeURIComponent(file.uri.slice(10)));
      } else if (!file.uri && file.workspaceRelativePath && conversationId) {
        const space = JSON.parse(await gatewaySession.request('/api/files/contexts/session/' + encodeURIComponent(conversationId))) as XopcFileSpaceResult;
        if (generation !== this.generation) return;
        const resolve: XopcDocumentResolve = { spaceId: space.space.id, path: file.workspaceRelativePath };
        path = '/api/files/resolve'; body = JSON.stringify(resolve);
      } else return;
      const result = JSON.parse(await gatewaySession.request(path, body ? 'POST' : 'GET', body)) as XopcFileResult;
      if (generation === this.generation && result.resource?.id) this.resource = result.resource;
    } catch (_) { /* Read-only attachment preview remains available when metadata cannot be resolved. */ }
  }
  async beginEdit(): Promise<void> {
    if (!this.canEdit() || this.busy) return;
    const generation = this.generation; const file = this.resource!;
    this.busy = true; this.error = '';
    try {
      const content = await gatewaySession.request('/api/files/' + encodeURIComponent(file.id) + '/content');
      if (generation !== this.generation) return;
      if (content.length > 1024 * 1024) throw new Error('FILE_TOO_LARGE_TO_EDIT');
      this.content = content; this.savedContent = content; this.editing = true;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  cancelEdit(): void { if (!this.busy) { this.content = this.savedContent; this.editing = false; this.error = ''; } }
  async save(): Promise<boolean> {
    if (!this.canEdit() || !this.editing || this.busy) return false;
    const file = this.resource!; const generation = this.generation;
    const body: XopcFileWrite = { content: this.content, revision: file.revision };
    this.busy = true; this.error = '';
    try {
      const result = JSON.parse(await gatewaySession.request('/api/files/' + encodeURIComponent(file.id) + '/content', 'PUT', JSON.stringify(body))) as XopcFileResult;
      if (generation !== this.generation) return false;
      if (!result.resource?.revision) throw new Error('INVALID_FILE_RESPONSE');
      this.resource = result.resource; this.savedContent = body.content; this.editing = false; return true;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; return false; }
    finally { if (generation === this.generation) this.busy = false; }
  }
}
