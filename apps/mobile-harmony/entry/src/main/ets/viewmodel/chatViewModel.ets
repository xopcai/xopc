import { XopcChatRepository } from '../repository/chatRepository';
import { realtimeClient } from '../service/realtimeClient';
import { XopcChatRow, XopcSessionItem, XopcStreamEvent, XopcChatAttachment, XopcContextRef, XopcQueueState, XopcHistoryMedia, XopcMessage, XopcHistory } from '../model/chat';
import { dedupeChatHistory, chatHistoryOverlap } from '../common/chatHistory';
import { chatInputIdentity } from '../common/attachments';
import { XopcEvent } from '../model/realtime';
import { historyRows } from '../common/chatProtocol';
import { mergeAssistantRows, chatAttachments } from '../common/chatRichContent';
import { reduceChatStream } from '../common/chatStream';

@ObservedV2
export class XopcChatViewModel {
  private static owner?: XopcChatViewModel;
  @Trace sessions: XopcSessionItem[] = [];
  @Trace rows: XopcChatRow[] = [];
  @Trace selectedId: string = '';
  @Trace title: string = '';
  @Trace agentId: string = '';
  @Trace projectId: string = '';
  @Trace status: string = '';
  @Trace loading: boolean = false;
  @Trace sending: boolean = false;
  @Trace error: string = '';
  @Trace connection: string = 'connecting';
  @Trace runId: string = '';
  @Trace streaming: string = '';
  @Trace thinking: string = '';
  @Trace tool: string = '';
  @Trace liveRow?: XopcChatRow;
  @Trace hasMore: boolean = false;
  @Trace hasOlder: boolean = false;
  @Trace auxiliaryRevision: number = 0;
  private repository: XopcChatRepository = new XopcChatRepository();
  private selection: number = 0;
  private historyRequest: number = 0;
  private historyMessages: XopcMessage[] = [];
  private olderPending: boolean = false;
  private transcriptId?: string;
  private before: string = '';
  private search: string = '';
  private snapshotMode: boolean = false;
  private refreshTimer: number = -1;
  private pendingContent: string = '';
  private pendingId: string = '';
  private main: boolean = false;
  private disposed: boolean = false;
  private listRequest: number = 0;
  private recoveryRequest: number = 0;

  start(initialId: string = '', main: boolean = !initialId): void {
    this.main = main;
    this.activate();
    if (initialId) this.open(initialId); else this.restoreMain();
  }

  activate(): void {
    if (this.disposed || XopcChatViewModel.owner === this) return;
    XopcChatViewModel.owner?.deactivate();
    XopcChatViewModel.owner = this;
    realtimeClient.onState = (state: string): void => {
      this.connection = state;
      if (state === 'connected' && this.selectedId) this.recover();
    };
    realtimeClient.onEvent = (event: XopcEvent): void => { this.event(event); };
    realtimeClient.onGap = (_topic: string): void => { this.recover(); };
    try { realtimeClient.turnClaim(); this.connection = 'connected'; } catch (_) {}
    realtimeClient.start();
    realtimeClient.subscribe('gateway'); realtimeClient.subscribe('sessions');
    if (this.selectedId) this.recover();
  }

  deactivate(): void {
    clearTimeout(this.refreshTimer); this.refreshTimer = -1;
    if (XopcChatViewModel.owner !== this) return;
    if (this.runId) realtimeClient.unsubscribe('run:' + this.runId);
    realtimeClient.onState = (_state: string): void => {};
    realtimeClient.onEvent = (_event: XopcEvent): void => {};
    realtimeClient.onGap = (_topic: string): void => {};
    XopcChatViewModel.owner = undefined;
  }

  private async restoreMain(): Promise<void> {
    this.loading = true;
    const selection = this.selection;
    try {
      const id = await this.repository.mainConversation();
      if (this.disposed || selection !== this.selection) return;
      this.loading = false;
      if (id) await this.open(id); else await this.create();
    } catch (error) { if (!this.disposed && selection === this.selection) { this.error = (error as Error).message; this.loading = false; } }
  }

  dispose(): void {
    this.deactivate(); this.disposed = true; this.listRequest++;
    this.selection++; clearTimeout(this.refreshTimer);
  }

  async loadList(search: string = this.search, more: boolean = false): Promise<void> {
    if (this.loading) return;
    this.loading = true; this.error = ''; this.search = search;
    const request = ++this.listRequest;
    try {
      const page = await this.repository.list(search, more ? this.sessions.length : 0);
      if (request !== this.listRequest || this.disposed) return;
      this.sessions = more ? this.sessions.concat(page.items.filter((item): boolean => !this.sessions.some((old): boolean => old.key === item.key))) : page.items;
      this.hasMore = page.hasMore;
    } catch (error) { if (request === this.listRequest && !this.disposed) this.error = (error as Error).message; }
    finally { if (request === this.listRequest && !this.disposed) this.loading = false; }
  }

  async create(agentId: string = this.agentId, projectId: string | null = this.projectId || null, executionMode?: string): Promise<void> {
    if (this.loading || this.sending || this.disposed) return;
    this.loading = true;
    const selection = this.selection;
    try {
      const id = await this.repository.create(projectId, agentId || undefined, executionMode);
      if (this.disposed || selection !== this.selection) return;
      this.loading = false; await this.open(id);
    } catch (error) { if (!this.disposed && selection === this.selection) this.error = (error as Error).message; }
    finally { if (!this.disposed && selection === this.selection) this.loading = false; }
  }

  async open(id: string): Promise<void> {
    if (this.sending || this.disposed || !id) return;
    if (this.runId && XopcChatViewModel.owner === this) realtimeClient.unsubscribe('run:' + this.runId);
    this.selection++; this.historyRequest++; this.olderPending = false;
    this.selectedId = id; this.rows = []; this.runId = ''; this.streaming = ''; this.thinking = ''; this.tool = '';
    this.liveRow = undefined; this.historyMessages = [];
    this.transcriptId = undefined; this.title = ''; this.agentId = ''; this.projectId = ''; this.status = ''; this.hasOlder = false;
    this.pendingId = ''; this.pendingContent = ''; this.before = ''; this.error = ''; this.loading = true;
    const selection = this.selection;
    if (this.main) {
      this.repository.saveMainConversation(id).catch((_error: Error): void => {
        if (!this.disposed && selection === this.selection) this.error = 'CHAT_SELECTION_SAVE_FAILED';
      });
    }
    await this.recover();
    if (selection === this.selection) this.loading = false;
  }

  back(): void {
    if (this.sending) return;
    this.selection++; clearTimeout(this.refreshTimer); this.refreshTimer = -1;
    if (this.runId) realtimeClient.unsubscribe('run:' + this.runId);
    this.selectedId = ''; this.runId = ''; this.rows = []; this.loading = false; this.liveRow = undefined;
  }

  private async recover(): Promise<void> {
    const id = this.selectedId; const selection = this.selection;
    if (!id) return;
    const request = ++this.recoveryRequest;
    this.snapshotMode = true;
    try {
      await this.loadHistory(false);
      if (request !== this.recoveryRequest || selection !== this.selection || this.disposed) return;
      const run = await this.repository.activeRun(id);
      if (request !== this.recoveryRequest || selection !== this.selection || this.disposed) return;
      this.trackRun(run.active ? run.runId ?? '' : '');
    } catch (error) { if (request === this.recoveryRequest && selection === this.selection && !this.disposed) this.error = (error as Error).message; }
  }

  async retryHistory(): Promise<void> {
    if (this.loading || this.disposed) return;
    this.error = '';
    if (!this.selectedId && this.main) { await this.restoreMain(); return; }
    this.loading = true;
    try { await this.recover(); } finally { this.loading = false; }
  }

  async loadHistory(older: boolean): Promise<void> {
    if (!this.selectedId || (older && (this.olderPending || !this.hasOlder))) return;
    if (older) this.olderPending = true;
    const request = ++this.historyRequest;
    const selection = this.selection; const before = older ? this.before : '';
    try {
      const result = await this.repository.history(this.selectedId, before);
      if (selection !== this.selection || request !== this.historyRequest) return;
      // Validate before touching retained pages or their cursor.
      historyRows(result, before || 'latest');
      const sameTranscript = !!this.transcriptId && this.transcriptId === result.session.transcriptId;
      const overlap = !older && sameTranscript ? chatHistoryOverlap(this.historyMessages, result.session.messages) : -1;
      const preserveCursor = !older && overlap >= 0;
      this.historyMessages = dedupeChatHistory(older && sameTranscript
        ? result.session.messages.concat(this.historyMessages)
        : preserveCursor ? this.historyMessages.slice(0, overlap).concat(result.session.messages) : result.session.messages);
      const combined: XopcHistory = { session: { key: result.session.key, messages: this.historyMessages }, pagination: result.pagination };
      this.rows = mergeAssistantRows(historyRows(combined));
      if (!older && this.snapshotMode) { this.liveRow = undefined; this.streaming = ''; this.thinking = ''; this.tool = ''; }
      this.title = result.session.name ?? '';
      this.agentId = result.session.agentId ?? '';
      this.projectId = result.session.projectId ?? '';
      this.status = result.session.status ?? '';
      this.transcriptId = result.session.transcriptId;
      if (!preserveCursor) {
        this.before = result.pagination.nextBeforeCursor ?? '';
        this.hasOlder = result.pagination.hasMore && this.before.length > 0;
      }
    } catch (error) { if (selection === this.selection && request === this.historyRequest) this.error = (error as Error).message; }
    finally { if (older && selection === this.selection) this.olderPending = false; }
  }

  private trackRun(id: string): void {
    if (this.runId && this.runId !== id && XopcChatViewModel.owner === this) realtimeClient.unsubscribe('run:' + this.runId);
    this.runId = id;
    if (id && XopcChatViewModel.owner === this) realtimeClient.subscribe('run:' + id);
  }

  async send(content: string, attachments: XopcChatAttachment[] = [], delivery: string = 'next', refs: XopcContextRef[] = []): Promise<boolean> {
    if (this.sending || !this.selectedId || (!content.trim() && !attachments.length && !refs.length) || this.connection !== 'connected') return false;
    if (delivery !== 'next' && delivery !== 'steer') return false;
    this.sending = true; this.error = '';
    const selection = this.selection;
    // Retry an ambiguous network result with the same idempotent input identity.
    const identity = delivery + ':' + chatInputIdentity(content, attachments) + ':' + JSON.stringify(refs);
    if (identity !== this.pendingContent || !this.pendingId) { this.pendingContent = identity; this.pendingId = this.repository.uuid(); }
    try {
      const alreadyRunning = !!this.runId;
      const run = await this.repository.send(this.selectedId, content, this.pendingId, this.transcriptId, attachments, delivery, refs);
      if (selection !== this.selection) return false;
      if (!alreadyRunning) {
        const media = attachments.map((file: XopcChatAttachment, index: number): XopcHistoryMedia => ({
          id: this.pendingId + ':attachment:' + index, name: file.name, type: file.type, mimeType: file.mimeType,
          size: file.size, uri: file.uri || '', data: file.data, workspaceRelativePath: file.workspaceRelativePath }));
        this.rows = this.rows.concat([{ id: this.pendingId, role: 'user', text: content, media: chatAttachments(media, this.pendingId), refs }]);
      }
      this.pendingId = ''; this.pendingContent = '';
      if (!alreadyRunning) { this.snapshotMode = false; this.streaming = ''; this.thinking = ''; this.tool = ''; this.liveRow = undefined; }
      this.trackRun(run);
      if (!run) await this.recover();
      return true;
    } catch (error) { if (selection === this.selection) this.error = (error as Error).message; return false; }
    finally { this.sending = false; }
  }

  private event(event: XopcEvent): void {
    if (event.topic === 'gateway' || event.topic === 'sessions') {
      const state = event.data as XopcStreamEvent;
      if (state.conversationId === this.selectedId && (event.event === 'session.input-state' || event.event === 'clarification.updated')) {
        this.auxiliaryRevision++;
        if (event.event === 'session.input-state' && !this.sending && ((event.data as XopcQueueState).activeRunId || '') !== this.runId) this.recover();
      }
      return;
    }
    if (event.topic !== 'run:' + this.runId) return;
    const data = event.data as XopcStreamEvent;
    if (data.conversationId !== this.selectedId || !data.payload) return;
    const payload = data.payload;
    if (event.event === 'run_end') {
      if (this.liveRow) this.liveRow = reduceChatStream(this.liveRow, event.event, payload, this.runId);
      this.trackRun(''); this.streaming = ''; this.thinking = ''; this.tool = '';
      this.auxiliaryRevision++;
      this.snapshotMode = true;
      this.loadHistory(false);
    } else if (event.event === 'error') this.error = payload.message ?? 'RUN_FAILED';
    else if (this.snapshotMode) {
      if (this.refreshTimer === -1) this.refreshTimer = setTimeout((): void => {
        this.refreshTimer = -1; this.loadHistory(false);
      }, 750);
    } else {
      this.liveRow = reduceChatStream(this.liveRow, event.event, payload, this.runId);
      this.streaming = this.liveRow.text; this.thinking = this.liveRow.thinking || '';
      this.tool = this.liveRow.toolCalls?.find((call): boolean => call.status === 'running')?.name || '';
    }
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
      if (action === 'delete' || action === 'archive') {
        this.back();
        if (this.main) { await this.repository.saveMainConversation(''); this.loading = false; await this.create(); }
      } else await this.recover();
    } catch (error) { this.error = (error as Error).message; }
  }
}
