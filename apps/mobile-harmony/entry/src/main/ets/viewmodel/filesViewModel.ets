import { common } from '@kit.AbilityKit';
import { gatewaySession } from '../service/gatewaySession';
import { XopcFileTransfer } from '../service/fileTransfer';
import { XopcFile, XopcFiles, XopcFileSpace, XopcFileSpaces, XopcFileWrite, XopcFileResult } from '../model/files';
import { XopcFileSpaceResult } from '../model/files';

@ObservedV2
export class XopcFilesViewModel {
  @Trace spaces: XopcFileSpace[] = [];
  @Trace items: XopcFile[] = [];
  @Trace space?: XopcFileSpace;
  @Trace directory: string = '';
  @Trace selected?: XopcFile;
  @Trace content: string = '';
  @Trace savedContent: string = '';
  @Trace busy: boolean = false;
  @Trace error: string = '';
  @Trace editable: boolean = false;
  private transfer: XopcFileTransfer = new XopcFileTransfer();
  private generation: number = 0;
  private contextId: string = '';

  dispose(): void { this.generation++; }
  async start(initialId: string, conversationId: string = ''): Promise<void> {
    if (conversationId) {
      const generation = ++this.generation; this.busy = true; this.contextId = conversationId;
      try {
        const result = JSON.parse(await gatewaySession.request('/api/files/contexts/session/' + encodeURIComponent(conversationId))) as XopcFileSpaceResult;
        if (!result.space?.id) throw new Error('INVALID_FILE_SPACE');
        if (generation !== this.generation) return;
        this.space = result.space; this.spaces = [result.space]; this.busy = false; await this.load();
      } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
      finally { if (generation === this.generation) this.busy = false; }
      return;
    }
    if (!initialId) { await this.load(); return; }
    const generation = ++this.generation;
    this.busy = true;
    try {
      const result = JSON.parse(await gatewaySession.request('/api/files/' + encodeURIComponent(initialId))) as XopcFileResult;
      if (!result.resource?.id) throw new Error('INVALID_FILE_RESPONSE');
      if (generation !== this.generation) return;
      this.busy = false; await this.open(result.resource);
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  async load(search: string = ''): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.error = ''; const generation = ++this.generation;
    try {
      if (!this.spaces.length) {
        const spaces = JSON.parse(await gatewaySession.request('/api/files/spaces')) as XopcFileSpaces;
        if (!Array.isArray(spaces.spaces)) throw new Error('INVALID_FILE_SPACES');
        if (generation !== this.generation) return;
        this.spaces = spaces.spaces;
      }
      const path = search.trim() ? '/api/files/search?q=' + encodeURIComponent(search.trim()) + '&limit=50' + (this.contextId && this.space ? '&spaceId=' + encodeURIComponent(this.space.id) : '')
        : this.space ? '/api/files/spaces/' + encodeURIComponent(this.space.id) + '/children?path=' + encodeURIComponent(this.directory)
          : '/api/files/recent?limit=50';
      const result = JSON.parse(await gatewaySession.request(path)) as XopcFiles;
      if (!Array.isArray(result.items)) throw new Error('INVALID_FILE_LIST');
      if (generation === this.generation) this.items = result.items;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  choose(space: XopcFileSpace): void {
    if (this.busy) return;
    this.space = space; this.directory = ''; this.selected = undefined; this.load();
  }
  parent(): void {
    if (this.busy) return;
    if (this.selected) this.selected = undefined;
    else if (this.directory) { const parts = this.directory.split('/'); parts.pop(); this.directory = parts.join('/'); }
    else this.space = undefined;
    this.load();
  }
  async open(file: XopcFile): Promise<void> {
    if (this.busy) return;
    if (file.kind === 'directory') {
      this.space = this.spaces.find((space): boolean => space.id === file.spaceId);
      this.directory = file.relativePath; await this.load(); return;
    }
    this.selected = file; this.content = ''; this.savedContent = ''; this.editable = false; this.error = '';
    const text = file.mimeType.startsWith('text/') || ['application/json', 'application/xml'].includes(file.mimeType);
    if (!text || file.size > 1024 * 1024 || !file.capabilities.includes('preview')) return;
    this.busy = true; const generation = ++this.generation;
    try {
      const content = await gatewaySession.request('/api/files/' + encodeURIComponent(file.id) + '/content');
      if (generation !== this.generation) return;
      this.content = content; this.savedContent = content; this.editable = file.capabilities.includes('edit');
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  async save(): Promise<void> {
    const file = this.selected;
    if (!file || !this.editable || this.busy) return;
    this.busy = true; this.error = '';
    try {
      const body: XopcFileWrite = { content: this.content, revision: file.revision };
      const result = JSON.parse(await gatewaySession.request('/api/files/' + encodeURIComponent(file.id) + '/content', 'PUT', JSON.stringify(body))) as XopcFileResult;
      if (!result.resource?.revision) throw new Error('INVALID_FILE_RESPONSE');
      this.selected = result.resource; this.savedContent = body.content;
    } catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
  }
  async remove(): Promise<void> {
    const file = this.selected;
    if (!file?.capabilities.includes('delete') || this.busy) return;
    this.busy = true; this.error = '';
    try { await gatewaySession.request('/api/files/' + encodeURIComponent(file.id), 'DELETE'); this.selected = undefined; }
    catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
    if (!this.selected) await this.load();
  }
  async upload(context: common.Context): Promise<void> {
    if (!this.space?.writable || this.busy) return;
    this.busy = true; this.error = '';
    let succeeded = false;
    try { await this.transfer.upload(context, this.space.id, this.directory); succeeded = true; }
    catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
    if (succeeded) await this.load();
  }
  async download(context: common.Context): Promise<void> {
    if (!this.selected?.capabilities.includes('download') || this.busy) return;
    this.busy = true; this.error = '';
    try { await this.transfer.download(context, this.selected); }
    catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
  }
}
