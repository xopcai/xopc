import { XopcChatRepository } from '../repository/chatRepository';
import { realtimeClient } from '../service/realtimeClient';
import { XopcChatRow, XopcSessionItem, XopcStreamEvent, XopcChatAttachment, XopcContextRef, XopcQueueState, XopcHistoryMedia, XopcMessage, XopcHistory } from '../model/chat';
import { dedupeChatHistory, chatHistoryOverlap } from '../common/chatHistory';
import { XopcEvent } from '../model/realtime';
import { historyRows } from '../common/chatProtocol';
import { mergeAssistantRows, chatAttachments } from '../common/chatRichContent';
import { reduceChatStream } from '../common/chatStream';
import { XopcInputAttachment } from '../model/sessionCommand';

interface XopcPendingChatSend {
  conversationId: string;
  transcriptId?: string;
  row: XopcChatRow;
  attachments: XopcChatAttachment[];
  refs: XopcContextRef[];
  delivery: string;
}

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
  @Trace cachedHistory: boolean = false;
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
  private outbox: Map<string, XopcPendingChatSend> = new Map<string, XopcPendingChatSend>();
  private olderPending: boolean = false;
  private prefetchKey: string = '';
  private prefetchedHistory?: Promise<XopcHistory | undefined>;
  private transcriptId?: string;
  private before: string = '';
  private search: string = '';
  private snapshotMode: boolean = false;
  private refreshTimer: number = -1;
  private main: boolean = false;
  private disposed: boolean = false;
  private listRequest: number = 0;
  private recoveryRequest: number = 0;
  private hasNetworkHistory: boolean = false;

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

  reconnect(): void { realtimeClient.start(); }

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
    this.prefetchKey = ''; this.prefetchedHistory = undefined;
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
    this.prefetchKey = ''; this.prefetchedHistory = undefined;
    if (this.runId && XopcChatViewModel.owner === this) realtimeClient.unsubscribe('run:' + this.runId);
    this.selection++; this.historyRequest++; this.olderPending = false;
    this.selectedId = id; this.rows = []; this.runId = ''; this.streaming = ''; this.thinking = ''; this.tool = '';
    this.liveRow = undefined; this.historyMessages = []; this.rows = this.pendingRows();
    this.cachedHistory = false; this.hasNetworkHistory = false;
    this.transcriptId = undefined; this.title = ''; this.agentId = ''; this.projectId = ''; this.status = ''; this.hasOlder = false;
    this.before = ''; this.error = ''; this.loading = true;
    const selection = this.selection;
    if (this.main) {
      this.repository.saveMainConversation(id).catch((_error: Error): void => {
        if (!this.disposed && selection === this.selection) this.error = 'CHAT_SELECTION_SAVE_FAILED';
      });
    }
    try {
      const local = await this.repository.draft(id);
      if (this.disposed || selection !== this.selection) return;
      if (local) { this.agentId = local.creation.agentId; this.projectId = local.creation.projectId || ''; }
      await this.restorePendingInput(id, selection);
      if (this.disposed || selection !== this.selection) return;
      await this.repository.reconcile(id);
      const draft = await this.repository.draft(id);
      if (this.disposed || selection !== this.selection) return;
      if (draft) return;
      this.restoreCachedHistory(id, selection);
      await this.recover();
    } catch (error) {
      if (!this.disposed && selection === this.selection) {
        this.error = (error as Error).message;
        await this.restoreCachedHistory(id, selection);
      }
    } finally {
      if (!this.disposed && selection === this.selection) this.loading = false;
    }
  }

  private async restoreCachedHistory(id: string, selection: number): Promise<void> {
    try {
      const page = await this.repository.cachedHistory(id);
      if (!page || this.disposed || selection !== this.selection || this.hasNetworkHistory) return;
      const rows = mergeAssistantRows(historyRows(page));
      this.historyMessages = page.session.messages;
      this.rows = rows.concat(this.pendingRows().filter((row: XopcChatRow): boolean => !rows.some((saved: XopcChatRow): boolean => saved.id === row.id)));
      this.title = page.session.name || ''; this.transcriptId = page.session.transcriptId;
      this.before = page.pagination.nextBeforeCursor || ''; this.hasOlder = page.pagination.hasMore && !!this.before;
      this.cachedHistory = true;
    } catch (_) { /* Cache is optional; network recovery remains authoritative. */ }
  }

  back(): void {
    if (this.sending) return;
    this.prefetchKey = ''; this.prefetchedHistory = undefined;
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

  private olderPageKey(): string {
    return JSON.stringify([this.selection, this.selectedId, this.transcriptId || '', this.before]);
  }

  prefetchOlder(): void {
    if (this.disposed || this.loading || this.cachedHistory || !this.hasOlder || !this.before || !this.transcriptId || this.connection !== 'connected') return;
    const key = this.olderPageKey();
    if (key === this.prefetchKey) return;
    this.prefetchKey = key;
    // Keep one page ahead without modifying visible rows or showing a loading state.
    this.prefetchedHistory = this.repository.history(this.selectedId, this.before, this.transcriptId)
      .catch((_error: Error): undefined => undefined);
  }

  async loadHistory(older: boolean, beforePrepend: () => void = (): void => {}): Promise<void> {
    if (!this.selectedId || (older && (this.olderPending || !this.hasOlder))) return;
    if (older) this.olderPending = true;
    const request = ++this.historyRequest;
    const selection = this.selection; const before = older ? this.before : '';
    try {
      const prefetched = older && this.prefetchKey === this.olderPageKey() ? this.prefetchedHistory : undefined;
      const prepared = prefetched ? await prefetched : undefined;
      if (selection !== this.selection || request !== this.historyRequest) return;
      const result = prepared || await this.repository.history(this.selectedId, before, older ? this.transcriptId ?? '' : '');
      if (selection !== this.selection || request !== this.historyRequest) return;
      // Validate before touching retained pages or their cursor.
      historyRows(result, before || 'latest');
      if (result.session.key !== this.selectedId) throw new Error('INVALID_HISTORY_SESSION');
      if (older) beforePrepend();
      if (!older) { this.hasNetworkHistory = true; this.cachedHistory = false; }
      if (!older && !this.runId) this.repository.rememberHistory(this.selectedId, result).catch((_error: Error): void => {});
      const sameTranscript = !!this.transcriptId && this.transcriptId === result.session.transcriptId;
      if (result.session.transcriptId) {
        this.outbox.forEach((input: XopcPendingChatSend, id: string): void => {
          if (input.conversationId === this.selectedId && input.transcriptId && input.transcriptId !== result.session.transcriptId) this.outbox.delete(id);
        });
      }
      const overlap = !older && sameTranscript ? chatHistoryOverlap(this.historyMessages, result.session.messages) : -1;
      const preserveCursor = !older && overlap >= 0;
      this.historyMessages = dedupeChatHistory(older && sameTranscript
        ? result.session.messages.concat(this.historyMessages)
        : preserveCursor ? this.historyMessages.slice(0, overlap).concat(result.session.messages) : result.session.messages);
      const combined: XopcHistory = { session: { key: result.session.key, messages: this.historyMessages }, pagination: result.pagination };
      const confirmed = mergeAssistantRows(historyRows(combined));
      confirmed.forEach((row: XopcChatRow): void => { if (row.role === 'user') this.outbox.delete(row.id); });
      this.rows = this.mergePendingRows(confirmed);
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

  private async restorePendingInput(id: string, selection: number): Promise<void> {
    const command = await this.repository.pendingInput(id);
    if (!command || this.disposed || selection !== this.selection || this.outbox.has(command.clientMessageId)) return;
    const attachments = (command.input.attachments || []).map((file: XopcInputAttachment): XopcChatAttachment => ({
      type: file.type, name: file.name, mimeType: file.mimeType, size: file.size, data: file.data,
      uri: file.uri, workspaceRelativePath: file.workspaceRelativePath, duration: file.durationSeconds }));
    const media = attachments.map((file: XopcChatAttachment, index: number): XopcHistoryMedia => ({
      id: command.clientMessageId + ':attachment:' + index, name: file.name, type: file.type, mimeType: file.mimeType,
      size: file.size, uri: file.uri || '', data: file.data, workspaceRelativePath: file.workspaceRelativePath, duration: file.duration }));
    const refs = command.input.contextRefs || [];
    const row: XopcChatRow = { id: command.clientMessageId, role: 'user', text: command.input.content,
      media: chatAttachments(media, command.clientMessageId), refs, sendState: 'failed' };
    this.outbox.set(row.id, { conversationId: id, transcriptId: command.expectedTranscriptId,
      row, attachments, refs, delivery: command.delivery || 'next' });
    this.rows = this.rows.concat([row]);
  }

  private pendingRows(): XopcChatRow[] {
    const rows: XopcChatRow[] = [];
    this.outbox.forEach((input: XopcPendingChatSend): void => { if (input.conversationId === this.selectedId) rows.push(input.row); });
    return rows;
  }

  private mergePendingRows(confirmed: XopcChatRow[]): XopcChatRow[] {
    const merged = confirmed.slice();
    for (const pending of this.pendingRows()) {
      const previousIndex = this.rows.findIndex((row: XopcChatRow): boolean => row.id === pending.id);
      let insertAt = -1;
      if (previousIndex >= 0) {
        for (let index = previousIndex + 1; index < this.rows.length; index++) {
          insertAt = merged.findIndex((row: XopcChatRow): boolean => row.id === this.rows[index].id);
          if (insertAt >= 0) break;
        }
      }
      if (insertAt >= 0) merged.splice(insertAt, 0, pending); else merged.push(pending);
    }
    return merged;
  }

  private updateSendState(input: XopcPendingChatSend, state: string): void {
    if (!this.outbox.has(input.row.id)) return;
    input.row = { id: input.row.id, role: 'user', text: input.row.text, media: input.row.media, refs: input.refs, sendState: state };
    if (input.conversationId === this.selectedId && !this.disposed) {
      this.rows = this.rows.map((row: XopcChatRow): XopcChatRow => row.id === input.row.id ? input.row : row);
    }
  }

  async send(content: string, attachments: XopcChatAttachment[] = [], delivery: string = 'next', refs: XopcContextRef[] = [],
    onEnqueued: () => void = (): void => {}): Promise<boolean> {
    if (this.disposed || this.loading || this.sending || this.cachedHistory || !this.selectedId || (!content.trim() && !attachments.length && !refs.length)) return false;
    if (delivery !== 'next' && delivery !== 'steer') return false;
    const id = this.repository.uuid();
    const media = attachments.map((file: XopcChatAttachment, index: number): XopcHistoryMedia => ({
      id: id + ':attachment:' + index, name: file.name, type: file.type, mimeType: file.mimeType,
      size: file.size, uri: file.uri || '', data: file.data, workspaceRelativePath: file.workspaceRelativePath, duration: file.duration }));
    const row: XopcChatRow = { id, role: 'user', text: content, media: chatAttachments(media, id), refs: refs.slice(), sendState: 'sending' };
    const input: XopcPendingChatSend = { conversationId: this.selectedId, transcriptId: this.transcriptId,
      row, attachments: attachments.slice(), refs: refs.slice(), delivery };
    this.outbox.set(id, input); this.rows = this.rows.concat([row]);
    this.historyRequest++; this.recoveryRequest++; this.olderPending = false;
    onEnqueued();
    return this.deliver(input);
  }

  async retrySend(id: string): Promise<boolean> {
    const input = this.outbox.get(id);
    if (!input || input.conversationId !== this.selectedId || input.row.sendState !== 'failed' || this.sending || this.disposed || this.loading || this.cachedHistory) return false;
    return this.deliver(input);
  }

  private async deliver(input: XopcPendingChatSend): Promise<boolean> {
    this.sending = true; this.error = '';
    const selection = this.selection;
    this.updateSendState(input, 'sending');
    try {
      if (this.connection !== 'connected') throw new Error('OFFLINE');
      const alreadyRunning = !!this.runId;
      const run = await this.repository.send(input.conversationId, input.row.text, input.row.id, input.transcriptId, input.attachments, input.delivery, input.refs);
      if (selection !== this.selection) return false;
      // In-flight reads predate this acceptance and must not roll back the visible input or run.
      this.historyRequest++; this.recoveryRequest++; this.olderPending = false;
      this.hasNetworkHistory = true;
      this.updateSendState(input, 'sent');
      if (!alreadyRunning) { this.snapshotMode = false; this.streaming = ''; this.thinking = ''; this.tool = ''; this.liveRow = undefined; }
      this.trackRun(run);
      if (!run) await this.recover();
      return true;
    } catch (_) {
      // A matching history row is authoritative even if the HTTP acknowledgement was lost.
      if (!this.outbox.has(input.row.id)) return true;
      this.updateSendState(input, 'failed'); return false;
    }
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
    if (event.event === 'user_message') {
      if (this.liveRow?.text) this.recover();
      return;
    }
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
