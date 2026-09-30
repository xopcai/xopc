import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { userErrorMessage } from '../common/userError';
import { quickChatIntake, XopcQuickChatIntake } from '../service/quickChatIntake';
import { XopcChatViewModel } from '../viewmodel/chatViewModel';
import { XopcChatRow, XopcChatAttachment, XopcChatBlock, XopcContextRef, XopcReferenceItem, XopcChatAgent,
  XopcHistoryMedia, XopcHostDirectory, XopcQueuedInput } from '../model/chat';
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
import { COMPOSER_INPUT_MIN, COMPOSER_INPUT_MAX, COMPOSER_TOOL_SIZE,
  composerExpanded, composerHasPayload } from '../common/composerLayout';
import { shareIntake } from '../service/shareIntake';
import { voiceCall, XopcVoiceCall } from '../service/voiceCall';
import { resolveVoiceRecordingDestination, XopcVoiceRecordingDestination } from '../common/voiceRecordingGesture';
import { seedChatMediaCache } from '../service/chatMedia';
import { advanceAssistantAudio, latestAssistantAudio, XopcAssistantAudioState } from '../common/assistantAudioAutoplay';
import { assistantAudioAutoplay } from '../service/assistantAudioAutoplay';
import { editChatImageAttachment } from '../service/chatImageEditing';
import { latestChatMessageId } from '../common/chatMessagePreview';
import { chatPresentationRows, chatNeedsWideBubble } from '../common/chatPresentation';
import { XopcBrandLoading } from './MobileComponents';

@ComponentV2
export struct XopcChatView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param requestedId: string = '';
  @Param requestRevision: number = 0;
  @Param focusRevision: number = 0;
  @Param requestedAction: string = '';
  @Param actionRevision: number = 0;
  @Param intakeRevision: number = 0;
  @Param intakeText: string = '';
  @Param activePage: boolean = true;
  @Param embedded: boolean = false;
  @BuilderParam bottomDock: () => void = this.emptyDock;
  @Param attentionItems: XopcHomeItem[] = [];
  @Event onConversationChange: (id: string) => void = (_id: string): void => {};
  @Event onAttentionRefresh: () => void = (): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local chat: XopcChatViewModel = new XopcChatViewModel();
  @Local disclosure: XopcChatDisclosure = new XopcChatDisclosure();
  @Local options: XopcChatOptionsViewModel = new XopcChatOptionsViewModel();
  @Local context: XopcChatContextViewModel = new XopcChatContextViewModel();
  @Local prompt: XopcChatPromptViewModel = new XopcChatPromptViewModel();
  @Local refs: XopcContextRef[] = [];
  @Local panelOpen: boolean = false;
  @Local sheetOpen: boolean = false;
  @Local sheetMode: string = 'actions';
  @Local referenceKind: string = 'note';
  @Local draft: string = '';
  @Local editingQueuedId: string = '';
  @Local editingTurnId: string = '';
  @Local showVoice: boolean = false;
  @Local voiceHeld: boolean = false;
  @Local voiceFinishing: boolean = false;
  @Local voiceRetryDestination: XopcVoiceRecordingDestination = 'send';
  @Local voiceDestination: XopcVoiceRecordingDestination = 'send';
  @Computed get expandedComposer(): boolean {
    return composerExpanded(this.draft, this.attachments.length, this.refs.length, !!this.palette.range);
  }
  @Computed get hasPayload(): boolean { return composerHasPayload(this.draft, this.attachments.length, this.refs.length); }
  @Computed get sheetHeight(): number {
    if (this.sheetMode === 'project') {
      return this.context.loading ? 300 : Math.min(620, Math.max(240, 132 + (this.context.projects.length + 1) * 68));
    }
    if (this.sheetMode === 'environment') {
      return this.context.environment?.worktreeUnavailableReason ? 336 : 272;
    }
    if (this.sheetMode === 'context') {
      if (this.context.loading || !this.context.summary) return 300;
      let rows = 2 + Math.min(this.context.summary.sources.length, 5);
      if (this.context.summary.environment) rows++;
      if (!this.context.summary.work.project && !this.context.summary.work.task
        && this.context.config && !this.context.config.workingDirectoryLocked) rows++;
      if (this.context.summary.sourcesHasMore) rows++;
      return Math.min(620, Math.max(280, 132 + rows * 64));
    }
    if (this.sheetMode === 'directory') {
      const directories = this.context.directories?.entries.filter((item: XopcHostDirectory): boolean => item.isDirectory).length ?? 0;
      const controls = this.context.directories ? 3 : 1;
      return Math.min(620, Math.max(300, 140 + (directories + controls) * 56));
    }
    if (this.sheetMode === 'actions') return 364;
    if (this.sheetMode === 'queue') return Math.min(620, Math.max(260, 156 + this.options.queued.length * 120));
    if (this.sheetMode === 'attention') return Math.min(560, Math.max(300, 188 + Math.min(this.attentionItems.length, 3) * 96));
    return 620;
  }
  @Local voice: XopcVoiceCapture = voiceCapture;
  @Local reader: XopcChatReadAloud = chatReadAloud;
  @Local call: XopcVoiceCall = voiceCall;
  @Local attachments: XopcChatAttachment[] = [];
  @Local quickIntake: XopcQuickChatIntake = quickChatIntake;
  @Local pickingAttachment: boolean = false;
  @Local imageEditorOpen: boolean = false;
  @Local imageEditorIndex: number = -1;
  @Local imageEditorRotation: number = 0;
  @Local imageEditorAspect: string = 'original';
  @Local imageEditorBusy: boolean = false;
  @Local imageEditorError: string = '';
  @Local messageDetailOpen: boolean = false;
  @Local messageDetailRow: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Computed get latestMessageId(): string {
    return latestChatMessageId(this.presentationRows);
  }
  @Computed get presentationRows(): XopcChatRow[] {
    return chatPresentationRows(this.chat.rows, this.chat.liveRow, this.chat.runId);
  }
  @Computed get attachmentPreviews(): XopcHistoryMedia[] {
    return this.attachments.map((file: XopcChatAttachment, index: number): XopcHistoryMedia => {
      const media: XopcHistoryMedia = { id: 'draft:' + index, name: file.name, type: file.type, mimeType: file.mimeType, size: file.size,
        uri: file.uri || '', data: file.data, workspaceRelativePath: file.workspaceRelativePath };
      return chatAttachments([media], media.id)[0] || media;
    });
  }
  @Local atBottom: boolean = true;
  @Local showJumpBottom: boolean = false;
  @Local bottomRegionHeight: number = 0;
  @Local savingNote: boolean = false;
  @Local attention: XopcChatAttentionViewModel = new XopcChatAttentionViewModel();
  @Computed get unseenAttention(): XopcHomeItem[] { return this.attention.unseen(this.attentionItems); }
  @Local restoringDraft: boolean = false;
  @Local palette: XopcChatPaletteViewModel = new XopcChatPaletteViewModel();
  @Local layout: XopcLayoutState = layoutState;
  private cursor: number = 0;
  private drafts: XopcChatDrafts = new XopcChatDrafts();
  private draftScope: string = '';
  private voiceStartX: number = 0;
  private voiceStartY: number = 0;
  private voicePointerId: number = -1;
  private voiceHoldGeneration: number = 0;
  private draftGeneration: number = 0;
  private draftTimer: number = -1;
  private intakeTimer: number = -1;
  private disposed: boolean = false;
  private visible: boolean = false;
  private optionsId: string = '';
  private editor: TextAreaController = new TextAreaController();
  private focusComposerOnMount: boolean = false;
  private appliedFocusRevision: number = 0;
  private composerFocusAttempts: number = 0;
  private composerFocusTimer: number = -1;
  private appliedActionRevision: number = 0;
  private messagesScroller: Scroller = new Scroller();
  private scrollTimer: number = -1;
  private layoutScrollAnimating: boolean = false;
  private firstVisible: number = 0;
  @Local loadingOlder: boolean = false;
  @Local olderFailed: boolean = false;
  private initialScrollPending: boolean = true;
  private olderGeneration: number = 0;
  private autoReadState?: XopcAutoReadState;
  private assistantAudioState?: XopcAssistantAudioState;

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

  @Monitor('chat.rows', 'chat.runId', 'chat.selectedId', 'chat.loading', 'activePage', 'voice.state', 'call.phase', 'reader.state')
  onAssistantAudioChange(): void {
    const enabled = this.activePage && !this.disposed && !this.chat.loading && !!this.chat.selectedId
      && this.voice.state === 'idle' && this.call.phase === 'idle' && this.reader.state === 'idle';
    const next = advanceAssistantAudio(this.assistantAudioState, this.chat.selectedId, enabled, !!this.chat.runId,
      latestAssistantAudio(this.chat.rows, this.chat.selectedId));
    this.assistantAudioState = next.state;
    if (!enabled) { assistantAudioAutoplay.interrupt(); return; }
    const context = this.getUIContext().getHostContext();
    if (next.candidate && context) assistantAudioAutoplay.enqueue(context, next.candidate);
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
    const profile = gatewaySession.currentProfile();
    const scope = JSON.stringify([profile?.gatewayId || '', profile?.deviceId || '', this.chat.selectedId]);
    if (!this.chat.selectedId || scope === this.draftScope) return;
    clearTimeout(this.draftTimer); this.saveDraft();
    clearTimeout(this.scrollTimer); this.layoutScrollAnimating = false;
    this.initialScrollPending = true; this.atBottom = true; this.showJumpBottom = false; this.palette.close();
    if (this.reader.continuousConversationId !== this.chat.selectedId) this.reader.disableContinuous();
    this.olderGeneration++; this.loadingOlder = false; this.olderFailed = false; this.firstVisible = 0;
    const generation = ++this.draftGeneration;
    this.restoringDraft = true; this.draftScope = scope; this.draft = ''; this.refs = []; this.attachments = [];
    this.editingQueuedId = ''; this.editingTurnId = '';
    try {
      const saved = await this.drafts.read(scope);
      if (generation !== this.draftGeneration) return;
      if (saved) { this.draft = saved.text; this.refs = saved.refs; this.attachments = saved.files; }
    } catch (_error) { if (generation === this.draftGeneration) this.chat.error = 'DRAFT_RESTORE_FAILED'; }
    finally { if (generation === this.draftGeneration) { this.restoringDraft = false; this.applyShareIntake(); } }
  }

  @Monitor('intakeRevision', 'chat.selectedId', 'restoringDraft')
  applyShareIntake(): void {
    if (this.appliedIntakeRevision === this.intakeRevision) return;
    const profile = gatewaySession.currentProfile();
    const targetScope = JSON.stringify([profile?.gatewayId || '', profile?.deviceId || '', this.chat.selectedId]);
    if (this.intakeText && (this.restoringDraft || !this.chat.selectedId || this.chat.selectedId !== this.requestedId
      || this.draftScope !== targetScope)) {
      clearTimeout(this.intakeTimer);
      this.intakeTimer = setTimeout((): void => { if (!this.disposed) this.applyShareIntake(); }, 50);
      return;
    }
    if (this.restoringDraft || !this.chat.selectedId) return;
    clearTimeout(this.intakeTimer);
    let value = shareIntake.consumeChat(this.chat.selectedId);
    if (!value && this.chat.selectedId === this.requestedId) value = this.intakeText;
    if (!value) return;
    this.appliedIntakeRevision = this.intakeRevision; this.draft = value; this.cursor = value.length;
    this.focusComposerOnMount = true; this.focusMountedComposer();
  }

  @Monitor('chat.rows', 'chat.liveRow', 'chat.streaming', 'chat.thinking', 'chat.tool', 'chat.loading')
  onMessageChange(): void {
    if (this.layoutScrollAnimating || !this.visible || (!this.atBottom && !this.initialScrollPending) || this.loadingOlder || (this.chat.loading && !this.chat.cachedHistory)) return;
    clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout((): void => {
      if (this.visible && (this.atBottom || this.initialScrollPending) && !this.loadingOlder) {
        this.initialScrollPending = false; this.messagesScroller.scrollEdge(Edge.Bottom);
      }
    }, 50);
  }
  @Monitor('bottomRegionHeight')
  onMessageLayoutChange(): void {
    if (!this.visible || !this.atBottom || this.loadingOlder || this.chat.loading) return;
    if (this.initialScrollPending || this.layout.reduceMotion) { this.onMessageChange(); return; }
    clearTimeout(this.scrollTimer);
    this.layoutScrollAnimating = true;
    this.scrollTimer = setTimeout((): void => {
      if (!this.visible || !this.atBottom || this.loadingOlder) { this.layoutScrollAnimating = false; return; }
      const last = this.presentationRows.length - 1 + (this.chat.hasOlder ? 1 : 0);
      if (last < 0 || this.messagesScroller.isAtEnd()) { this.layoutScrollAnimating = false; return; }
      // Native smooth alignment includes contentEndOffset and remains interruptible by touch.
      this.messagesScroller.scrollToIndex(last, true, ScrollAlign.END);
    }, 16);
  }
  private finishLayoutScroll(): void {
    if (!this.layoutScrollAnimating) return;
    this.layoutScrollAnimating = false;
    this.onMessageChange();
  }
  private onMessageViewportChange(previous: Area, current: Area): void {
    // Keyboard resize changes the viewport without changing any message rows.
    if (Number(previous.height) !== Number(current.height) || Number(previous.width) !== Number(current.width)) {
      this.onMessageLayoutChange();
    }
  }
  private async loadOlder(): Promise<void> {
    if (this.loadingOlder || !this.chat.hasOlder || this.chat.loading || this.initialScrollPending) return;
    this.loadingOlder = true;
    this.olderFailed = false;
    const conversationId = this.chat.selectedId;
    const generation = ++this.olderGeneration;
    let anchor: string | undefined;
    let anchorOffset = 0;
    const previousRows = this.chat.rows;
    await this.chat.loadHistory(true, (): void => {
      const headerCount = this.chat.hasOlder ? 1 : 0;
      const anchorIndex = Math.max(headerCount, this.firstVisible);
      anchor = this.presentationRows[anchorIndex - headerCount]?.id;
      try { anchorOffset = this.messagesScroller.getItemRect(anchorIndex).y; } catch (_) {}
    });
    if (!this.visible || generation !== this.olderGeneration || conversationId !== this.chat.selectedId) return;
    this.olderFailed = previousRows === this.chat.rows && !!this.chat.error;
    if (anchor && this.visible) {
      const index = this.presentationRows.findIndex((row: XopcChatRow): boolean => row.id === anchor || (!!anchor && !!row.sourceIds?.includes(anchor)));
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
  @Monitor('chat.loading', 'chat.rows', 'activePage')
  warmOlderHistory(): void {
    if (this.activePage && !this.disposed) this.chat.prefetchOlder();
  }
  private async messageAction(action: string, row: XopcChatRow): Promise<void> {
    try {
      if (action === 'copy') {
        await copyChatMessage(row.role === 'assistant' ? chatAnswerText(row) : row.text); this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_copied') });
      } else if (action === 'copy-code') {
        await copyChatMessage(extractMarkdownCodeBlocks(chatAnswerText(row))); this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_copied') });
      } else if (action === 'edit') { this.fillMessageDraft(row); }
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

  private fillMessageDraft(row: XopcChatRow): void {
    this.editingQueuedId = '';
    this.editingTurnId = !this.chat.runId && this.isLatestUser(row) ? row.turnId || '' : '';
    this.draft = row.text;
    this.attachments = (row.media || []).map((file: XopcHistoryMedia): XopcChatAttachment => ({
      type: file.type, name: file.name, mimeType: file.mimeType, size: file.size, data: file.data || '', uri: file.uri,
      workspaceRelativePath: file.workspaceRelativePath, duration: file.duration
    }));
    this.refs = (row.refs || []).slice();
    this.showVoice = false; this.setPanel(false); this.cursor = this.draft.length;
    this.focusComposerOnMount = true; this.focusMountedComposer(); this.saveDraft();
  }

  private isLatestUser(row: XopcChatRow): boolean {
    for (let index = this.presentationRows.length - 1; index >= 0; index--) {
      if (this.presentationRows[index].role === 'user') return this.presentationRows[index].id === row.id;
    }
    return false;
  }

  private editQueued(input: XopcQueuedInput): void {
    this.editingTurnId = ''; this.editingQueuedId = input.id;
    this.draft = input.content;
    this.attachments = (input.attachments || []).slice();
    this.refs = (input.contextRefs || []).map((ref): XopcContextRef => ({
      kind: ref.kind, sourceId: ref.sourceId, expectedVersion: ref.version, title: ref.title
    }));
    this.sheetOpen = false; this.showVoice = false; this.setPanel(false); this.cursor = this.draft.length;
    this.focusComposerOnMount = true; this.focusMountedComposer(); this.saveDraft();
  }

  private cancelEditing(): void {
    this.editingQueuedId = ''; this.editingTurnId = ''; this.draft = ''; this.attachments = []; this.refs = [];
    this.saveDraft();
  }
  private async fillProductDraft(text: string): Promise<void> {
    if (this.restoringDraft || !this.visible) return;
    const conversationId = this.chat.selectedId;
    await this.voice.cancel();
    if (conversationId !== this.chat.selectedId || this.disposed || !this.visible || this.restoringDraft) return;
    this.showVoice = false; this.setPanel(false); this.draft = text; this.cursor = text.length;
    this.focusComposerOnMount = true; this.focusMountedComposer();
  }

  private userVoiceMessage(row: XopcChatRow): boolean {
    const media = row.media || [];
    return !(row.refs?.length || 0) && media.length === 1
      && media.every((file: XopcHistoryMedia): boolean => file.mimeType.startsWith('audio/'));
  }

  private userVoiceOnly(row: XopcChatRow): boolean {
    return !row.text && this.userVoiceMessage(row);
  }

  private textBubbleWidth(text: string, minimum: number, maximum: number): string {
    let units = 0;
    for (let index = 0; index < text.length; index++) {
      units += text.charCodeAt(index) > 255 ? 1 : 0.55;
    }
    const width = Math.max(minimum, Math.min(maximum, Math.ceil(units * 16) + 30));
    return width >= maximum ? '90%' : width + 'vp';
  }

  private userBubbleWidth(row: XopcChatRow): string {
    if (this.userVoiceOnly(row)) return '132vp';
    if (this.userVoiceMessage(row)) return '180vp';
    const payloadCount = (row.media?.length || 0) + (row.refs?.length || 0);
    if (payloadCount > 1 || row.text.length > 18) return '90%';
    if (payloadCount === 1) return '220vp';
    return this.textBubbleWidth(row.text, 44, 250);
  }

  private assistantBubbleWidth(row: XopcChatRow): string {
    if (chatNeedsWideBubble(row)) return '90%';
    if (row.live && !row.text && !row.blocks?.length) return this.textBubbleWidth(row.progress || '', 132, 272);
    return this.textBubbleWidth(chatAnswerText(row), 64, 272);
  }

  private openMessageDetail(row: XopcChatRow): void {
    this.messageDetailRow = row;
    this.messageDetailOpen = true;
  }

  private navigateFromMessageDetail(route: XopcMobileRoute): void {
    this.messageDetailOpen = false;
    this.onNavigate(route);
  }

  private fillDraftFromMessageDetail(text: string): void {
    this.messageDetailOpen = false;
    this.fillProductDraft(text);
  }

  private openImageEditor(index: number): void {
    if (this.chat.sending || index < 0 || index >= this.attachments.length) return;
    const file = this.attachments[index];
    if (!file.mimeType.startsWith('image/') || !file.data) return;
    this.imageEditorIndex = index; this.imageEditorRotation = 0; this.imageEditorAspect = 'original';
    this.imageEditorError = ''; this.imageEditorOpen = true;
  }

  private async applyImageEditor(): Promise<void> {
    const index = this.imageEditorIndex;
    if (this.imageEditorBusy || index < 0 || index >= this.attachments.length) return;
    if (this.imageEditorRotation === 0 && this.imageEditorAspect === 'original') { this.imageEditorOpen = false; return; }
    this.imageEditorBusy = true; this.imageEditorError = '';
    try {
      const edited = await editChatImageAttachment(this.attachments[index], this.imageEditorRotation, this.imageEditorAspect);
      validateAttachmentSize(edited.size, this.attachments.filter((_file: XopcChatAttachment, i: number): boolean => i !== index));
      this.attachments = this.attachments.map((file: XopcChatAttachment, i: number): XopcChatAttachment => i === index ? edited : file);
      this.imageEditorOpen = false;
    } catch (error) { this.imageEditorError = (error as Error).message; }
    finally { this.imageEditorBusy = false; }
  }

  aboutToAppear(): void {
    this.visible = this.activePage;
    if (this.visible) { this.bindBack(); this.attention.activate(); }
    this.appliedRequestRevision = this.requestRevision;
    this.chat.start(this.requestedId, true);
  }
  private bindBack(): void { layoutState.dismissChatOverlay = (): boolean => { return this.dismissOverlay(); }; }
  private dismissOverlay(): boolean {
    if (this.panelOpen) { this.setPanel(false); return true; }
    return false;
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
      this.onConversationChange(this.chat.selectedId);
      this.optionsId = id; this.options.load(this.chat.selectedId, this.chat.agentId); this.context.load(this.chat.selectedId); this.prompt.start(this.chat.selectedId);
    }
  }
  @Monitor('chat.auxiliaryRevision')
  onAuxiliaryState(): void { if (this.visible) { this.options.refreshQueue(); this.prompt.refresh(); } }
  @Monitor('activePage')
  onActivityChange(): void {
    this.visible = this.activePage;
    if (!this.activePage) { clearTimeout(this.scrollTimer); this.layoutScrollAnimating = false; }
    if (!this.activePage) { clearTimeout(this.composerFocusTimer); this.focusComposerOnMount = false; this.attention.dispose(); this.saveDraft(); this.palette.close(); this.voiceHeld = false; this.voiceDestination = 'send'; this.voice.cancel(); this.reader.stop(); this.setPanel(false); this.sheetOpen = false; this.options.pause(); this.prompt.pause(); this.chat.deactivate(); }
    else { this.attention.activate(); this.bindBack(); this.chat.activate(); this.onHistoryReady(); this.options.resume(); this.prompt.resume(); }
  }
  @Monitor('requestRevision', 'chat.sending')
  onTargetChange(): void {
    if (this.disposed || !this.requestedId || this.appliedRequestRevision === this.requestRevision || this.chat.sending) return;
    this.appliedRequestRevision = this.requestRevision;
    this.dismissComposer(); this.sheetOpen = false;
    if (this.requestedId === this.chat.selectedId) return;
    this.saveDraft(); this.voiceHeld = false; this.voiceDestination = 'send'; this.voice.cancel(); this.reader.stop(); this.showVoice = false;
    this.options.dispose(); this.context.dispose(); this.prompt.dispose();
    this.options = new XopcChatOptionsViewModel(); this.context = new XopcChatContextViewModel();
    this.prompt = new XopcChatPromptViewModel(); this.optionsId = '';
    this.olderGeneration++; this.loadingOlder = false; this.olderFailed = false; this.firstVisible = 0;
    this.chat.open(this.requestedId);
  }
  @Monitor('focusRevision', 'chat.selectedId', 'restoringDraft', 'activePage')
  onFocusRequest(): void {
    if (!this.focusRevision || this.appliedFocusRevision === this.focusRevision || !this.activePage
      || this.restoringDraft || this.chat.selectedId !== this.requestedId) return;
    this.appliedFocusRevision = this.focusRevision;
    this.focusComposerOnMount = true;
    this.focusMountedComposer();
  }
  @Monitor('actionRevision', 'chat.selectedId', 'chat.loading', 'restoringDraft', 'activePage')
  onActionRequest(): void {
    if (!this.actionRevision || this.appliedActionRevision === this.actionRevision || !this.requestedAction
      || !this.activePage || this.restoringDraft || this.chat.loading || this.chat.selectedId !== this.requestedId) return;
    this.appliedActionRevision = this.actionRevision;
    this.setPanel(true);
    this.chooseAction(this.requestedAction);
  }
  aboutToDisappear(): void { this.attention.dispose(); this.visible = false; this.disposed = true; clearTimeout(this.composerFocusTimer); clearTimeout(this.intakeTimer); clearTimeout(this.scrollTimer); clearTimeout(this.draftTimer); this.saveDraft(); this.draftGeneration++; this.palette.dispose(); this.setPanel(false); this.prompt.dispose(); this.context.dispose(); this.options.dispose(); this.chat.dispose(); this.voiceHeld = false; this.voiceDestination = 'send'; this.voice.cancel(); this.reader.disableContinuous(); this.attachments = []; }

  private async attentionAction(action: XopcHomeAction): Promise<void> {
    if (action.type === 'open') {
      const route: XopcMobileRoute | undefined = mobileRoute(action.href ?? '');
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
          buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary }, { text: $r('app.string.confirm'), color: this.colors.danger }] });
        if (result.index !== 1) return;
      } catch (_) { return; }
    }
    this.voiceHeld = false; this.voiceDestination = 'send'; this.voice.cancel(); this.draft = ''; this.attachments = []; this.refs = [];
    this.editingQueuedId = ''; this.editingTurnId = '';
    this.sheetOpen = false; this.setPanel(false); await this.chat.create(agentId, projectId, executionMode);
  }

  @Monitor('quickIntake.revision', 'chat.selectedId', 'chat.loading', 'chat.sending', 'chat.connection', 'restoringDraft',
    'options.loading', 'options.modelId', 'activePage')
  async sendQuickSubmission(): Promise<void> {
    if (!this.activePage || this.embedded || this.restoringDraft || this.chat.loading || this.chat.sending
      || this.options.loading || !this.options.modelId
      || this.chat.selectedId !== this.requestedId || this.chat.connection !== 'connected') return;
    const profile = gatewaySession.currentProfile();
    const scope = JSON.stringify([profile?.gatewayId || '', profile?.deviceId || '', this.chat.selectedId]);
    if (this.draftScope !== scope) return;
    const submission = this.quickIntake.consume(this.chat.selectedId);
    if (!submission) return;
    // Claim before awaiting: repeated layout/connection notifications must not send twice.
    this.draft = submission.text; this.attachments = submission.files; this.refs = submission.refs;
    this.saveDraft();
    if (!submission.autoSend) {
      this.focusComposerOnMount = true;
      this.focusMountedComposer();
      return;
    }
    await this.send();
  }

  private async send(delivery: string = 'next'): Promise<void> {
    if (this.restoringDraft) return;
    // A local-first conversation becomes visible before its model catalog is loaded.
    // Do not create a doomed optimistic bubble during that short initialization window.
    if (this.options.loading || this.options.saving) return;
    if (!this.options.modelId) { this.chat.error = this.options.error || 'MODEL_UNAVAILABLE'; return; }
    const text = this.draft; const files = this.attachments; const refs = this.refs; const id = this.chat.selectedId;
    if (this.editingQueuedId) {
      const queued = this.options.queued.find((item: XopcQueuedInput): boolean => item.id === this.editingQueuedId);
      if (!queued) { this.editingQueuedId = ''; return; }
      const updated = await this.options.updateQueued(queued, { content: text, attachments: files, contextRefs: refs });
      if (updated) this.cancelEditing();
      return;
    }
    if (this.editingTurnId) {
      const replaced = await this.chat.replaceLatest(this.editingTurnId, text, files, refs);
      if (replaced) { this.cancelEditing(); this.options.refreshQueue(); }
      return;
    }
    const sent = await this.chat.send(text, files, delivery, refs, (): void => {
      if (this.draft === text) this.draft = '';
      if (this.attachments === files) this.attachments = [];
      if (this.refs === refs) this.refs = [];
      this.palette.close(); this.saveDraft(); this.setPanel(false);
    });
    if (sent && this.visible && id === this.chat.selectedId) this.options.refreshQueue();
  }
  private async retryMessage(id: string): Promise<void> {
    if (await this.chat.retrySend(id)) { if (this.visible) this.options.refreshQueue(); }
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

  private async sendVoice(closeVoiceAfterSend: boolean = true): Promise<void> {
    const id = this.chat.selectedId;
    const sent = await this.voice.send(async (attachment: XopcChatAttachment): Promise<boolean> => {
      if (!this.visible || this.disposed || id !== this.chat.selectedId) return false;
      const context = this.getUIContext().getHostContext();
      let queued = false;
      this.chat.send('', [attachment], 'next', [], (): void => { queued = true; });
      if (queued && context) seedChatMediaCache(context, attachment, id).catch((_error: Error): void => {});
      return queued;
    });
    if (sent && closeVoiceAfterSend && this.visible && id === this.chat.selectedId) this.showVoice = false;
  }

  private openReference(kind: string): void { this.referenceKind = kind; this.openSheet('references'); }

  private toggleVoice(): void {
    if (this.chat.sending || this.voice.busy || this.voice.state !== 'idle') return;
    this.setPanel(false); this.palette.close(); this.editor.stopEditing();
    this.focusComposerOnMount = this.showVoice; this.showVoice = !this.showVoice;
  }

  private voiceTouchPoint(event: TouchEvent): TouchObject | undefined {
    return event.changedTouches.find((point: TouchObject): boolean =>
      !this.voiceHeld || point.id === this.voicePointerId);
  }

  private async beginVoiceHold(point: TouchObject): Promise<void> {
    if (this.voiceHeld || this.voiceFinishing || this.chat.sending || this.voice.busy || this.voice.state !== 'idle') return;
    const context = this.getUIContext().getHostContext();
    if (!context) return;
    this.voiceHeld = true; this.voiceDestination = 'send';
    this.voicePointerId = point.id;
    const generation = ++this.voiceHoldGeneration;
    this.voiceStartX = point.windowX; this.voiceStartY = point.windowY;
    await this.reader.stop();
    if (generation !== this.voiceHoldGeneration || !this.voiceHeld || !this.visible || this.disposed) return;
    await this.voice.start(context as common.UIAbilityContext);
  }

  private updateVoiceDestination(point: TouchObject): void {
    if (!this.voiceHeld) return;
    this.voiceDestination = resolveVoiceRecordingDestination(point.windowX - this.voiceStartX,
      point.windowY - this.voiceStartY, this.voiceDestination);
  }

  private async finishVoiceHold(forceCancel: boolean = false): Promise<void> {
    if (!this.voiceHeld) return;
    const destination: XopcVoiceRecordingDestination = forceCancel ? 'cancel' : this.voiceDestination;
    this.voiceHeld = false;
    ++this.voiceHoldGeneration;
    this.voiceRetryDestination = destination;
    this.voiceFinishing = true;
    try {
      if (destination === 'cancel' || this.voice.state === 'preparing') {
        await this.voice.cancel(); return;
      }
      if (this.voice.state === 'recording') await this.voice.stop();
      await this.deliverVoiceRecording();
    } finally { this.voiceFinishing = false; this.voiceDestination = 'send'; }
  }

  private async deliverVoiceRecording(): Promise<void> {
    if (this.voice.state !== 'ready' || this.voice.busy) return;
    if (this.voiceRetryDestination === 'text') await this.transcribe();
    else await this.sendVoice(false);
    // A tap is not a recoverable recording; return directly to hold-to-speak.
    if (this.voice.error === 'RECORDING_TOO_SHORT') await this.voice.cancel();
  }

  private handleVoiceTouch(event: TouchEvent): void {
    const point = this.voiceTouchPoint(event);
    if (event.type === TouchType.Down && point) { this.beginVoiceHold(point); return; }
    if (event.type === TouchType.Move && point) { this.updateVoiceDestination(point); return; }
    if (event.type === TouchType.Up && point) {
      this.updateVoiceDestination(point);
      this.finishVoiceHold(); return;
    }
    if (event.type === TouchType.Cancel) this.finishVoiceHold(true);
  }

  private voiceDuration(): string {
    const minutes = Math.floor(this.voice.seconds / 60).toString().padStart(2, '0');
    const seconds = (this.voice.seconds % 60).toString().padStart(2, '0');
    return minutes + ':' + seconds;
  }

  private voiceHoldHint(): ResourceStr {
    if (this.voiceFinishing || (!this.voiceHeld && this.voice.busy)) return $r('app.string.voice_working');
    if (this.voice.state === 'preparing') return $r('app.string.voice_preparing');
    if (this.voiceDestination === 'cancel') return $r('app.string.voice_release_cancel');
    if (this.voiceDestination === 'text') return $r('app.string.voice_release_text');
    if (this.voice.state === 'recording') return $r('app.string.voice_release_send');
    return $r('app.string.voice_hold_to_speak');
  }

  private focusMountedComposer(): void {
    if (!this.focusComposerOnMount) return;
    clearTimeout(this.composerFocusTimer);
    this.composerFocusTimer = setTimeout((): void => {
      if (this.visible && !this.disposed && !this.showVoice && !this.sheetOpen && !this.panelOpen) {
        try {
          this.getUIContext().getFocusController().requestFocus('chat-composer');
          this.editor.caretPosition(this.draft.length);
          this.focusComposerOnMount = false; this.composerFocusAttempts = 0;
        } catch (_) {
          this.composerFocusAttempts++;
          if (this.composerFocusAttempts < 4) this.focusMountedComposer();
          else { this.focusComposerOnMount = false; this.composerFocusAttempts = 0; }
        }
      }
    }, 50);
  }

  private hasConnectionIssue(): boolean {
    return this.chat.connection === 'unauthorized' || this.chat.connection === 'client_update_required'
      || this.chat.connection === 'gateway_update_required' || this.chat.connection.startsWith('error:');
  }

  private contextMenuSummary(): ResourceStr {
    const project = this.context.summary?.work.project?.title || '';
    const environment = this.context.summary?.environment?.kind === 'managed_worktree' ? 'Worktree'
      : this.context.summary?.environment ? 'Local' : '';
    if (project && environment) return project + ' · ' + environment;
    if (project) return project;
    if (environment) return environment;
    return $r('app.string.chat_no_project');
  }

  @Builder
  voiceToggle() {
    Button({ type: ButtonType.Circle }) {
      SymbolGlyph(this.showVoice ? $r('sys.symbol.keyboard') : $r('sys.symbol.mic')).fontSize(22).fontColor([this.colors.accent])
    }.id('chat-voice-toggle').width(COMPOSER_TOOL_SIZE).height(COMPOSER_TOOL_SIZE).padding(0)
      .backgroundColor(this.colors.input).responseRegion({ x: -4, y: -4, width: 44, height: 44 })
      .accessibilityText(this.showVoice ? $r('app.string.chat_switch_keyboard') : $r('app.string.record_voice'))
      .enabled(!this.chat.sending && !this.voice.busy && this.voice.state === 'idle')
      .onClick((): void => { this.toggleVoice(); })
  }

  @Builder
  composerRightActions() {
    Row({ space: 4 }) {
      if (!this.chat.runId || !this.hasPayload) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph(this.panelOpen ? $r('sys.symbol.xmark_circle') : $r('sys.symbol.plus_circle'))
            .fontSize(24).fontColor([this.colors.accent])
        }.id('chat-composer-actions').width(COMPOSER_TOOL_SIZE).height(COMPOSER_TOOL_SIZE).padding(0)
          .backgroundColor(this.colors.input).responseRegion({ x: -4, y: -4, width: 44, height: 44 })
          .accessibilityText($r('app.string.add_attachment'))
          .enabled(!!this.chat.selectedId && !this.pickingAttachment && !this.chat.sending && this.voice.state === 'idle' && !this.voice.busy)
          .onClick((): void => { this.setPanel(!this.panelOpen); })
      }
      if (this.hasPayload) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.arrow_up')).fontSize(22).fontColor([this.colors.panel])
        }.id('chat-send').width(COMPOSER_TOOL_SIZE).height(COMPOSER_TOOL_SIZE).padding(0)
          .backgroundColor(this.colors.foreground).responseRegion({ x: -4, y: -4, width: 44, height: 44 })
          .accessibilityText(this.chat.runId ? $r('app.string.chat_send_next') : $r('app.string.send'))
          .enabled(!!this.chat.selectedId && !this.chat.loading && !this.chat.cachedHistory && !this.pickingAttachment
            && this.voice.state === 'idle' && !this.voice.busy && !this.chat.sending
            && !this.options.loading && !this.options.saving && !!this.options.modelId)
          .onClick((): void => { this.send(); })
      }
      if (this.chat.runId) {
        Button({ type: ButtonType.Circle }) { Text('■').fontSize(18).fontColor(this.colors.panel) }
          .id('chat-stop').width(COMPOSER_TOOL_SIZE).height(COMPOSER_TOOL_SIZE).padding(0)
          .backgroundColor(this.colors.foreground).responseRegion({ x: -4, y: -4, width: 44, height: 44 })
          .accessibilityText($r('app.string.stop')).onClick((): void => { this.chat.abort(); })
      }
    }
  }

  @Builder
  skeleton() {
    Column({ space: 16 }) {
      ForEach([0, 1, 2, 3], (index: number) => {
        Column() {}.width(index % 2 === 0 ? '90%' : '70%').height(64).borderRadius(12)
          .backgroundColor(this.colors.panel)
      }, (index: number): string => index.toString())
    }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
  }

  @Builder
  userMessageMenu(row: XopcChatRow) {
    Menu() {
      MenuItem({ content: $r('app.string.chat_copy') })
        .onClick((): void => { this.messageAction('copy', row); })
      MenuItem({ content: !this.chat.runId && this.isLatestUser(row) && row.turnId
        ? $r('app.string.chat_edit_latest') : $r('app.string.chat_reuse') })
        .onClick((): void => { this.messageAction('edit', row); })
    }
  }

  @Builder
  assistantMessageMoreMenu(row: XopcChatRow) {
    Menu() {
      MenuItem({ content: $r('app.string.chat_regenerate') })
        .enabled(!this.chat.runId && !this.chat.sending).onClick((): void => { this.messageAction('regenerate', row); })
      if (extractMarkdownCodeBlocks(chatAnswerText(row))) {
        MenuItem({ content: $r('app.string.chat_copy_code') })
          .onClick((): void => { this.messageAction('copy-code', row); })
      }
    }
  }

  @Builder
  assistantMessageActions(row: XopcChatRow) {
    Row({ space: 2 }) {
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.doc_plaintext')).fontSize(18).fontColor([this.colors.tertiary])
      }.width(40).height(40).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.chat_copy'))
        .onClick((): void => { this.messageAction('copy', row); })
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.bookmark')).fontSize(18).fontColor([this.colors.tertiary])
      }.width(40).height(40).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.chat_save_note')).enabled(!this.savingNote)
        .onClick((): void => { this.messageAction('save', row); })
      if (!(row.media || []).some((file: XopcHistoryMedia): boolean => file.mimeType.startsWith('audio/'))) {
        Button({ type: ButtonType.Circle }) {
          if (this.reader.sourceId === row.id && this.reader.state === 'loading') {
            LoadingProgress().width(18).height(18).color(this.colors.secondary)
          } else if (this.reader.sourceId === row.id && this.reader.state === 'playing') {
            Text('Ⅱ').fontSize(18).fontColor(this.colors.secondary)
          } else {
            SymbolGlyph($r('sys.symbol.speaker_wave_2')).fontSize(18).fontColor([this.colors.tertiary])
          }
        }.width(40).height(40).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText(this.reader.sourceId === row.id && this.reader.state === 'playing' ? $r('app.string.pause')
            : this.reader.sourceId === row.id && this.reader.state === 'paused' ? $r('app.string.resume') : $r('app.string.chat_read_aloud'))
          .enabled(!!chatAnswerText(row))
          .onClick((): void => { this.messageAction('read', row); })
      }
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.ellipsis_circle')).fontSize(19).fontColor([this.colors.tertiary])
      }.id('chat-assistant-more-' + row.id).width(40).height(40).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.more')).bindMenu(this.assistantMessageMoreMenu(row))
    }.width('100%').padding({ left: 8 }).justifyContent(FlexAlign.Start)
  }

  @Builder
  conversation() {
    Stack({ alignContent: Alignment.Bottom }) {
    Column() {
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
        } }).layoutWeight(1).width('100%').padding({ bottom: this.bottomRegionHeight })
    } else {
    Stack({ alignContent: Alignment.Bottom }) {
    List({ space: 20, scroller: this.messagesScroller }) {
      if (this.chat.hasOlder) {
        ListItem() {
          Row() {
            if (this.loadingOlder) { LoadingProgress().width(20).height(20).color(this.colors.secondary) }
            else { Button(this.olderFailed ? $r('app.string.refresh') : $r('app.string.older_messages'))
              .height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
              .onClick((): void => { this.loadOlder(); }) }
          }.width('100%').height(44).justifyContent(FlexAlign.Center)
        }
      }
      Repeat<XopcChatRow>(this.presentationRows).each((item: RepeatItem<XopcChatRow>) => {
        ListItem() {
          if (item.item.role === 'user') {
            Column({ space: 2 }) {
              Row() {
                if (item.item.sendState === 'sending') {
                  LoadingProgress().width(24).height(24).color(this.colors.secondary).margin({ right: 8 })
                } else if (item.item.sendState === 'failed') {
                  Button({ type: ButtonType.Circle }) {
                    Text('!').fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.colors.danger)
                  }.id('chat-message-retry-' + item.item.id).width(32).height(44).padding(0)
                    .backgroundColor(Color.Transparent).accessibilityText($r('app.string.chat_retry_send'))
                    .enabled(!this.chat.sending && !this.chat.loading && !this.chat.cachedHistory)
                    .onClick((): void => { this.retryMessage(item.item.id); })
                }
                Column() {
                  XopcChatMessageContent({ row: item.item, conversationId: this.chat.selectedId, disclosure: this.disclosure,
                    previewEligible: item.item.id !== this.latestMessageId,
                    onShowMore: (row: XopcChatRow): void => { this.openMessageDetail(row); },
                    reasoning: this.context.config?.reasoningLevel || 'on', onNavigate: this.onNavigate,
                    onFillDraft: (text: string): void => { this.fillProductDraft(text); } })
                }.id('chat-user-bubble-' + item.item.id).width(this.userBubbleWidth(item.item))
                  .constraintSize({ minWidth: 44, maxWidth: item.item.sendState === 'sending' || item.item.sendState === 'failed' ? '84%' : '90%' })
                  .padding(this.userVoiceOnly(item.item) ? { left: 4, right: 4, top: 0, bottom: 0 }
                    : { left: 14, right: 14, top: 10, bottom: 10 }).alignItems(HorizontalAlign.Start)
                  .borderRadius(18).backgroundColor(this.colors.accentSoft)
                  .bindContextMenu(item.item.text ? this.userMessageMenu(item.item) : undefined, ResponseType.LongPress)
              }.width('100%').justifyContent(FlexAlign.End)
            }.width('100%').alignItems(HorizontalAlign.End)
          } else if (item.item.role === 'assistant') {
            Column({ space: 2 }) {
              Column() {
                XopcChatMessageContent({ row: item.item, conversationId: this.chat.selectedId, disclosure: this.disclosure,
                  previewEligible: item.item.id !== this.latestMessageId,
                  onShowMore: (row: XopcChatRow): void => { this.openMessageDetail(row); },
                  reasoning: this.context.config?.reasoningLevel || 'on', onNavigate: this.onNavigate,
                  onFillDraft: (text: string): void => { this.fillProductDraft(text); } })
              }.id('chat-assistant-card-' + item.item.id).width(this.assistantBubbleWidth(item.item))
                .constraintSize({ minWidth: 64, maxWidth: '90%' })
                .padding({ left: 16, right: 16, top: 14, bottom: 14 }).alignItems(HorizontalAlign.Start)
                .borderRadius(18).backgroundColor(this.colors.panel)
              if (!item.item.live && chatAnswerText(item.item)) { this.assistantMessageActions(item.item) }
            }.width('100%').alignItems(HorizontalAlign.Start)
          } else {
            Column({ space: 2 }) {
              XopcChatMessageContent({ row: item.item, conversationId: this.chat.selectedId, disclosure: this.disclosure,
                reasoning: this.context.config?.reasoningLevel || 'on', onNavigate: this.onNavigate,
                onFillDraft: (text: string): void => { this.fillProductDraft(text); } })
            }.width('100%').alignItems(HorizontalAlign.Start)
          }
        }
      }).key((row: XopcChatRow): string => this.chat.selectedId + ':' + row.id).virtualScroll({ totalCount: this.presentationRows.length })
    }.id('chat-message-list').height('100%').width('100%').padding({ left: 12, right: 12 }).cachedCount(3)
      .contentEndOffset(this.bottomRegionHeight + 24)
      .onAreaChange((previous: Area, current: Area): void => { this.onMessageViewportChange(previous, current); })
      .onScrollIndex((start: number, end: number): void => {
        this.firstVisible = start;
      })
      .onDidScroll((offset: number, state: ScrollState): void => {
        if (this.layoutScrollAnimating || this.initialScrollPending || this.loadingOlder || this.chat.loading || state === ScrollState.Idle) return;
        this.atBottom = this.messagesScroller.isAtEnd();
        if (this.atBottom) this.showJumpBottom = false;
        else if (offset > 0) this.showJumpBottom = true;
        else if (offset < 0) this.showJumpBottom = false;
        if (offset < 0 && this.messagesScroller.currentOffset().yOffset < 960 && !this.olderFailed) this.loadOlder();
      })
      .onScrollStop((): void => { this.finishLayoutScroll(); })
      .onTouch((event: TouchEvent): void => {
        if (event.type === TouchType.Down) {
          this.layoutScrollAnimating = false; clearTimeout(this.scrollTimer); this.dismissComposer();
        }
      })
    if (!this.atBottom && this.showJumpBottom) {
      Button({ type: ButtonType.Circle }) {
        if (this.chat.runId) {
          XopcBrandLoading({ compact: true, reduceMotion: this.layout.reduceMotion })
        } else {
          Text('↓').fontSize(20).fontColor(this.colors.secondary)
        }
      }.id('chat-jump-bottom').height(36).width(36).padding(0).margin({ bottom: this.bottomRegionHeight + 8 })
        .responseRegion({ x: -4, y: -4, width: 44, height: 44 })
        .backgroundColor(this.colors.grouped).accessibilityText($r('app.string.chat_jump_bottom'))
        .onClick((): void => { this.atBottom = true; this.showJumpBottom = false; this.messagesScroller.scrollEdge(Edge.Bottom); })
    }
    }.id('chat-message-viewport').layoutWeight(1).width('100%').backgroundColor(Color.Transparent)
    }
    }.id('chat-content-viewport').width('100%').height('100%')
      // Keep messages behind the floating dock; reserve clearance inside the list's scroll extent.
      .clip(true)
    Column() {
    Column() {
    if (this.prompt.prompt) { XopcChatPrompt({ model: this.prompt }) }
    else if (this.unseenAttention.length) {
      Row({ space: 8 }) {
        Button({ type: ButtonType.Normal }) {
          Column({ space: 4 }) {
            Text(this.unseenAttention[0].title).fontSize(14).fontColor(this.colors.foreground).maxLines(1)
            Text(this.unseenAttention[0].summary).fontSize(12).fontColor(this.colors.secondary).maxLines(1)
          }.alignItems(HorizontalAlign.Start)
        }.id('chat-attention-open').layoutWeight(1).backgroundColor(Color.Transparent).padding(8)
          .onClick((): void => { this.openSheet('attention'); })
        Text(this.attentionItems.length.toString()).fontColor(this.colors.accent)
        Button('×').height(44).width(44).padding(0).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
          .accessibilityText($r('app.string.chat_close')).onClick((): void => { this.attention.dismiss(this.attentionItems); })
      }.width('92%').borderRadius(12).backgroundColor(this.colors.accentSoft).margin({ bottom: 8 })
    }
    if (this.options.queued.length || this.options.queueError) {
      Button() {
        Row({ space: 8 }) { Text($r('app.string.chat_queue')); Text(this.options.queued.length.toString()) }
      }.id('chat-queue')
        .height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
        .onClick((): void => { this.options.refreshQueue(); this.openSheet('queue'); })
    }
    if (this.editingQueuedId || this.editingTurnId) {
      Row({ space: 8 }) {
        Text(this.editingQueuedId ? $r('app.string.chat_editing_queued') : $r('app.string.chat_editing_latest'))
          .fontSize(12).fontColor(this.colors.secondary).layoutWeight(1)
        Button($r('app.string.cancel')).height(40).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
          .onClick((): void => { this.cancelEditing(); })
      }.padding({ left: 16, right: 16 }).width('100%')
    }
    if (this.chat.runId && (this.draft.trim() || this.attachments.length || this.refs.length)) {
      Row({ space: 8 }) {
        Text(this.attachments.length || this.refs.length ? $r('app.string.chat_queue_rich_hint') : $r('app.string.chat_queue_hint'))
          .fontSize(12).fontColor(this.colors.secondary).layoutWeight(1)
        if (!this.attachments.length && !this.refs.length) {
          Button($r('app.string.chat_steer')).height(44).enabled(!this.chat.sending && !this.options.saving)
            .backgroundColor(Color.Transparent).fontColor(this.colors.accent).onClick((): void => { this.send('steer'); })
        }
      }.padding({ left: 16, right: 16 })
    }
    if (this.refs.length) {
      Scroll() {
        Row({ space: 8 }) {
          ForEach(this.refs, (ref: XopcContextRef) => {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 6 }) {
                SymbolGlyph(ref.kind === 'task' ? $r('sys.symbol.checkmark_circle') : $r('sys.symbol.doc_text'))
                  .fontSize(14).fontColor([this.colors.secondary])
                Text(ref.title || ref.sourceId).fontSize(12).fontWeight(FontWeight.Medium)
                  .fontColor(this.colors.secondary).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                SymbolGlyph($r('sys.symbol.xmark')).fontSize(11).fontColor([this.colors.tertiary])
              }.height('100%').alignItems(VerticalAlign.Center)
            }.id('chat-composer-reference-' + ref.kind + '-' + ref.sourceId).height(36)
              .padding({ left: 10, right: 9 }).borderRadius(10).backgroundColor(this.colors.panel)
              .accessibilityText($r('app.string.chat_remove_reference'))
              .responseRegion({ x: 0, y: -4, width: '100%', height: 44 })
              .onClick((): void => { this.refs = this.refs.filter((item: XopcContextRef): boolean => item !== ref); })
          }, (ref: XopcContextRef): string => ref.kind + ':' + ref.sourceId)
        }
      }.scrollable(ScrollDirection.Horizontal).width('92%').height(44)
    }
    if (this.voice.error) { Text(userErrorMessage(this.voice.error, 'save')).fontColor(this.colors.danger).padding(8) }
    if (this.reader.error) { Text(userErrorMessage(this.reader.error, 'generic')).fontColor(this.colors.danger).padding(8) }
    if (this.reader.continuousConversationId === this.chat.selectedId && this.chat.selectedId) {
      Row({ space: 8 }) {
        Text($r('app.string.chat_continuous_active')).fontSize(13).fontColor(this.colors.secondary).layoutWeight(1)
        Button('×').width(44).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
          .accessibilityText($r('app.string.chat_continuous_stop')).onClick((): void => { this.reader.disableContinuous(); })
      }.id('chat-continuous-reading').padding({ left: 16, right: 16 }).width('100%')
    }
    if (this.reader.state !== 'idle') {
      Row({ space: 4 }) {
        if (this.reader.state === 'loading') {
          Row({ space: 12 }) {
            Stack() {
              LoadingProgress().width(20).height(20).color(this.colors.accent)
            }.width(36).height(36).borderRadius(18).backgroundColor(this.colors.accentSoft)
            Column({ space: 2 }) {
              Text($r('app.string.chat_read_aloud_loading')).fontSize(14).fontWeight(FontWeight.Medium)
                .fontColor(this.colors.foreground).maxLines(1).width('100%')
              Text($r('app.string.chat_read_aloud')).fontSize(11).fontColor(this.colors.secondary)
                .maxLines(1).width('100%')
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          }.layoutWeight(1).height(52).padding({ left: 8, right: 8 })
        } else {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 12 }) {
              Stack() {
                SymbolGlyph($r('sys.symbol.speaker_wave_2')).fontSize(18).fontColor([this.colors.accent])
              }.width(36).height(36).borderRadius(18).backgroundColor(this.colors.accentSoft)
              Column({ space: 2 }) {
                if (this.reader.state === 'paused') {
                  Text($r('app.string.chat_read_aloud_paused')).fontSize(14).fontWeight(FontWeight.Medium)
                    .fontColor(this.colors.foreground).maxLines(1).width('100%')
                  Text($r('app.string.chat_read_aloud_resume_hint')).fontSize(11).fontColor(this.colors.secondary)
                    .maxLines(1).width('100%')
                } else {
                  Text($r('app.string.chat_read_aloud_playing')).fontSize(14).fontWeight(FontWeight.Medium)
                    .fontColor(this.colors.foreground).maxLines(1).width('100%')
                  Text($r('app.string.chat_read_aloud_pause_hint')).fontSize(11).fontColor(this.colors.secondary)
                    .maxLines(1).width('100%')
                }
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              SymbolGlyph(this.reader.state === 'paused' ? $r('sys.symbol.play_fill') : $r('sys.symbol.pause_fill'))
                .fontSize(18).fontColor([this.colors.accent])
            }.width('100%')
          }.id('chat-read-aloud-toggle').layoutWeight(1).height(52).padding({ left: 8, right: 12 })
            .backgroundColor(Color.Transparent)
            .accessibilityText(this.reader.state === 'paused' ? $r('app.string.resume') : $r('app.string.pause'))
            .onClick((): void => { this.reader.toggle(); })
        }
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(17).fontColor([this.colors.secondary])
        }.id('chat-read-aloud-stop').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.stop')).onClick((): void => { this.reader.stop(); })
      }.id('chat-read-aloud-player').width('calc(100% - 16vp)').height(60).padding({ left: 4, right: 4 })
        .borderRadius(16).backgroundColor(this.colors.input).margin({ bottom: 4 })
    }
    if (this.palette.range && (this.palette.loading || this.palette.items.length || this.palette.error)) {
      Column({ space: 4 }) {
        if (this.palette.loading) {
          Column() {}.height(44).width('100%').borderRadius(12).backgroundColor(this.colors.grouped)
        }
        if (this.palette.error) { Text(userErrorMessage(this.palette.error, 'collection')).fontColor(this.colors.danger).fontSize(12) }
        List({ space: 4 }) {
          ForEach(this.palette.items, (item: XopcPaletteItem) => {
            ListItem() {
              Button({ type: ButtonType.Normal }) {
                Column({ space: 3 }) {
                  Text(item.name).fontSize(14).fontColor(this.colors.foreground).maxLines(1).width('100%')
                  Text(item.description).fontSize(12).fontColor(this.colors.secondary).maxLines(1).width('100%')
                }.alignItems(HorizontalAlign.Start).width('100%')
              }.width('100%').height(52).padding(8).backgroundColor(Color.Transparent).onClick((): void => { this.applyPalette(item); })
            }
          }, (item: XopcPaletteItem): string => item.id)
        }.width('100%').height(Math.min(3, this.palette.items.length) * 56)
      }.id('chat-command-palette').width('92%').padding(8).borderRadius(16).backgroundColor(this.colors.panel).margin({ bottom: 4 })
    }
    Column() {
      if (this.attachments.length) {
        Scroll() {
          Row({ space: 8 }) {
            ForEach(this.attachments, (file: XopcChatAttachment, index: number) => {
              if (file.mimeType.startsWith('image/')) {
                Stack({ alignContent: Alignment.TopEnd }) {
                  Column() {
                    XopcChatMediaView({ file: this.attachmentPreviews[index], conversationId: this.chat.selectedId,
                      draftPreview: true, compact: true, embedded: true, compactThumbnail: true,
                      compactThumbnailWidth: 96, compactThumbnailHeight: 64, compactThumbnailContain: true,
                      compactAvailable: true, compactDisclosure: false, compactMetadata: false })
                  }.width('100%').height('100%')
                  Button({ type: ButtonType.Circle }) {
                    SymbolGlyph($r('sys.symbol.xmark')).fontSize(13).fontColor([Color.White])
                  }.id('chat-composer-attachment-remove-' + index.toString()).width(28).height(28).padding(0)
                    .margin({ top: 4, right: 4 }).backgroundColor(Color.Black).enabled(!this.chat.sending)
                    .responseRegion({ x: -8, y: -8, width: 44, height: 44 })
                    .accessibilityText($r('app.string.remove_attachment'))
                    .onClick((): void => {
                      this.attachments = this.attachments.filter((_file: XopcChatAttachment, i: number): boolean => i !== index);
                    })
                }.id('chat-composer-attachment-' + index.toString()).width(104).height(72)
                  .borderRadius(12).backgroundColor(this.colors.grouped).clip(true)
              } else {
                Row() {
                  Column() {
                    XopcChatMediaView({ file: this.attachmentPreviews[index], conversationId: this.chat.selectedId,
                      draftPreview: true, compact: true, embedded: true, compactThumbnail: true,
                      compactAvailable: true, compactDisclosure: false, compactMetadata: true })
                  }.layoutWeight(1)
                  Button({ type: ButtonType.Circle }) {
                    SymbolGlyph($r('sys.symbol.xmark')).fontSize(13).fontColor([this.colors.secondary])
                  }.id('chat-composer-attachment-remove-' + index.toString()).width(36).height(44).padding(0)
                    .backgroundColor(Color.Transparent).enabled(!this.chat.sending)
                    .accessibilityText($r('app.string.remove_attachment'))
                    .onClick((): void => {
                      this.attachments = this.attachments.filter((_file: XopcChatAttachment, i: number): boolean => i !== index);
                    })
                }.id('chat-composer-attachment-' + index.toString()).width(220).height(56)
                  .borderRadius(10).backgroundColor(this.colors.grouped).clip(true)
              }
            }, (file: XopcChatAttachment, index: number): string => index.toString() + ':' + file.name + ':' + file.size.toString())
          }.padding({ left: 12, right: 12, top: 10, bottom: 8 })
        }.id('chat-composer-attachments').scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
          .width('100%').height(this.attachments.some((file: XopcChatAttachment): boolean => file.mimeType.startsWith('image/')) ? 90 : 74)
          .align(Alignment.TopStart)
      }
      Row({ space: 4 }) {
        if (!this.expandedComposer) { this.voiceToggle() }
        if (this.showVoice || this.voice.state !== 'idle') {
          Column() {
            if (this.voice.state === 'ready' && !this.voiceHeld && !this.voiceFinishing && !this.voice.busy) {
              Row({ space: 8 }) {
                Button($r('app.string.cancel')).id('chat-voice-cancel').height(44).layoutWeight(1)
                  .backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
                  .onClick((): void => { this.voice.cancel(); })
                Button($r('app.string.retry')).id('chat-voice-retry').height(44).layoutWeight(1)
                  .backgroundColor(this.colors.accentSoft).fontColor(this.colors.accent)
                  .enabled(!this.chat.sending && !this.chat.loading && !this.chat.cachedHistory && this.chat.connection === 'connected')
                  .onClick((): void => { this.deliverVoiceRecording(); })
              }.width('100%')
            } else {
              Button({ type: ButtonType.Normal, stateEffect: false }) {
                Text(this.voiceHoldHint()).fontSize(15).fontWeight(FontWeight.Medium)
                  .fontColor(this.voiceDestination === 'cancel' ? this.colors.danger : this.colors.foreground)
              }.id('chat-voice-record').width('100%').height(44).padding(0).borderRadius(14)
                .backgroundColor(this.voiceHeld ? this.colors.grouped : Color.Transparent)
                .enabled(this.voiceHeld || (!this.voiceFinishing && !this.voice.busy && !this.chat.sending))
                .accessibilityText($r('app.string.voice_hold_to_speak'))
                .onTouch((event: TouchEvent): void => { this.handleVoiceTouch(event); })
            }
          }.id('chat-voice-pad').layoutWeight(1)
        } else {
          // Keep one editor node across compact/expanded states so the IME and caret survive the first keystroke.
          TextArea({ text: this.draft, placeholder: $r('app.string.message_hint'), controller: this.editor })
            .id('chat-composer').layoutWeight(1).constraintSize({ minHeight: COMPOSER_INPUT_MIN, maxHeight: this.expandedComposer ? COMPOSER_INPUT_MAX : COMPOSER_INPUT_MIN })
            .padding({ left: 4, right: 4, top: this.expandedComposer ? 5 : 10, bottom: this.expandedComposer ? 5 : 10 }).lineHeight(20)
            .enabled(!this.restoringDraft).backgroundColor(Color.Transparent)
            .fontSize(16).fontColor(this.colors.foreground).placeholderColor(this.colors.tertiary)
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
    }.id('chat-composer-shell').width('calc(100% - 16vp)').backgroundColor(this.colors.input)
      .borderRadius(18).clip(true).margin({ bottom: 8, top: 8 })
    if (this.panelOpen) { this.actionPanel() }
    this.bottomDock()
    }.id('chat-bottom-surface').width('calc(100% - 16vp)').backgroundColor(Color.Transparent)
      .backgroundBlurStyle(BlurStyle.COMPONENT_REGULAR).borderRadius(24).clip(true)
    }.id('chat-bottom-region').width('100%')
      .margin({ top: 4, bottom: 0 })
      .onAreaChange((_previous: Area, current: Area): void => { this.bottomRegionHeight = Number(current.height); })
    if (this.voiceHeld) { this.voiceGestureFeedback() }
    }.width('100%').layoutWeight(1)
  }

  @Builder
  voiceGestureFeedback() {
    Row({ space: 16 }) {
      Stack() {
        SymbolGlyph($r('sys.symbol.xmark')).fontSize(19)
          .fontColor([this.voiceDestination === 'cancel' ? this.colors.danger : this.colors.secondary])
      }.id('chat-voice-cancel-target').width(48).height(48).borderRadius(24)
        .backgroundColor(this.voiceDestination === 'cancel' ? this.colors.input : Color.Transparent)
        .opacity(this.voiceDestination === 'text' ? 0.4 : 1)
        .accessibilityText($r('app.string.voice_slide_cancel'))
      Column({ space: 4 }) {
        SymbolGlyph($r('sys.symbol.waveform')).fontSize(25).fontColor([this.colors.accent])
        Text(this.voiceDuration()).fontSize(11).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.secondary)
      }.layoutWeight(1).alignItems(HorizontalAlign.Center)
      Stack() {
        SymbolGlyph($r('sys.symbol.text_alignleft')).fontSize(21)
          .fontColor([this.voiceDestination === 'text' ? this.colors.accent : this.colors.secondary])
      }.id('chat-voice-text-target').width(48).height(48).borderRadius(24)
        .backgroundColor(this.voiceDestination === 'text' ? this.colors.accentSoft : Color.Transparent)
        .opacity(this.voiceDestination === 'cancel' ? 0.4 : 1)
        .accessibilityText($r('app.string.voice_slide_text'))
    }.id('chat-voice-gesture-feedback').width('82%').constraintSize({ maxWidth: 340 }).height(80)
      .padding({ left: 16, right: 16 }).borderRadius(40)
      .backgroundColor(this.colors.panel)
      .margin({ bottom: this.bottomRegionHeight + 16 })
      .hitTestBehavior(HitTestMode.None)
  }

  @Builder
  emptyDock() {}

  @Builder
  actionTile(id: string, label: Resource, symbol: Resource, enabled: boolean) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 6 }) {
        Row() {
          SymbolGlyph(symbol).fontSize(24).fontColor([this.colors.foreground])
        }.width(48).height(48).justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
          .borderRadius(14).backgroundColor(this.colors.input)
        Text(label).fontSize(12).fontColor(this.colors.secondary).maxLines(2).textAlign(TextAlign.Center)
      }.width('100%')
    }.id('chat-action-' + id).width('25%').height(84).padding(2).backgroundColor(Color.Transparent)
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
    Swiper() {
      Column({ space: 4 }) {
        Row() {
          this.actionTile('photos', $r('app.string.chat_photos'), $r('sys.symbol.picture'), !this.pickingAttachment && this.attachments.length < MAX_ATTACHMENTS)
          this.actionTile('camera', $r('app.string.chat_camera'), $r('sys.symbol.camera'), !this.pickingAttachment && this.attachments.length < MAX_ATTACHMENTS)
          this.actionTile('document', $r('app.string.chat_local_files'), $r('sys.symbol.folder'), !this.pickingAttachment && this.attachments.length < MAX_ATTACHMENTS)
          this.actionTile('record-voice', $r('app.string.record_voice'), $r('sys.symbol.mic'), !this.voice.busy && this.voice.state === 'idle')
        }.width('100%')
        Row() {
          this.actionTile('reference-note', $r('app.string.chat_reference_note'), $r('sys.symbol.doc'), this.refs.length < 5)
          this.actionTile('reference-task', $r('app.string.chat_reference_task'), $r('sys.symbol.checkmark_circle'), this.refs.length < 5)
          this.actionTile('reference-file', $r('app.string.chat_reference_file'), $r('sys.symbol.folder'), this.attachments.length < MAX_ATTACHMENTS)
          this.actionTile('new-chat', $r('app.string.new_chat'), $r('sys.symbol.square_and_pencil'), !this.chat.sending)
        }.width('100%')
      }.width('100%').padding({ left: 6, right: 6, top: 4, bottom: 20 })
      Column({ space: 4 }) {
        Row() {
          this.actionTile('voice-no-tools', $r('app.string.voice_call_action_natural'), $r('sys.symbol.waveform'), !!this.chat.selectedId && this.call.phase === 'idle')
          this.actionTile('voice-with-tools', $r('app.string.voice_call_action_assistant'), $r('sys.symbol.speaker_wave_2'), !!this.chat.selectedId && this.call.phase === 'idle')
        }.width('100%')
      }.width('100%').padding({ left: 6, right: 6, top: 4, bottom: 20 })
    }.id('chat-action-panel').width('100%').height(196).loop(false).autoPlay(false)
      .indicator(new DotIndicator().itemWidth(6).itemHeight(6).selectedItemWidth(6).selectedItemHeight(6)
        .color(this.colors.border).selectedColor(this.colors.secondary))
      .backgroundColor(this.colors.panel).borderRadius(18).clip(true).margin({ bottom: 8 })
  }

  build() {
    Stack({ alignContent: Alignment.Start }) {
    Column() {
      if (!this.embedded) {
        Row({ space: 12 }) {
        Row() {
          Text(this.chat.title || $r('app.string.untitled'))
            .fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        }.layoutWeight(1).height(44).padding({ left: 8, right: 8 }).alignItems(VerticalAlign.Center)
        if (this.chat.selectedId) {
          Button({ type: ButtonType.Normal }) {
            Text('···').fontSize(18).letterSpacing(-2).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.foreground)
          }.width(40).height(40).padding(0).backgroundColor(Color.Transparent)
            .id('chat-header-actions').accessibilityText($r('app.string.chat_actions')).onClick((): void => { this.openSheet('actions'); })
        }
        }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 6 })
      }
      if (this.hasConnectionIssue()) {
        Row({ space: 8 }) {
          Text(this.chat.connection === 'unauthorized' ? $r('app.string.connection_revoked')
            : this.chat.connection === 'client_update_required' ? $r('app.string.client_update_required')
            : this.chat.connection === 'gateway_update_required' ? $r('app.string.gateway_update_required')
            : this.chat.connection)
            .fontSize(12).fontColor(this.colors.secondary).layoutWeight(1)
          if (this.chat.connection === 'client_update_required' || this.chat.connection === 'gateway_update_required') {
            Button($r('app.string.refresh')).height(36).onClick((): void => { this.chat.reconnect(); })
          }
        }.width('100%').padding(8).alignItems(VerticalAlign.Center)
      }
      if (this.chat.cachedHistory) {
        Text($r('app.string.chat_cached_history')).id('chat-cached-history').fontSize(12).fontColor(this.colors.secondary)
          .padding({ left: 16, right: 16, bottom: 6 })
      }
      if (this.chat.error) {
        Row({ space: 8 }) {
          Text(userErrorMessage(this.chat.error, 'generic')).fontSize(12).fontColor(this.colors.secondary).layoutWeight(1).maxLines(3)
          Button($r('app.string.refresh')).height(44).onClick((): void => { this.chat.retryHistory(); })
        }.padding({ left: 16, right: 16 })
      }
      this.conversation()
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
      .bindSheet($$this.sheetOpen, this.optionsSheet, { height: this.sheetHeight, dragBar: true, showClose: false, backgroundColor: this.colors.panel })
    }.width('100%').height('100%')
      .bindSheet($$this.imageEditorOpen, this.imageEditorSheet, { height: '75%', dragBar: false,
        backgroundColor: this.colors.panel, onDisappear: (): void => { this.imageEditorError = ''; } })
      .bindSheet($$this.messageDetailOpen, this.messageDetailSheet, { height: '94%', dragBar: false,
        showClose: false, backgroundColor: this.colors.panel })
  }

  @Builder
  messageDetailSheet() {
    Column() {
      Row({ space: 12 }) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(20).fontColor([this.colors.foreground])
        }.id('chat-message-detail-close').width(44).height(44).padding(0).backgroundColor(this.colors.input)
          .accessibilityText($r('app.string.chat_close')).onClick((): void => { this.messageDetailOpen = false; })
        Column({ space: 2 }) {
          Text($r('app.string.chat_message_detail')).fontSize(20).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
          Text(this.messageDetailRow.role === 'user' ? $r('app.string.chat_user_message') : $r('app.string.chat_ai_response'))
            .fontSize(12).fontColor(this.colors.secondary)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%').padding({ left: 16, right: 16, top: 10, bottom: 12 }).alignItems(VerticalAlign.Center)
      Column().width('100%').height(1).backgroundColor(this.colors.border)
      Scroll() {
        Column() {
          XopcChatMessageContent({ row: this.messageDetailRow, conversationId: this.chat.selectedId,
            disclosure: this.disclosure, reasoning: this.context.config?.reasoningLevel || 'on',
            onNavigate: (route: XopcMobileRoute): void => { this.navigateFromMessageDetail(route); },
            onFillDraft: (text: string): void => { this.fillDraftFromMessageDetail(text); } })
        }.width('100%').padding({ left: 16, right: 16, top: 20, bottom: 32 }).alignItems(HorizontalAlign.Start)
      }.id('chat-message-detail-scroll').layoutWeight(1).width('100%').scrollBar(BarState.Auto)
        .align(Alignment.TopStart)
    }.id('chat-message-detail').width('100%').height('100%').backgroundColor(this.colors.panel)
  }

  @Builder
  imageEditorSheet() {
    Column({ space: 16 }) {
      Row({ space: 8 }) {
        Text($r('app.string.chat_image_edit')).fontSize(20).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).layoutWeight(1)
        Button($r('app.string.cancel')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
          .enabled(!this.imageEditorBusy).onClick((): void => { this.imageEditorOpen = false; })
        Button($r('app.string.chat_image_apply')).height(44).backgroundColor(this.colors.accent).fontColor(Color.White)
          .enabled(!this.imageEditorBusy).onClick((): void => { this.applyImageEditor(); })
      }.width('100%')
      Stack({ alignContent: Alignment.Center }) {
        if (this.imageEditorIndex >= 0 && this.imageEditorIndex < this.attachments.length) {
          Image('data:' + this.attachments[this.imageEditorIndex].mimeType + ';base64,' + this.attachments[this.imageEditorIndex].data)
            .width('100%').height('100%').objectFit(ImageFit.Contain).rotate({ angle: this.imageEditorRotation })
            .accessibilityText(this.attachments[this.imageEditorIndex].name)
        }
        if (this.imageEditorBusy) { LoadingProgress().width(32).height(32).color(this.colors.accent) }
      }.width('100%').layoutWeight(1).constraintSize({ minHeight: 220 }).borderRadius(16).clip(true).backgroundColor(this.colors.grouped)
      Row({ space: 8 }) {
        Button($r('app.string.chat_image_rotate')).height(44).layoutWeight(1).backgroundColor(this.colors.input).fontColor(this.colors.foreground)
          .enabled(!this.imageEditorBusy).onClick((): void => { this.imageEditorRotation = (this.imageEditorRotation + 90) % 360; })
        Button($r('app.string.reset')).height(44).layoutWeight(1).backgroundColor(this.colors.input).fontColor(this.colors.secondary)
          .enabled(!this.imageEditorBusy).onClick((): void => { this.imageEditorRotation = 0; this.imageEditorAspect = 'original'; })
      }.width('100%')
      Row({ space: 6 }) {
        ForEach(['original', 'square', '4:3', '16:9'], (aspect: string) => {
          Button(aspect === 'original' ? $r('app.string.chat_image_original') : aspect).height(40).layoutWeight(1).fontSize(12)
            .backgroundColor(this.imageEditorAspect === aspect ? this.colors.accentSoft : this.colors.input)
            .fontColor(this.imageEditorAspect === aspect ? this.colors.accent : this.colors.secondary)
            .enabled(!this.imageEditorBusy).onClick((): void => { this.imageEditorAspect = aspect; })
        }, (aspect: string): string => aspect)
      }.width('100%')
      if (this.imageEditorError) { Text($r('app.string.chat_image_edit_failed')).fontSize(13).fontColor(this.colors.danger).width('100%') }
    }.id('chat-image-editor').width('100%').height('100%').padding(20)
  }

  @Builder
  optionsSheet() {
    if (this.sheetMode === 'attention') {
      Column({ space: 12 }) {
        Row() {
          Text($r('app.string.needs_you')).fontSize(20).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).layoutWeight(1)
          Button($r('app.string.chat_close')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
            .onClick((): void => { this.sheetOpen = false; })
        }.width('100%')
        Scroll() {
          Column({ space: 12 }) {
            if (!this.attentionItems.length) { Text($r('app.string.nothing_needed')).fontColor(this.colors.secondary) }
            ForEach(this.attention.ordered(this.attentionItems).slice(0, 3), (item: XopcHomeItem) => {
              XopcChatAttentionRow({ item, pending: this.attention.pending, onAction: (action: XopcHomeAction): void => { this.attentionAction(action); } })
            }, (item: XopcHomeItem): string => item.id + ':' + JSON.stringify(item))
            if (this.attention.error) { Text(userErrorMessage(this.attention.error, 'save')).fontColor(this.colors.danger).width('100%') }
            Button($r('app.string.chat_attention_all')).height(48).width('100%').backgroundColor(Color.Transparent).fontColor(this.colors.accent)
              .onClick((): void => { this.sheetOpen = false; this.onNavigate({ page: 'progress', itemId: '' }); })
          }.width('100%')
        }.width('100%').layoutWeight(1)
      }.id('chat-attention-sheet').width('100%').height('100%').padding(20)
    } else if (['context', 'project', 'environment', 'directory', 'references'].includes(this.sheetMode)) {
      XopcChatContext({ model: this.context, initialMode: this.sheetMode, initialReferenceKind: this.referenceKind, refs: this.refs,
        onMode: (mode: string): void => { this.sheetMode = mode; },
        onScope: (projectId: string | null, mode?: string): void => { this.newConversation(this.options.agentId, projectId, mode); },
        onReference: (item: XopcReferenceItem): void => { this.addReference(item); },
        onClose: (): void => { this.sheetOpen = false; }, onRetry: (): void => { this.context.load(this.chat.selectedId); } })
    } else {
    XopcChatOptions({ model: this.options, mode: this.sheetMode, contextSummary: this.contextMenuSummary(),
      onContext: (): void => { this.sheetMode = 'context'; },
      onMode: (mode: string): void => { this.sheetMode = mode; }, onClose: (): void => { this.sheetOpen = false; },
      onRetry: (): void => { this.options.load(this.chat.selectedId, this.chat.agentId); },
      onAgent: (id: string): void => { this.newConversation(id); }, onNewChat: (): void => { this.newConversation(); },
      onEditQueued: (input: XopcQueuedInput): void => { this.editQueued(input); },
      onFiles: (): void => { this.sheetOpen = false; this.onNavigate({ page: 'session-files', itemId: this.chat.selectedId }); } })
    }
  }
}
