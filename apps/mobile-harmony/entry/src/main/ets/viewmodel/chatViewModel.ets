import { XopcChatRepository } from '../repository/chatRepository';
import { realtimeClient } from '../service/realtimeClient';
import { XopcChatRow, XopcSessionItem, XopcStreamEvent, XopcChatAttachment } from '../model/chat';
import { chatInputIdentity } from '../common/attachments';
import { XopcEvent } from '../model/realtime';
import { historyRows } from '../common/chatProtocol';

@ObservedV2
export class XopcChatViewModel {
  @Trace sessions: XopcSessionItem[] = [];
  @Trace rows: XopcChatRow[] = [];
  @Trace selectedId: string = '';
  @Trace title: string = '';
  @Trace status: string = '';
  @Trace loading: boolean = false;
  @Trace sending: boolean = false;
  @Trace error: string = '';
  @Trace connection: string = 'connecting';
  @Trace runId: string = '';
  @Trace streaming: string = '';
  @Trace thinking: string = '';
  @Trace tool: string = '';
  @Trace hasMore: boolean = false;
  @Trace hasOlder: boolean = false;
  private repository: XopcChatRepository = new XopcChatRepository();
  private selection: number = 0;
  private historyRequest: number = 0;
  private olderPending: boolean = false;
  private transcriptId?: string;
  private before: string = '';
  private search: string = '';
  private snapshotMode: boolean = false;
  private refreshTimer: number = -1;
  private pendingContent: string = '';
  private pendingId: string = '';

  start(initialId: string = ''): void {
    realtimeClient.onState = (state: string): void => {
      this.connection = state;
      if (state === 'connected' && this.selectedId) this.recover();
    };
    realtimeClient.onEvent = (event: XopcEvent): void => { this.event(event); };
    realtimeClient.onGap = (_topic: string): void => { this.recover(); };
    try { realtimeClient.turnClaim(); this.connection = 'connected'; } catch (_) {}
    realtimeClient.start();
    if (initialId) this.open(initialId); else this.loadList();
  }

  dispose(): void {
    this.selection++; clearTimeout(this.refreshTimer);
    if (this.runId) realtimeClient.unsubscribe('run:' + this.runId);
    realtimeClient.onState = (_state: string): void => {};
    realtimeClient.onEvent = (_event: XopcEvent): void => {};
    realtimeClient.onGap = (_topic: string): void => {};
  }

  async loadList(search: string = this.search, more: boolean = false): Promise<void> {
    if (this.loading) return;
    this.loading = true; this.error = ''; this.search = search;
    try {
      const page = await this.repository.list(search, more ? this.sessions.length : 0);
      this.sessions = more ? this.sessions.concat(page.items.filter((item): boolean => !this.sessions.some((old): boolean => old.key === item.key))) : page.items;
      this.hasMore = page.hasMore;
    } catch (error) { this.error = (error as Error).message; }
    finally { this.loading = false; }
  }

  async create(): Promise<void> {
    if (this.loading || this.sending) return;
    this.loading = true;
    try { const id = await this.repository.create(); this.loading = false; await this.open(id); }
    catch (error) { this.error = (error as Error).message; }
    finally { this.loading = false; }
  }

  async open(id: string): Promise<void> {
    if (this.sending) return;
    if (this.runId) realtimeClient.unsubscribe('run:' + this.runId);
    this.selection++; this.historyRequest++; this.olderPending = false;
    this.selectedId = id; this.rows = []; this.runId = ''; this.streaming = ''; this.thinking = ''; this.tool = '';
    this.transcriptId = undefined; this.title = ''; this.status = ''; this.hasOlder = false;
    this.pendingId = ''; this.pendingContent = ''; this.before = ''; this.error = ''; this.loading = true;
    const selection = this.selection;
    await this.recover();
    if (selection === this.selection) this.loading = false;
  }

  back(): void {
    if (this.sending) return;
    this.selection++; clearTimeout(this.refreshTimer); this.refreshTimer = -1;
    if (this.runId) realtimeClient.unsubscribe('run:' + this.runId);
    this.selectedId = ''; this.runId = ''; this.rows = []; this.loading = false;
    this.loadList();
  }

  private async recover(): Promise<void> {
    const id = this.selectedId; const selection = this.selection;
    if (!id) return;
    this.snapshotMode = true; this.streaming = ''; this.thinking = '';
    try {
      await this.loadHistory(false);
      const run = await this.repository.activeRun(id);
      if (selection !== this.selection) return;
      this.trackRun(run.active ? run.runId ?? '' : '');
    } catch (error) { if (selection === this.selection) this.error = (error as Error).message; }
  }

  async loadHistory(older: boolean): Promise<void> {
    if (!this.selectedId || (older && (this.olderPending || !this.hasOlder))) return;
    if (older) this.olderPending = true;
    const request = ++this.historyRequest;
    const selection = this.selection; const before = older ? this.before : '';
    try {
      const result = await this.repository.history(this.selectedId, before);
      if (selection !== this.selection || request !== this.historyRequest) return;
      const rows = historyRows(result, before || 'latest');
      this.rows = older ? rows.concat(this.rows) : rows;
      this.title = result.session.name ?? '';
      this.status = result.session.status ?? '';
      this.transcriptId = result.session.transcriptId;
      this.before = result.pagination.nextBeforeCursor ?? '';
      this.hasOlder = result.pagination.hasMore && this.before.length > 0;
    } catch (error) { if (selection === this.selection && request === this.historyRequest) this.error = (error as Error).message; }
    finally { if (older && selection === this.selection) this.olderPending = false; }
  }

  private trackRun(id: string): void {
    if (this.runId === id) return;
    if (this.runId && this.runId !== id) realtimeClient.unsubscribe('run:' + this.runId);
    this.runId = id;
    if (id) realtimeClient.subscribe('run:' + id);
  }

  async send(content: string, attachments: XopcChatAttachment[] = []): Promise<boolean> {
    if (this.sending || this.runId || !this.selectedId || (!content.trim() && !attachments.length) || this.connection !== 'connected') return false;
    this.sending = true; this.error = '';
    const selection = this.selection;
    // Retry an ambiguous network result with the same idempotent input identity.
    const identity = chatInputIdentity(content, attachments);
    if (identity !== this.pendingContent || !this.pendingId) { this.pendingContent = identity; this.pendingId = this.repository.uuid(); }
    try {
      const run = await this.repository.send(this.selectedId, content, this.pendingId, this.transcriptId, attachments);
      if (selection !== this.selection) return false;
      const attachmentNames = attachments.map((file: XopcChatAttachment): string => '[' + file.name + ']').join('\n');
      this.rows = this.rows.concat([{ id: this.pendingId, role: 'user', text: content + (attachmentNames ? '\n' + attachmentNames : '') }]);
      this.pendingId = ''; this.pendingContent = ''; this.snapshotMode = false;
      this.streaming = ''; this.thinking = ''; this.trackRun(run);
      if (!run) await this.recover();
      return true;
    } catch (error) { this.error = (error as Error).message; return false; }
    finally { this.sending = false; }
  }

  private event(event: XopcEvent): void {
    if (event.topic !== 'run:' + this.runId) return;
    const data = event.data as XopcStreamEvent;
    if (data.conversationId !== this.selectedId || !data.payload) return;
    const payload = data.payload;
    if (event.event === 'run_end') {
      this.trackRun(''); this.streaming = ''; this.thinking = ''; this.tool = '';
      this.loadHistory(false);
    } else if (event.event === 'error') this.error = payload.message ?? 'RUN_FAILED';
    else if (event.event === 'tool_start') this.tool = payload.toolName ?? '';
    else if (event.event === 'tool_end') this.tool = '';
    else if (this.snapshotMode) {
      if (this.refreshTimer === -1) this.refreshTimer = setTimeout((): void => {
        this.refreshTimer = -1; this.loadHistory(false);
      }, 750);
    } else if (event.event === 'assistant_delta') this.streaming += payload.delta ?? '';
    else if (event.event === 'thinking_delta') this.thinking += payload.delta ?? '';
  }

  async abort(): Promise<void> {
    try { if (this.runId) await this.repository.abort(this.runId); await this.recover(); }
    catch (error) { this.error = (error as Error).message; }
  }

  async rename(name: string): Promise<void> {
    try { await this.repository.rename(this.selectedId, name); this.title = name; }
    catch (error) { this.error = (error as Error).message; }
  }

  async action(action: string): Promise<void> {
    try {
      await this.repository.action(this.selectedId, action);
      if (action === 'delete' || action === 'archive') this.back(); else await this.recover();
    } catch (error) { this.error = (error as Error).message; }
  }
}
