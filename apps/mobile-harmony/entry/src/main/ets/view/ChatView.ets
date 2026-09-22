import { XopcChatViewModel } from '../viewmodel/chatViewModel';
import { XopcChatRow, XopcChatAttachment, XopcContextRef, XopcReferenceItem, XopcChatAgent, XopcHistoryMedia } from '../model/chat';
import { XopcChatMessageContent } from './ChatMessageContent';
import { chatAnswerText, chatAttachments } from '../common/chatRichContent';
import { extractMarkdownCodeBlocks } from '../common/chatDisplay';
import { XopcChatMediaView } from './ChatMediaView';
import { XopcChatDisclosure } from '../common/chatDisclosure';
import { advanceChatAutoRead, latestChatAutoRead, XopcAutoReadState } from '../common/chatAutoRead';
import { common } from '@kit.AbilityKit';
import { voiceCapture, XopcVoiceCapture } from '../service/voiceCapture';
import { appSettings } from '../service/settings';
import { pickChatAttachment } from '../service/chatAttachmentPicker';
import { XopcChatDrawer } from './ChatDrawer';
import { XopcChatOptions } from './ChatOptions';
import { XopcChatOptionsViewModel } from '../viewmodel/chatOptionsViewModel';
import { XopcMobileRoute, XopcHomeItem, XopcHomeAction } from '../model/home';
import { mobileRoute } from '../common/homeProtocol';
import { XopcChatAttentionViewModel } from '../viewmodel/chatAttentionViewModel';
import { XopcChatAttentionRow } from './ChatAttention';
import { XopcChatWelcome } from './ChatWelcome';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { XopcChatContext } from './ChatContext';
import { XopcChatContextViewModel } from '../viewmodel/chatContextViewModel';
import { MAX_ATTACHMENTS, validateAttachmentSize } from '../common/attachments';
import { copyChatMessage, saveChatMessage } from '../service/chatMessageActions';
import { pickChatPhoto } from '../service/chatPhotoPicker';
import { XopcChatPromptViewModel } from '../viewmodel/chatPromptViewModel';
import { XopcChatPrompt } from './ChatPrompt';
import { chatReadAloud, XopcChatReadAloud } from '../service/chatReadAloud';
import { XopcChatDrafts } from '../service/chatDrafts';
import { gatewaySession } from '../service/gatewaySession';
import { XopcChatPaletteViewModel } from '../viewmodel/chatPaletteViewModel';
import { XopcPaletteItem } from '../common/composerTokens';
import { COMPOSER_INPUT_MIN, COMPOSER_INPUT_MAX, COMPOSER_TOOL_SIZE, COMPOSER_SEND_SIZE,
  composerExpanded, composerHasPayload } from '../common/composerLayout';
import { shareIntake } from '../service/shareIntake';
import { voiceCall, XopcVoiceCall } from '../service/voiceCall';

@ComponentV2
export struct XopcChatView {
  @Param requestedId: string = '';
  @Param requestRevision: number = 0;
  @Param intakeRevision: number = 0;
  @Param activePage: boolean = true;
  @BuilderParam bottomDock: () => void = this.emptyDock;
  @Param attentionItems: XopcHomeItem[] = [];
  @Event onOpenConversation: (id: string) => void = (_id: string): void => {};
  @Event onAttentionRefresh: () => void = (): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local chat: XopcChatViewModel = new XopcChatViewModel();
  @Local disclosure: XopcChatDisclosure = new XopcChatDisclosure();
  @Local options: XopcChatOptionsViewModel = new XopcChatOptionsViewModel();
  @Local context: XopcChatContextViewModel = new XopcChatContextViewModel();
  @Local prompt: XopcChatPromptViewModel = new XopcChatPromptViewModel();
  @Local refs: XopcContextRef[] = [];
  @Local drawerOpen: boolean = false;
  @Local panelOpen: boolean = false;
  @Local sheetOpen: boolean = false;
  @Local sheetMode: string = 'actions';
  @Local referenceKind: string = 'note';
  @Local draft: string = '';
  @Local showVoice: boolean = false;
  @Computed get expandedComposer(): boolean {
    return composerExpanded(this.draft, this.attachments.length, this.refs.length, !!this.palette.range);
  }
  @Computed get hasPayload(): boolean { return composerHasPayload(this.draft, this.attachments.length, this.refs.length); }
  @Local voice: XopcVoiceCapture = voiceCapture;
  @Local reader: XopcChatReadAloud = chatReadAloud;
  @Local call: XopcVoiceCall = voiceCall;
  @Local attachments: XopcChatAttachment[] = [];
  @Local pickingAttachment: boolean = false;
  @Computed get attachmentPreviews(): XopcHistoryMedia[] {
    return this.attachments.map((file: XopcChatAttachment, index: number): XopcHistoryMedia => {
      const media: XopcHistoryMedia = { id: 'draft:' + index, name: file.name, type: file.type, mimeType: file.mimeType, size: file.size,
        uri: file.uri || '', data: file.data, workspaceRelativePath: file.workspaceRelativePath };
      return chatAttachments([media], media.id)[0] || media;
    });
  }
  @Local atBottom: boolean = true;
  @Local savingNote: boolean = false;
  @Local attention: XopcChatAttentionViewModel = new XopcChatAttentionViewModel();
  @Computed get unseenAttention(): XopcHomeItem[] { return this.attention.unseen(this.attentionItems); }
  @Local restoringDraft: boolean = false;
  @Local palette: XopcChatPaletteViewModel = new XopcChatPaletteViewModel();
  @Local layout: XopcLayoutState = layoutState;
  private cursor: number = 0;
  private drafts: XopcChatDrafts = new XopcChatDrafts();
  private draftScope: string = '';
  private draftGeneration: number = 0;
  private draftTimer: number = -1;
  private disposed: boolean = false;
  private visible: boolean = false;
  private optionsId: string = '';
  private editor: TextAreaController = new TextAreaController();
  private focusComposerOnMount: boolean = false;
  private composerFocusTimer: number = -1;
  private messagesScroller: Scroller = new Scroller();
  private scrollTimer: number = -1;
  private firstVisible: number = 0;
  @Local loadingOlder: boolean = false;
  @Local olderFailed: boolean = false;
  private initialScrollPending: boolean = true;
  private olderGeneration: number = 0;
  private autoReadState?: XopcAutoReadState;

  @Monitor('chat.rows', 'chat.runId', 'chat.selectedId', 'chat.loading', 'activePage', 'reader.continuousConversationId', 'voice.state')
  onAutoReadChange(): void {
    if ((!this.activePage || this.voice.state !== 'idle') && this.reader.continuousConversationId) this.reader.disableContinuous();
    const enabled = this.activePage && !this.disposed && !this.chat.loading && this.voice.state === 'idle'
      && this.reader.continuousConversationId === this.chat.selectedId && !!this.chat.selectedId;
    const next = advanceChatAutoRead(this.autoReadState, this.chat.selectedId, enabled, !!this.chat.runId,
      latestChatAutoRead(this.chat.rows, this.chat.selectedId));
    this.autoReadState = next.state;
    const context = this.getUIContext().getHostContext();
    if (next.candidate && context) this.reader.speak(context, next.candidate.text, 'auto-read-aloud:' + next.candidate.key, appSettings.effectiveLanguage());
  }

  private appliedRequestRevision: number = -1;
  private appliedIntakeRevision: number = -1;

  private applyPalette(item: XopcPaletteItem): void {
    const range = this.palette.range; if (!range || this.restoringDraft) return;
    if (item.kind === 'note') {
      if (!item.sourceId || !item.version) return;
      if (!this.refs.some((ref: XopcContextRef): boolean => ref.kind === 'note' && ref.sourceId === item.sourceId)) {
        if (this.refs.length >= 5) { this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_ref_limit') }); return; }
        this.refs = this.refs.concat([{ kind: 'note', sourceId: item.sourceId, expectedVersion: item.version, title: item.name }]);
      }
    }
    this.draft = this.draft.slice(0, range.start) + item.token + this.draft.slice(range.end);
    this.cursor = range.start + item.token.length; this.palette.close(); this.editor.caretPosition(this.cursor);
  }

  private saveDraft(): void {
    if (this.restoringDraft || !this.draftScope) return;
    this.drafts.save(this.draftScope, { text: this.draft, refs: this.refs, files: this.attachments })
      .catch((_error: Error): void => { if (this.visible) this.chat.error = 'DRAFT_SAVE_FAILED'; });
  }
  @Monitor('draft', 'refs', 'attachments')
  onDraftChange(): void {
    clearTimeout(this.draftTimer);
    if (!this.disposed && !this.restoringDraft) this.draftTimer = setTimeout((): void => { this.saveDraft(); }, 300);
  }
  @Monitor('chat.selectedId')
  async restoreDraft(): Promise<void> {
    const scope = (gatewaySession.currentProfile()?.gatewayId || '') + ':' + this.chat.selectedId;
    if (!this.chat.selectedId || scope === this.draftScope) return;
    clearTimeout(this.draftTimer); this.saveDraft();
    this.initialScrollPending = true; this.atBottom = true; this.palette.close();
    if (this.reader.continuousConversationId !== this.chat.selectedId) this.reader.disableContinuous();
    this.olderGeneration++; this.loadingOlder = false; this.olderFailed = false; this.firstVisible = 0;
    const generation = ++this.draftGeneration;
    this.restoringDraft = true; this.draftScope = scope; this.draft = ''; this.refs = []; this.attachments = [];
    try {
      const saved = await this.drafts.read(scope);
      if (generation !== this.draftGeneration) return;
      if (saved) { this.draft = saved.text; this.refs = saved.refs; this.attachments = saved.files; }
    } catch (_error) { if (generation === this.draftGeneration) this.chat.error = 'DRAFT_RESTORE_FAILED'; }
    finally { if (generation === this.draftGeneration) { this.restoringDraft = false; this.applyShareIntake(); } }
  }

  @Monitor('intakeRevision', 'chat.selectedId', 'restoringDraft')
  applyShareIntake(): void {
    if (this.restoringDraft || !this.chat.selectedId || this.appliedIntakeRevision === this.intakeRevision) return;
    const value = shareIntake.consumeChat(this.chat.selectedId);
    if (!value) return;
    this.appliedIntakeRevision = this.intakeRevision; this.draft = value; this.cursor = value.length;
    this.focusComposerOnMount = true; this.focusMountedComposer();
  }

  @Monitor('chat.rows', 'chat.liveRow', 'chat.streaming', 'chat.thinking', 'chat.tool', 'chat.loading')
  onMessageChange(): void {
    if (!this.visible || (!this.atBottom && !this.initialScrollPending) || this.loadingOlder || (this.chat.loading && !this.chat.cachedHistory)) return;
    clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout((): void => {
      if (this.visible && (this.atBottom || this.initialScrollPending) && !this.loadingOlder) {
        this.initialScrollPending = false; this.messagesScroller.scrollEdge(Edge.Bottom);
      }
    }, 50);
  }
  private async loadOlder(): Promise<void> {
    if (this.loadingOlder || !this.chat.hasOlder || this.chat.loading || this.initialScrollPending) return;
    this.loadingOlder = true;
    this.olderFailed = false;
    const conversationId = this.chat.selectedId;
    const generation = ++this.olderGeneration;
    const headerCount = this.chat.hasOlder ? 1 : 0;
    const anchorIndex = Math.max(headerCount, this.firstVisible);
    const anchor = this.chat.rows[anchorIndex - headerCount]?.id;
    let anchorOffset = 0;
    try { anchorOffset = this.messagesScroller.getItemRect(anchorIndex).y; } catch (_) {}
    const previousRows = this.chat.rows;
    await this.chat.loadHistory(true);
    if (!this.visible || generation !== this.olderGeneration || conversationId !== this.chat.selectedId) return;
    this.olderFailed = previousRows === this.chat.rows && !!this.chat.error;
    if (anchor && this.visible) {
      const index = this.chat.rows.findIndex((row: XopcChatRow): boolean => row.id === anchor || !!row.sourceIds?.includes(anchor));
      setTimeout((): void => {
        if (generation !== this.olderGeneration) return;
        if (this.visible && conversationId === this.chat.selectedId && index >= 0) {
          this.messagesScroller.scrollToIndex(index + (this.chat.hasOlder ? 1 : 0), false, ScrollAlign.START);
          this.messagesScroller.scrollBy(0, -anchorOffset);
        }
        this.loadingOlder = false;
      }, 30);
    } else {
      this.loadingOlder = false;
    }
  }
  private async messageAction(action: string, row: XopcChatRow): Promise<void> {
    try {
      if (action === 'copy') {
        await copyChatMessage(row.role === 'assistant' ? chatAnswerText(row) : row.text); this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_copied') });
      } else if (action === 'copy-code') {
        await copyChatMessage(extractMarkdownCodeBlocks(chatAnswerText(row))); this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_copied') });
      } else if (action === 'edit') { this.draft = row.text; }
      else if (action === 'read') {
        if (this.reader.sourceId === row.id && this.reader.state === 'loading') return;
        if (this.reader.sourceId === row.id && ['playing', 'paused'].includes(this.reader.state)) await this.reader.toggle();
        else {
          const context = this.getUIContext().getHostContext();
          if (context) { await this.voice.cancel(); await this.reader.speak(context, chatAnswerText(row), row.id, appSettings.effectiveLanguage()); }
        }
      }
      else if (action === 'save' && !this.savingNote) {
        this.savingNote = true; await saveChatMessage(chatAnswerText(row));
        this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_saved_note') });
      } else if (action === 'regenerate' && !this.chat.runId) {
        let index = this.chat.rows.findIndex((item: XopcChatRow): boolean => item.id === row.id) - 1;
        while (index >= 0 && this.chat.rows[index].role !== 'user') index--;
        if (index >= 0) {
          const source = this.chat.rows[index];
          const files: XopcChatAttachment[] = (source.media || []).map((file): XopcChatAttachment => ({ type: file.type, name: file.name, mimeType: file.mimeType, size: file.size, data: '', uri: file.uri }));
          await this.chat.send(source.text, files, 'next', source.refs || []); this.options.refreshQueue();
        }
      }
    } catch (error) { if (this.visible) this.chat.error = (error as Error).message; }
    finally { this.savingNote = false; }
  }
  private async fillProductDraft(text: string): Promise<void> {
    if (this.restoringDraft || !this.visible) return;
    const conversationId = this.chat.selectedId;
    await this.voice.cancel();
    if (conversationId !== this.chat.selectedId || this.disposed || !this.visible || this.restoringDraft) return;
    this.showVoice = false; this.setPanel(false); this.draft = text; this.cursor = text.length;
    this.focusComposerOnMount = true; this.focusMountedComposer();
  }

  private userBubbleWidth(row: XopcChatRow): string {
    if ((row.media?.length || 0) > 0 || (row.refs?.length || 0) > 0) return '82%';
    let units = 0;
    for (let index = 0; index < row.text.length; index++) {
      units += row.text.charCodeAt(index) > 255 ? 1 : 0.55;
    }
    const width = Math.max(44, Math.min(262, Math.ceil(units * 16) + 28));
    return width >= 262 ? '82%' : width + 'vp';
  }

  aboutToAppear(): void {
    this.visible = this.activePage;
    if (this.visible) { this.bindBack(); this.attention.activate(); }
    this.appliedRequestRevision = this.requestRevision;
    this.chat.start(this.requestedId, true);
  }
  private bindBack(): void { layoutState.dismissChatOverlay = (): boolean => { return this.dismissOverlay(); }; }
  private dismissOverlay(): boolean {
    if (this.drawerOpen) { this.setDrawer(false); return true; }
    if (this.panelOpen) { this.setPanel(false); return true; }
    return false;
  }
  private setDrawer(open: boolean): void {
    if (open) { this.palette.close(); this.editor.stopEditing(); this.setPanel(false); }
    this.drawerOpen = open; layoutState.chatDrawerOpen = open;
  }
  private setPanel(open: boolean): void {
    if (open) { this.palette.close(); this.editor.stopEditing(); }
    this.panelOpen = open; layoutState.chatActionsOpen = open;
  }
  private dismissComposer(): void {
    clearTimeout(this.composerFocusTimer);
    this.focusComposerOnMount = false;
    this.setPanel(false);
    this.palette.close();
    this.editor.stopEditing();
    this.getUIContext().getFocusController().clearFocus();
  }
  private openSheet(mode: string): void { this.palette.close(); this.editor.stopEditing(); this.setPanel(false); this.sheetMode = mode; this.sheetOpen = true; }
  @Monitor('chat.loading', 'chat.agentId')
  onHistoryReady(): void {
    const id = this.chat.selectedId + ':' + this.chat.agentId;
    if (this.visible && !this.chat.loading && this.chat.selectedId && this.optionsId !== id) {
      this.optionsId = id; this.options.load(this.chat.selectedId, this.chat.agentId); this.context.load(this.chat.selectedId); this.prompt.start(this.chat.selectedId);
    }
  }
  @Monitor('chat.auxiliaryRevision')
  onAuxiliaryState(): void { if (this.visible) { this.options.refreshQueue(); this.prompt.refresh(); } }
  @Monitor('activePage')
  onActivityChange(): void {
    this.visible = this.activePage;
    if (!this.activePage) { clearTimeout(this.composerFocusTimer); this.focusComposerOnMount = false; this.attention.dispose(); this.saveDraft(); this.palette.close(); this.voice.cancel(); this.reader.stop(); this.setDrawer(false); this.setPanel(false); this.sheetOpen = false; this.options.pause(); this.prompt.pause(); this.chat.deactivate(); }
    else { this.attention.activate(); this.bindBack(); this.chat.activate(); this.onHistoryReady(); this.options.resume(); this.prompt.resume(); }
  }
  @Monitor('requestRevision', 'chat.sending')
  onTargetChange(): void {
    if (this.disposed || !this.requestedId || this.appliedRequestRevision === this.requestRevision || this.chat.sending) return;
    this.appliedRequestRevision = this.requestRevision;
    this.dismissComposer(); this.setDrawer(false); this.sheetOpen = false;
    if (this.requestedId === this.chat.selectedId) return;
    this.saveDraft(); this.voice.cancel(); this.reader.stop(); this.showVoice = false;
    this.options.dispose(); this.context.dispose(); this.prompt.dispose();
    this.options = new XopcChatOptionsViewModel(); this.context = new XopcChatContextViewModel();
    this.prompt = new XopcChatPromptViewModel(); this.optionsId = '';
    this.olderGeneration++; this.loadingOlder = false; this.olderFailed = false; this.firstVisible = 0;
    this.chat.open(this.requestedId);
  }
  aboutToDisappear(): void { this.attention.dispose(); this.visible = false; this.disposed = true; clearTimeout(this.composerFocusTimer); clearTimeout(this.scrollTimer); clearTimeout(this.draftTimer); this.saveDraft(); this.draftGeneration++; this.palette.dispose(); this.setDrawer(false); this.setPanel(false); this.prompt.dispose(); this.context.dispose(); this.options.dispose(); this.chat.dispose(); this.voice.cancel(); this.reader.disableContinuous(); this.attachments = []; }

  private async attentionAction(action: XopcHomeAction): Promise<void> {
    if (action.type === 'open' || action.type === 'review_judgment') {
      const route: XopcMobileRoute | undefined = action.type === 'review_judgment' && action.itemId
        ? { page: 'inbox', itemId: action.itemId } : mobileRoute(action.href ?? '');
      if (route) { this.sheetOpen = false; this.onNavigate(route); }
      else this.attention.error = this.getUIContext().getHostContext()?.resourceManager.getStringSync($r('app.string.unsupported_route').id) ?? '';
      return;
    }
    if (this.attention.pending) return;
    if (await this.attention.act(action)) {
      this.getUIContext().getPromptAction().showToast({ message: action.type === 'retry_run' ? $r('app.string.chat_attention_retried') : $r('app.string.chat_attention_completed') });
    }
    this.onAttentionRefresh();
  }

  private async newConversation(agentId: string = this.options.agentId, projectId: string | null = this.chat.projectId || null, executionMode?: string): Promise<void> {
    if (this.chat.loading || this.chat.sending || this.restoringDraft) return;
    if (this.draft.trim() || this.attachments.length || this.refs.length) {
      try {
        const result = await this.getUIContext().getPromptAction().showDialog({ message: $r('app.string.discard_changes'),
          buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') }, { text: $r('app.string.confirm'), color: $r('app.color.danger') }] });
        if (result.index !== 1) return;
      } catch (_) { return; }
    }
    this.voice.cancel(); this.draft = ''; this.attachments = []; this.refs = [];
    this.sheetOpen = false; this.setPanel(false); await this.chat.create(agentId, projectId, executionMode);
  }

  private async send(delivery: string = 'next'): Promise<void> {
    if (this.restoringDraft) return;
    const text = this.draft; const files = this.attachments; const refs = this.refs; const id = this.chat.selectedId;
    if (await this.chat.send(text, files, delivery, refs)) {
      if (id !== this.chat.selectedId) return;
      if (this.draft === text) this.draft = '';
      if (this.attachments === files) this.attachments = [];
      if (this.refs === refs) this.refs = [];
      this.palette.close(); this.saveDraft(); this.setPanel(false); if (this.visible) this.options.refreshQueue();
    }
  }
  private addReference(item: XopcReferenceItem): void {
    if (item.kind === 'file') {
      try {
        validateAttachmentSize(item.size || 0, this.attachments);
        if (!item.relativePath || this.attachments.some((file: XopcChatAttachment): boolean => file.workspaceRelativePath === item.relativePath)) return;
        this.attachments = this.attachments.concat([{ type: item.mimeType?.startsWith('image/') ? 'image' : 'document',
          name: item.title, mimeType: item.mimeType || 'application/octet-stream', size: item.size || 0, data: '', workspaceRelativePath: item.relativePath }]);
      } catch (error) { this.chat.error = (error as Error).message; return; }
    } else {
      if (this.refs.length >= 5 || this.refs.some((ref: XopcContextRef): boolean => ref.kind === item.kind && ref.sourceId === item.id)) return;
      this.refs = this.refs.concat([{ kind: item.kind, sourceId: item.id, expectedVersion: item.version, title: item.title }]);
    }
    this.sheetOpen = false;
  }

  private async addAttachment(kind: string = 'document'): Promise<void> {
    if (this.pickingAttachment || this.chat.sending) return;
    const id = this.chat.selectedId; const context = this.getUIContext().getHostContext();
    if (!id || !context) return;
    this.setPanel(false);
    this.pickingAttachment = true;
    try {
      const file = kind === 'document' ? await pickChatAttachment(context, this.attachments) : await pickChatPhoto(context, this.attachments, kind === 'camera');
      if (file && this.visible && id === this.chat.selectedId) this.attachments = this.attachments.concat([file]);
    } catch (error) { if (this.visible && id === this.chat.selectedId) this.chat.error = (error as Error).message; }
    finally { this.pickingAttachment = false; }
  }

  private async transcribe(): Promise<void> {
    const conversationId = this.chat.selectedId;
    const result = await this.voice.transcribe(appSettings.language.startsWith('zh') ? 'zh'
      : appSettings.language.startsWith('en') ? 'en' : '');
    if (result && this.visible && this.chat.selectedId === conversationId) {
      this.draft = this.draft ? this.draft + '\n' + result : result;
      this.focusComposerOnMount = true;
      this.showVoice = false;
    }
  }

  private async sendVoice(): Promise<void> {
    const id = this.chat.selectedId;
    const sent = await this.voice.send(async (attachment: XopcChatAttachment): Promise<boolean> => {
      if (!this.visible || this.disposed || id !== this.chat.selectedId) return false;
      return this.chat.send('', [attachment]);
    });
    if (sent && this.visible && id === this.chat.selectedId) this.showVoice = false;
  }

  private openReference(kind: string): void { this.referenceKind = kind; this.openSheet('references'); }

  private toggleVoice(): void {
    if (this.chat.sending || this.chat.runId || this.voice.busy || this.voice.state !== 'idle') return;
    this.setPanel(false); this.palette.close(); this.editor.stopEditing();
    this.focusComposerOnMount = this.showVoice; this.showVoice = !this.showVoice;
  }

  private focusMountedComposer(): void {
    if (!this.focusComposerOnMount) return;
    this.focusComposerOnMount = false; clearTimeout(this.composerFocusTimer);
    this.composerFocusTimer = setTimeout((): void => {
      if (this.visible && !this.disposed && !this.showVoice && !this.sheetOpen && !this.drawerOpen && !this.panelOpen) {
        this.getUIContext().getFocusController().requestFocus('chat-composer');
        this.editor.caretPosition(this.draft.length);
      }
    }, 50);
  }

  @Builder
  voiceToggle() {
    Button({ type: ButtonType.Circle }) {
      SymbolGlyph(this.showVoice ? $r('sys.symbol.keyboard') : $r('sys.symbol.mic')).fontSize(22).fontColor([$r('app.color.accent')])
    }.id('chat-voice-toggle').width(COMPOSER_TOOL_SIZE).height(COMPOSER_TOOL_SIZE).padding(0)
      .backgroundColor($r('app.color.input')).responseRegion({ x: -4, y: -4, width: 44, height: 44 })
      .accessibilityText(this.showVoice ? $r('app.string.chat_switch_keyboard') : $r('app.string.record_voice'))
      .enabled(!this.chat.sending && !this.chat.runId && !this.voice.busy && this.voice.state === 'idle')
      .onClick((): void => { this.toggleVoice(); })
  }

  @Builder
  composerRightActions() {
    Row({ space: 4 }) {
      if (!this.chat.runId || !this.hasPayload) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph(this.panelOpen ? $r('sys.symbol.xmark_circle') : $r('sys.symbol.plus_circle'))
            .fontSize(24).fontColor([$r('app.color.accent')])
        }.id('chat-composer-actions').width(COMPOSER_TOOL_SIZE).height(COMPOSER_TOOL_SIZE).padding(0)
          .backgroundColor($r('app.color.input')).responseRegion({ x: -4, y: -4, width: 44, height: 44 })
          .accessibilityText($r('app.string.add_attachment'))
          .enabled(!!this.chat.selectedId && !this.pickingAttachment && !this.chat.sending && this.voice.state === 'idle' && !this.voice.busy)
          .onClick((): void => { this.setPanel(!this.panelOpen); })
      }
      if (this.hasPayload) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.arrow_up')).fontSize(22).fontColor([$r('app.color.panel')])
        }.id('chat-send').width(COMPOSER_SEND_SIZE).height(COMPOSER_SEND_SIZE).padding(0)
          .backgroundColor($r('app.color.foreground'))
          .accessibilityText(this.chat.runId ? $r('app.string.chat_send_next') : $r('app.string.send'))
          .enabled(!!this.chat.selectedId && !this.chat.loading && !this.chat.cachedHistory && !this.pickingAttachment && this.voice.state === 'idle' && !this.voice.busy && !this.chat.sending && !this.options.saving && this.chat.connection === 'connected')
          .onClick((): void => { this.send(); })
      }
      if (this.chat.runId) {
        Button({ type: ButtonType.Circle }) { Text('■').fontSize(18).fontColor($r('app.color.panel')) }
          .id('chat-stop').width(COMPOSER_SEND_SIZE).height(COMPOSER_SEND_SIZE).padding(0).backgroundColor($r('app.color.foreground'))
          .accessibilityText($r('app.string.stop')).onClick((): void => { this.chat.abort(); })
      }
    }
  }

  @Builder
  composerScope() {
    Row({ space: 4 }) {
      Button(this.context.summary?.work.project?.title || $r('app.string.chat_project')).height(30).constraintSize({ maxWidth: '55%' })
        .fontSize(12).fontColor($r('app.color.accent')).backgroundColor($r('app.color.accent_soft'))
        .enabled(!!this.context.summary && !this.chat.loading).onClick((): void => { this.openSheet('project'); })
      if (this.context.summary?.environment) {
        Button(this.context.summary.environment.kind === 'managed_worktree' ? 'Worktree' : 'Local').height(30)
          .fontSize(12).fontColor($r('app.color.secondary')).backgroundColor(Color.Transparent)
          .onClick((): void => { this.openSheet(this.context.summary?.work.project ? 'environment' : 'directory'); })
      }
      Button('···').height(36).width(36).padding(0).fontColor($r('app.color.secondary')).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.chat_context')).onClick((): void => { this.openSheet('context'); })
    }.id('chat-composer-scope').width('100%').height(36).padding({ left: 8, right: 8 })
      .border({ width: { bottom: 0.5 }, color: $r('app.color.border_subtle') })
  }

  @Builder
  skeleton() {
    Column({ space: 16 }) {
      ForEach([0, 1, 2, 3], (index: number) => {
        Column() {}.width(index % 2 === 0 ? '90%' : '70%').height(64).borderRadius(12)
          .backgroundColor($r('app.color.panel'))
      }, (index: number): string => index.toString())
    }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
  }

  @Builder
  messageActions(row: XopcChatRow) {
    if (row.text && (row.role === 'user' || row.role === 'assistant')) {
      Row({ space: 8 }) {
        Button() { SymbolGlyph($r('sys.symbol.doc_plaintext')).fontSize(18).fontColor([$r('app.color.tertiary')]) }
          .width(44).height(44).padding(0).backgroundColor(Color.Transparent).accessibilityText($r('app.string.chat_copy'))
          .onClick((): void => { this.messageAction('copy', row); })
        if (row.role === 'user') {
          Button() { SymbolGlyph($r('sys.symbol.square_and_pencil')).fontSize(18).fontColor([$r('app.color.tertiary')]) }
            .width(44).height(44).padding(0).backgroundColor(Color.Transparent).accessibilityText($r('app.string.chat_edit'))
            .onClick((): void => { this.messageAction('edit', row); })
        } else {
          Button() { SymbolGlyph($r('sys.symbol.bookmark')).fontSize(18).fontColor([$r('app.color.tertiary')]) }
            .width(44).height(44).padding(0).backgroundColor(Color.Transparent).accessibilityText($r('app.string.chat_save_note'))
            .enabled(!this.savingNote).onClick((): void => { this.messageAction('save', row); })
          Button() { SymbolGlyph($r('sys.symbol.arrow_clockwise')).fontSize(18).fontColor([$r('app.color.tertiary')]) }
            .width(44).height(44).padding(0).backgroundColor(Color.Transparent).accessibilityText($r('app.string.chat_regenerate'))
            .enabled(!this.chat.runId && !this.chat.sending).onClick((): void => { this.messageAction('regenerate', row); })
          if (extractMarkdownCodeBlocks(chatAnswerText(row))) {
            Button() { Text('</>').fontSize(16).fontColor($r('app.color.secondary')) }
              .width(44).height(44).padding(0).backgroundColor(Color.Transparent).accessibilityText($r('app.string.chat_copy_code'))
              .onClick((): void => { this.messageAction('copy-code', row); })
          }
          if (!(row.media || []).some((file: XopcHistoryMedia): boolean => file.mimeType.startsWith('audio/'))) {
            Button() {
              if (this.reader.sourceId === row.id && this.reader.state === 'loading') { LoadingProgress().width(18).height(18).color($r('app.color.secondary')) }
              else if (this.reader.sourceId === row.id && this.reader.state === 'playing') { Text('Ⅱ').fontSize(18).fontColor($r('app.color.secondary')) }
              else { SymbolGlyph($r('sys.symbol.speaker_wave_2')).fontSize(18).fontColor([$r('app.color.secondary')]) }
            }
              .width(44).height(44).padding(0).backgroundColor(Color.Transparent)
              .accessibilityText(this.reader.sourceId === row.id && this.reader.state === 'playing' ? $r('app.string.pause') : this.reader.sourceId === row.id && this.reader.state === 'paused' ? $r('app.string.resume') : $r('app.string.chat_read_aloud'))
              .enabled(!!chatAnswerText(row)).onClick((): void => { this.messageAction('read', row); })
          }
        }
      }.width('100%').justifyContent(row.role === 'user' ? FlexAlign.End : FlexAlign.Start)
    }
  }

  @Builder
  conversation() {
    if (this.chat.loading && !this.chat.rows.length) { this.skeleton() }
    if (!this.chat.loading && !this.chat.rows.length && !this.chat.liveRow && !this.chat.runId) {
      XopcChatWelcome({ scope: this.context.summary, workspace: this.context.config?.effectiveWorkspacePath || '',
        agent: this.options.agents.find((agent: XopcChatAgent): boolean => agent.id === this.options.agentId), agentId: this.options.agentId || this.chat.agentId,
        language: appSettings.effectiveLanguage(), contextPending: this.context.loading || this.options.loading,
        contextError: !!this.context.error, onRetryContext: (): void => { this.context.load(this.chat.selectedId); },
        onDismissComposer: (): void => { this.dismissComposer(); },
        onChoose: (text: string): void => {
          if (this.restoringDraft) return;
          this.draft = text; this.cursor = text.length;
          this.getUIContext().getFocusController().requestFocus('chat-composer'); this.editor.caretPosition(text.length);
        } }).layoutWeight(1).width('100%')
    } else {
    Stack({ alignContent: Alignment.Bottom }) {
    List({ space: 20, scroller: this.messagesScroller }) {
      if (this.chat.hasOlder) {
        ListItem() {
          Row() {
            if (this.loadingOlder) { LoadingProgress().width(20).height(20).color($r('app.color.secondary')) }
            else { Button(this.olderFailed ? $r('app.string.refresh') : $r('app.string.older_messages'))
              .height(44).backgroundColor(Color.Transparent).fontColor($r('app.color.secondary'))
              .onClick((): void => { this.loadOlder(); }) }
          }.width('100%').height(44).justifyContent(FlexAlign.Center)
        }
      }
      Repeat<XopcChatRow>(this.chat.rows).each((item: RepeatItem<XopcChatRow>) => {
        ListItem() {
          if (item.item.role === 'user') {
            Column({ space: 2 }) {
              Row() {
                Column() {
                  XopcChatMessageContent({ row: item.item, conversationId: this.chat.selectedId, disclosure: this.disclosure,
                    reasoning: this.context.config?.reasoningLevel || 'on', onNavigate: this.onNavigate,
                    onFillDraft: (text: string): void => { this.fillProductDraft(text); } })
                }.id('chat-user-bubble-' + item.item.id).width(this.userBubbleWidth(item.item))
                  .constraintSize({ minWidth: 44, maxWidth: '82%' })
                  .padding({ left: 14, right: 14, top: 10, bottom: 10 }).alignItems(HorizontalAlign.Start)
                  .borderRadius({ topLeft: 18, topRight: 18, bottomLeft: 18, bottomRight: 6 })
                  .backgroundColor($r('app.color.accent_soft'))
              }.width('100%').justifyContent(FlexAlign.End)
              this.messageActions(item.item)
            }.width('100%').alignItems(HorizontalAlign.End)
          } else {
            Column({ space: 2 }) {
              XopcChatMessageContent({ row: item.item, conversationId: this.chat.selectedId, disclosure: this.disclosure,
                reasoning: this.context.config?.reasoningLevel || 'on', onNavigate: this.onNavigate,
                onFillDraft: (text: string): void => { this.fillProductDraft(text); } })
              this.messageActions(item.item)
            }.width('100%').alignItems(HorizontalAlign.Start)
          }
        }
      }).key((row: XopcChatRow): string => this.chat.selectedId + ':' + row.id).virtualScroll({ totalCount: this.chat.rows.length })
      if (this.chat.liveRow) {
        ListItem() {
          XopcChatMessageContent({ row: this.chat.liveRow, conversationId: this.chat.selectedId, disclosure: this.disclosure,
            reasoning: this.context.config?.reasoningLevel || 'on', onNavigate: this.onNavigate,
            onFillDraft: (text: string): void => { this.fillProductDraft(text); } }).padding(16)
        }
      } else if (this.chat.runId) {
        ListItem() { Text($r('app.string.chat_running')).fontSize(13).fontColor($r('app.color.secondary')).padding(16) }
      }
    }.id('chat-message-list').height('100%').width('100%').padding({ left: 20, right: 20 }).cachedCount(3)
      .onScrollIndex((start: number, end: number): void => {
        this.firstVisible = start;
      })
      .onDidScroll((offset: number, state: ScrollState): void => {
        if (this.initialScrollPending || this.loadingOlder || this.chat.loading || state === ScrollState.Idle) return;
        this.atBottom = this.messagesScroller.isAtEnd();
        if (offset < 0 && this.messagesScroller.currentOffset().yOffset < 160 && !this.olderFailed) this.loadOlder();
      })
      .onTouch((event: TouchEvent): void => { if (event.type === TouchType.Down) this.dismissComposer(); })
    if (!this.atBottom) {
      Button({ type: ButtonType.Circle }) {
        Text('↓').fontSize(20).fontColor($r('app.color.secondary'))
      }.id('chat-jump-bottom').height(36).width(36).padding(0).margin({ bottom: 8 })
        .responseRegion({ x: -4, y: -4, width: 44, height: 44 })
        .backgroundColor($r('app.color.grouped')).accessibilityText($r('app.string.chat_jump_bottom'))
        .onClick((): void => { this.atBottom = true; this.messagesScroller.scrollEdge(Edge.Bottom); })
    }
    }.id('chat-message-viewport').layoutWeight(1).width('100%').backgroundColor(Color.Transparent)
    }
    Column() {
    if (this.prompt.prompt) { XopcChatPrompt({ model: this.prompt }) }
    else if (this.unseenAttention.length) {
      Row({ space: 8 }) {
        Button({ type: ButtonType.Normal }) {
          Column({ space: 4 }) {
            Text(this.unseenAttention[0].title).fontSize(14).fontColor($r('app.color.foreground')).maxLines(1)
            Text(this.unseenAttention[0].summary).fontSize(12).fontColor($r('app.color.secondary')).maxLines(1)
          }.alignItems(HorizontalAlign.Start)
        }.id('chat-attention-open').layoutWeight(1).backgroundColor(Color.Transparent).padding(8)
          .onClick((): void => { this.openSheet('attention'); })
        Text(this.attentionItems.length.toString()).fontColor($r('app.color.accent'))
        Button('×').height(44).width(44).padding(0).backgroundColor(Color.Transparent).fontColor($r('app.color.secondary'))
          .accessibilityText($r('app.string.chat_close')).onClick((): void => { this.attention.dismiss(this.attentionItems); })
      }.width('92%').borderRadius(12).backgroundColor($r('app.color.accent_soft')).margin({ bottom: 8 })
    }
    if (this.options.queued.length || this.options.queueError) {
      Button() {
        Row({ space: 8 }) { Text($r('app.string.chat_queue')); Text(this.options.queued.length.toString()) }
      }.id('chat-queue')
        .height(44).backgroundColor(Color.Transparent).fontColor($r('app.color.secondary'))
        .onClick((): void => { this.options.refreshQueue(); this.openSheet('queue'); })
    }
    if (this.chat.runId && (this.draft.trim() || this.attachments.length || this.refs.length)) {
      Row({ space: 8 }) {
        Text($r('app.string.chat_queue_hint')).fontSize(12).fontColor($r('app.color.secondary')).layoutWeight(1)
        Button($r('app.string.chat_steer')).height(44).enabled(!this.chat.sending && !this.options.saving)
          .backgroundColor(Color.Transparent).fontColor($r('app.color.accent')).onClick((): void => { this.send('steer'); })
      }.padding({ left: 16, right: 16 })
    }
    if (this.refs.length) {
      Scroll() {
        Row({ space: 8 }) {
          ForEach(this.refs, (ref: XopcContextRef) => {
            Button((ref.title || ref.sourceId) + ' ×').height(36).fontSize(12).backgroundColor($r('app.color.accent_soft')).fontColor($r('app.color.accent'))
              .onClick((): void => { this.refs = this.refs.filter((item: XopcContextRef): boolean => item !== ref); })
          }, (ref: XopcContextRef): string => ref.kind + ':' + ref.sourceId)
        }
      }.scrollable(ScrollDirection.Horizontal).width('92%').height(44)
    }
    if (this.attachments.length) {
      Scroll() {
        Column({ space: 4 }) {
          ForEach(this.attachments, (file: XopcChatAttachment, index: number) => {
            if (file.mimeType.startsWith('image/') && this.attachmentPreviews[index]) {
              XopcChatMediaView({ file: this.attachmentPreviews[index], conversationId: this.chat.selectedId, draftPreview: true })
            }
            Row({ space: 8 }) {
              Text(file.name).layoutWeight(1).maxLines(1).fontColor($r('app.color.foreground'))
              Button($r('app.string.remove_attachment')).enabled(!this.chat.sending).backgroundColor(Color.Transparent).fontColor($r('app.color.secondary'))
                .onClick((): void => { this.attachments = this.attachments.filter((_file: XopcChatAttachment, i: number): boolean => i !== index); })
            }.width('100%')
          }, (file: XopcChatAttachment, index: number): string => index.toString() + ':' + file.name)
        }.padding(8)
      }.width('100%').constraintSize({ maxHeight: 180 })
    }
    if (this.voice.error) { Text(this.voice.error).fontColor($r('app.color.danger')).padding(8) }
    if (this.reader.error) { Text(this.reader.error).fontColor($r('app.color.danger')).padding(8) }
    if (this.reader.continuousConversationId === this.chat.selectedId && this.chat.selectedId) {
      Row({ space: 8 }) {
        Text($r('app.string.chat_continuous_active')).fontSize(13).fontColor($r('app.color.secondary')).layoutWeight(1)
        Button('×').width(44).height(44).backgroundColor(Color.Transparent).fontColor($r('app.color.secondary'))
          .accessibilityText($r('app.string.chat_continuous_stop')).onClick((): void => { this.reader.disableContinuous(); })
      }.id('chat-continuous-reading').padding({ left: 16, right: 16 }).width('100%')
    }
    if (this.reader.state !== 'idle') {
      Row({ space: 8 }) {
        Text($r('app.string.chat_read_aloud')).fontSize(13).fontColor($r('app.color.secondary')).layoutWeight(1)
        if (this.reader.state === 'loading') { LoadingProgress().width(24).height(24) }
        else {
          Button(this.reader.state === 'paused' ? $r('app.string.resume') : $r('app.string.pause')).height(44)
            .backgroundColor($r('app.color.grouped')).fontColor($r('app.color.secondary'))
            .onClick((): void => { this.reader.toggle(); })
        }
        Button($r('app.string.stop')).height(44).backgroundColor($r('app.color.grouped')).fontColor($r('app.color.secondary')).onClick((): void => { this.reader.stop(); })
      }.padding({ left: 16, right: 16 }).width('100%')
    }
    if (this.palette.range && (this.palette.loading || this.palette.items.length || this.palette.error)) {
      Column({ space: 4 }) {
        if (this.palette.loading) {
          Column() {}.height(44).width('100%').borderRadius(12).backgroundColor($r('app.color.grouped'))
        }
        if (this.palette.error) { Text(this.palette.error).fontColor($r('app.color.danger')).fontSize(12) }
        List({ space: 4 }) {
          ForEach(this.palette.items, (item: XopcPaletteItem) => {
            ListItem() {
              Button({ type: ButtonType.Normal }) {
                Column({ space: 3 }) {
                  Text(item.name).fontSize(14).fontColor($r('app.color.foreground')).maxLines(1).width('100%')
                  Text(item.description).fontSize(12).fontColor($r('app.color.secondary')).maxLines(1).width('100%')
                }.alignItems(HorizontalAlign.Start).width('100%')
              }.width('100%').height(52).padding(8).backgroundColor(Color.Transparent).onClick((): void => { this.applyPalette(item); })
            }
          }, (item: XopcPaletteItem): string => item.id)
        }.width('100%').height(Math.min(3, this.palette.items.length) * 56)
      }.id('chat-command-palette').width('92%').padding(8).borderRadius(16).backgroundColor($r('app.color.panel')).margin({ bottom: 4 })
    }
    Column() {
      this.composerScope()
      Row({ space: 4 }) {
        if (!this.expandedComposer) { this.voiceToggle() }
        if (this.showVoice || this.voice.state !== 'idle') {
          Column({ space: 4 }) {
            if (this.voice.state === 'idle') {
              Button($r('app.string.record_voice')).id('chat-voice-record').width('100%').height(40).fontSize(14)
                .fontColor($r('app.color.secondary')).backgroundColor($r('app.color.input'))
                .enabled(!this.voice.busy && !this.chat.sending && !this.chat.runId)
                .onClick(async (): Promise<void> => { await this.reader.stop(); if (this.visible) this.voice.start(this.getUIContext().getHostContext() as common.UIAbilityContext); })
            } else {
              Row({ space: 4 }) {
                Text(this.voice.state === 'recording' ? this.voice.seconds.toString() + ' / 120 s' : $r('app.string.record_voice'))
                  .fontSize(13).maxLines(1).layoutWeight(1).fontColor($r('app.color.secondary'))
                Button('×', { type: ButtonType.Circle }).id('chat-voice-cancel').width(32).height(32).padding(0)
                  .backgroundColor(Color.Transparent).fontColor($r('app.color.secondary')).accessibilityText($r('app.string.cancel'))
                  .onClick((): void => { this.voice.cancel(); })
              }.width('100%')
              Row({ space: 4 }) {
                if (this.voice.state === 'recording') {
                  Button($r('app.string.stop_recording')).id('chat-voice-finish').layoutWeight(1).height(36).fontSize(13)
                    .enabled(!this.voice.busy).onClick((): void => { this.voice.stop(); })
                } else if (this.voice.state === 'ready') {
                  Button($r('app.string.play_recording')).layoutWeight(1).height(36).fontSize(12).padding(4)
                    .backgroundColor($r('app.color.input')).fontColor($r('app.color.secondary'))
                    .enabled(!this.voice.busy).onClick((): void => { this.voice.play(); })
                  Button($r('app.string.transcribe')).layoutWeight(1).height(36).fontSize(12).padding(4)
                    .backgroundColor($r('app.color.input')).fontColor($r('app.color.secondary'))
                    .enabled(!this.voice.busy).onClick((): void => { this.transcribe(); })
                  Button($r('app.string.send')).id('chat-voice-send').layoutWeight(1).height(36).fontSize(12).padding(4)
                    .backgroundColor($r('app.color.foreground')).fontColor($r('app.color.panel'))
                    .enabled(!this.voice.busy && !this.chat.sending && !this.chat.loading && !this.chat.cachedHistory && this.chat.connection === 'connected')
                    .onClick((): void => { this.sendVoice(); })
                } else if (this.voice.state === 'playing') {
                  Button($r('app.string.stop')).layoutWeight(1).height(36).fontSize(13)
                    .enabled(!this.voice.busy).onClick((): void => { this.voice.stopPlayback(); })
                } else { Text($r('app.string.voice_working')).height(36).fontSize(13).fontColor($r('app.color.secondary')) }
              }.width('100%')
            }
          }.id('chat-voice-pad').layoutWeight(1)
        } else {
          // Keep one editor node across compact/expanded states so the IME and caret survive the first keystroke.
          TextArea({ text: this.draft, placeholder: $r('app.string.message_hint'), controller: this.editor })
            .id('chat-composer').layoutWeight(1).constraintSize({ minHeight: COMPOSER_INPUT_MIN, maxHeight: this.expandedComposer ? COMPOSER_INPUT_MAX : COMPOSER_INPUT_MIN })
            .padding({ left: 4, right: 4, top: this.expandedComposer ? 5 : 10, bottom: this.expandedComposer ? 5 : 10 }).lineHeight(20)
            .enabled(!this.chat.sending && !this.restoringDraft).backgroundColor(Color.Transparent)
            .fontSize(16).fontColor($r('app.color.foreground')).placeholderColor($r('app.color.tertiary'))
            .onAppear((): void => { this.focusMountedComposer(); })
            .onEditChange((editing: boolean): void => { if (editing) this.setPanel(false); })
            .onChange((value: string): void => { this.draft = value; this.cursor = value.length; this.palette.update(value, this.cursor, this.chat.selectedId, appSettings.effectiveLanguage()); })
            .onTextSelectionChange((start: number, end: number): void => {
              this.cursor = end; if (start === end) this.palette.update(this.draft, end, this.chat.selectedId, appSettings.effectiveLanguage()); else this.palette.close();
            })
        }
        if (!this.expandedComposer) { this.composerRightActions() }
      }.width('100%').padding({ left: this.expandedComposer ? 12 : 4, right: this.expandedComposer ? 12 : 4,
        top: this.expandedComposer ? 8 : 4, bottom: this.expandedComposer ? 0 : 4 })
      if (this.expandedComposer) {
        Row({ space: 4 }) {
          this.voiceToggle()
          Blank().layoutWeight(1)
          this.composerRightActions()
        }.width('100%').padding({ left: 8, right: 8, bottom: 8 })
      }
    }.id('chat-composer-shell').width('calc(100% - 16vp)').backgroundColor($r('app.color.panel'))
      .border({ width: 0.5, color: $r('app.color.border_subtle'), radius: 14 }).clip(true).margin({ bottom: 8, top: 8 })
    if (this.panelOpen) { this.actionPanel() }
    this.bottomDock()
    }.id('chat-bottom-region').width('calc(100% - 24vp)').backgroundColor($r('app.color.panel'))
      .border({ width: 0.5, color: $r('app.color.border_subtle'), radius: 20 }).clip(true)
      .margin({ top: 4, bottom: this.layout.keyboardVisible ? 0 : 8 })
  }

  @Builder
  emptyDock() {}

  @Builder
  actionTile(id: string, label: Resource, symbol: Resource, enabled: boolean) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 8 }) {
        Row() {
          SymbolGlyph(symbol).fontSize(26).fontColor([$r('app.color.foreground')])
        }.width(52).height(52).justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
          .borderRadius(16).backgroundColor($r('app.color.input'))
        Text(label).fontSize(12).fontColor($r('app.color.secondary')).maxLines(2).textAlign(TextAlign.Center)
      }.width('100%')
    }.id('chat-action-' + id).width('33.33%').height(98).padding(4).backgroundColor(Color.Transparent)
      .accessibilityText(label).enabled(enabled).onClick((): void => { this.chooseAction(id); })
  }

  private chooseAction(id: string): void {
    if (!this.panelOpen || !this.visible || this.chat.sending || this.voice.busy || this.voice.state !== 'idle') return;
    this.setPanel(false);
    if (id === 'camera' || id === 'photos' || id === 'document') this.addAttachment(id);
    else if (id.startsWith('reference-')) this.openReference(id.slice('reference-'.length));
    else if (id === 'new-chat') this.newConversation();
    else if (id === 'record-voice' && !this.showVoice) this.toggleVoice();
    else if ((id === 'voice-no-tools' || id === 'voice-with-tools') && this.chat.selectedId) {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      this.reader.stop(); this.voice.cancel();
      this.call.start(context, { conversationId: this.chat.selectedId,
        mode: id === 'voice-with-tools' ? 'assistant' : 'natural', background: true,
        name: this.chat.title || this.options.modelName(appSettings.effectiveLanguage()) });
    }
  }

  @Builder
  actionPanel() {
    Scroll() {
      Column({ space: 4 }) {
        Row() {
          this.actionTile('camera', $r('app.string.chat_camera'), $r('sys.symbol.camera'), !this.pickingAttachment && !this.chat.runId && this.attachments.length < MAX_ATTACHMENTS)
          this.actionTile('photos', $r('app.string.chat_photos'), $r('sys.symbol.picture'), !this.pickingAttachment && !this.chat.runId && this.attachments.length < MAX_ATTACHMENTS)
          this.actionTile('document', $r('app.string.chat_local_files'), $r('sys.symbol.folder'), !this.pickingAttachment && !this.chat.runId && this.attachments.length < MAX_ATTACHMENTS)
        }.width('100%')
        Row() {
          this.actionTile('reference-note', $r('app.string.chat_reference_note'), $r('sys.symbol.doc'), this.refs.length < 5)
          this.actionTile('reference-task', $r('app.string.chat_reference_task'), $r('sys.symbol.checkmark_circle'), this.refs.length < 5)
          this.actionTile('reference-file', $r('app.string.chat_reference_file'), $r('sys.symbol.folder'), this.attachments.length < MAX_ATTACHMENTS)
        }.width('100%')
        Row() {
          this.actionTile('record-voice', $r('app.string.record_voice'), $r('sys.symbol.mic'), !this.chat.runId && !this.voice.busy && this.voice.state === 'idle')
          this.actionTile('new-chat', $r('app.string.new_chat'), $r('sys.symbol.square_and_pencil'), !this.chat.sending)
        }.width('100%')
        Row() {
          this.actionTile('voice-no-tools', $r('app.string.voice_call_action_natural'), $r('sys.symbol.waveform'), !!this.chat.selectedId && this.call.phase === 'idle')
          this.actionTile('voice-with-tools', $r('app.string.voice_call_action_assistant'), $r('sys.symbol.speaker_wave_2'), !!this.chat.selectedId && this.call.phase === 'idle')
        }.width('100%')
      }.width('100%').padding({ left: 8, right: 8, bottom: 12 })
    }.id('chat-action-panel').width('100%').height(312).scrollBar(BarState.Auto)
  }

  build() {
    Stack({ alignContent: Alignment.Start }) {
    Column() {
      Row({ space: 12 }) {
          Button() { SymbolGlyph($r('sys.symbol.line_3_horizontal')).fontSize(23).fontColor([$r('app.color.foreground')]) }
            .id('chat-open-drawer')
            .width(44).height(44).padding(0).backgroundColor(Color.Transparent).accessibilityText($r('app.string.history'))
            .onClick((): void => { this.setDrawer(true); })
        Row() {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 6 }) {
              Text(this.options.modelName(appSettings.effectiveLanguage()))
                .fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground'))
                .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).flexShrink(1)
              SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(12).fontColor([$r('app.color.foreground')])
                .width(14).flexShrink(0)
            }.constraintSize({ maxWidth: '100%' }).alignItems(VerticalAlign.Center)
          }.id('chat-model-picker').constraintSize({ maxWidth: '100%' }).height(44).padding(8).backgroundColor(Color.Transparent)
            .onClick((): void => { this.openSheet('model'); })
        }.layoutWeight(1).justifyContent(FlexAlign.Start)
        if (this.chat.selectedId) {
          Button({ type: ButtonType.Normal }) {
            Text('•••').fontSize(12).letterSpacing(0).fontColor($r('app.color.foreground'))
          }.width(40).height(40).padding(0).backgroundColor(Color.Transparent)
            .id('chat-header-actions').accessibilityText($r('app.string.chat_actions')).onClick((): void => { this.openSheet('actions'); })
        }
      }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 6 })
      if (this.chat.connection !== 'connected') {
        Row({ space: 8 }) {
          Text(this.chat.connection === 'unauthorized' ? $r('app.string.connection_revoked')
            : this.chat.connection === 'client_update_required' ? $r('app.string.client_update_required')
            : this.chat.connection === 'gateway_update_required' ? $r('app.string.gateway_update_required')
            : this.chat.connection.startsWith('error:') ? this.chat.connection : $r('app.string.reconnecting'))
            .fontSize(12).fontColor($r('app.color.secondary')).layoutWeight(1)
          if (this.chat.connection === 'client_update_required' || this.chat.connection === 'gateway_update_required') {
            Button($r('app.string.refresh')).height(36).onClick((): void => { this.chat.reconnect(); })
          }
        }.width('100%').padding(8).alignItems(VerticalAlign.Center)
      }
      if (this.chat.cachedHistory) {
        Text($r('app.string.chat_cached_history')).id('chat-cached-history').fontSize(12).fontColor($r('app.color.secondary'))
          .padding({ left: 16, right: 16, bottom: 6 })
      }
      if (this.chat.error) {
        Row({ space: 8 }) {
          Text(this.chat.error).fontSize(12).fontColor($r('app.color.danger')).layoutWeight(1).maxLines(3)
          Button($r('app.string.refresh')).height(44).onClick((): void => { this.chat.retryHistory(); })
        }.padding({ left: 16, right: 16 })
      }
      this.conversation()
    }.width('100%').height('100%').backgroundColor($r('app.color.surface'))
      .accessibilityLevel(this.drawerOpen ? 'no-hide-descendants' : 'auto')
      .bindSheet($$this.sheetOpen, this.optionsSheet, { height: '80%', dragBar: true, showClose: false, backgroundColor: $r('app.color.panel') })
    if (!this.drawerOpen) {
      Column() {}.id('chat-drawer-gesture-strip').width(24).height('100%').backgroundColor(Color.Transparent)
        .onTouch((event: TouchEvent): void => { if (event.type === TouchType.Down) this.dismissComposer(); })
        .gesture(PanGesture({ direction: PanDirection.Horizontal, distance: 16 })
          .onActionEnd((event: GestureEvent): void => { if (event.offsetX > 32) this.setDrawer(true); }))
    }
    if (this.drawerOpen) {
      XopcChatDrawer({ currentId: this.chat.selectedId, onClose: (): void => { this.setDrawer(false); },
        onSession: (id: string): void => { this.onOpenConversation(id); },
        onSearch: (): void => { this.setDrawer(false); this.onNavigate({ page: 'sessions', itemId: '' }); },
        onNewChat: (): void => { this.newConversation(); } })
    }
    }.width('100%').height('100%')
  }

  @Builder
  optionsSheet() {
    if (this.sheetMode === 'attention') {
      Column({ space: 12 }) {
        Row() {
          Text($r('app.string.needs_you')).fontSize(20).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground')).layoutWeight(1)
          Button($r('app.string.chat_close')).height(44).backgroundColor(Color.Transparent).fontColor($r('app.color.secondary'))
            .onClick((): void => { this.sheetOpen = false; })
        }.width('100%')
        Scroll() {
          Column({ space: 12 }) {
            if (!this.attentionItems.length) { Text($r('app.string.nothing_needed')).fontColor($r('app.color.secondary')) }
            ForEach(this.attention.ordered(this.attentionItems).slice(0, 3), (item: XopcHomeItem) => {
              XopcChatAttentionRow({ item, pending: this.attention.pending, onAction: (action: XopcHomeAction): void => { this.attentionAction(action); } })
            }, (item: XopcHomeItem): string => item.id + ':' + JSON.stringify(item))
            if (this.attention.error) { Text(this.attention.error).fontColor($r('app.color.danger')).width('100%') }
            Button($r('app.string.chat_attention_all')).height(48).width('100%').backgroundColor(Color.Transparent).fontColor($r('app.color.accent'))
              .onClick((): void => { this.sheetOpen = false; this.onNavigate({ page: 'progress', itemId: '' }); })
          }.width('100%')
        }.width('100%').layoutWeight(1)
      }.id('chat-attention-sheet').width('100%').height('100%').padding(20)
    } else if (['context', 'project', 'environment', 'directory', 'references'].includes(this.sheetMode)) {
      XopcChatContext({ model: this.context, initialMode: this.sheetMode, initialReferenceKind: this.referenceKind, refs: this.refs,
        onScope: (projectId: string | null, mode?: string): void => { this.newConversation(this.options.agentId, projectId, mode); },
        onReference: (item: XopcReferenceItem): void => { this.addReference(item); },
        onClose: (): void => { this.sheetOpen = false; }, onRetry: (): void => { this.context.load(this.chat.selectedId); } })
    } else {
    XopcChatOptions({ model: this.options, mode: this.sheetMode,
      onMode: (mode: string): void => { this.sheetMode = mode; }, onClose: (): void => { this.sheetOpen = false; },
      onRetry: (): void => { this.options.load(this.chat.selectedId, this.chat.agentId); },
      onAgent: (id: string): void => { this.newConversation(id); }, onNewChat: (): void => { this.newConversation(); },
      onFiles: (): void => { this.sheetOpen = false; this.onNavigate({ page: 'session-files', itemId: this.chat.selectedId }); } })
    }
  }
}
