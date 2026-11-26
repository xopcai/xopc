import { capabilityText, capabilityDisplayOffset, capabilityWireOffset, editCapabilityText, XopcCapabilityText } from '../common/capabilityText';
import { loadDesktopChatTarget, reselectDesktopChatTarget, XopcDesktopChatTarget } from '../repository/deviceConnectionsRepository';
import { XopcConversationShare } from './ConversationShare';
import { LengthMetrics, SymbolGlyphModifier } from '@kit.ArkUI';
import { xopcConfirmDialog, xopcSheetOptions, xopcToast } from '../common/dialogActions';
import { xopcWithMotion } from '../common/motionTokens';
import { SEGMENTED_PAGE_TAP_SLOP_VP, XopcSegmentedTabs } from './SegmentedTabs';
import { XopcTaskChatHeader } from './TaskChatHeader';
import { XopcPhoneViewModel } from '../viewmodel/phoneViewModel';
import { XopcPhoneView } from './PhoneView';
import { XopcChatRenderKeys } from '../common/chatRenderKeys';
import type { XopcAgentReaction } from '../model/chat';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { userErrorMessage } from '../common/userError';
import { voiceInputErrorMessage } from '../common/voiceInputError';
import { XopcTransientNotice } from '../common/transientNotice';
import { chatDraftIntake, XopcChatDraftIntake } from '../service/chatDraftIntake';
import { XopcChatViewModel } from '../viewmodel/chatViewModel';
import { XopcConversationMcpAction } from './ConversationMcpAction';
import { XopcChatRow, XopcChatAttachment, XopcChatBlock, XopcContextRef, XopcReferenceItem,
  XopcHistoryMedia, XopcArtifact, XopcChatAgent, XopcHostDirectory, XopcExecutionDetail } from '../model/chat';
import { XopcChatMessageContent } from './ChatMessageContent';
import { XopcChatStepsView } from './ChatStepsView';
import { chatStageStatus } from '../common/chatLiveActivity';
import { CHAT_ACTION_PANEL_CLOSE_MS, CHAT_ACTION_PANEL_OPEN_MS, XopcChatActionPanel } from './ChatActionPanel';
import { XopcChatExecutionDetailView } from './ChatExecutionDetailView';
import { XopcChatRepository } from '../repository/chatRepository';
import { chatAnswerText, chatAnswerStarted, chatAttachments } from '../common/chatRichContent';
import { extractMarkdownCodeBlocks } from '../common/chatDisplay';
import { XopcChatMediaView } from './ChatMediaView';
import { XopcGeneratedMediaRow, XopcGeneratedVideoDrawer } from './GeneratedMediaView';
import { generatedMusicPlayback, XopcGeneratedMusicPlayback } from '../service/generatedMusicPlayback';
import { XopcMusicTrack } from '../model/musicPlayback';
import { XopcMusicMiniPlayer } from './MusicPlaybackView';
import { XopcGeneratedMediaViewModel } from '../viewmodel/generatedMediaViewModel';
import { XopcGeneratedMediaCard } from '../model/generatedMedia';
import { generatedMediaByReply } from '../common/generatedMedia';
import { chatSpeechReplies } from '../common/chatAutoRead';
import { common } from '@kit.AbilityKit';
import { voiceCapture, XopcVoiceCapture } from '../service/voiceCapture';
import { appSettings } from '../service/settings';
import { pickChatAttachment } from '../service/chatAttachmentPicker';
import { XopcChatOptions } from './ChatOptions';
import { XopcChatOptionsViewModel } from '../viewmodel/chatOptionsViewModel';
import { XopcMobileRoute } from '../model/home';
import { XopcChatWelcome } from './ChatWelcome';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { XopcChatContext } from './ChatContext';
import { XopcChatContextViewModel } from '../viewmodel/chatContextViewModel';
import { MAX_ATTACHMENTS, validateAttachmentSize } from '../common/attachments';
import { copyChatMessage, saveChatMessage } from '../service/chatMessageActions';
import { XopcChatMenuTouch } from './ChatSelectableText';
import { shareSelectedChatText } from '../service/chatMediaShare';
import { pickChatPhoto } from '../service/chatPhotoPicker';
import { XopcChatPromptViewModel } from '../viewmodel/chatPromptViewModel';
import { XopcConnectionWaitViewModel } from '../viewmodel/connectionWaitViewModel';
import { XopcChatPrompt } from './ChatPrompt';
import { XopcChatConnectionWait } from './ChatConnectionWait';
import { chatReadAloud, XopcChatReadAloud } from '../service/chatReadAloud';
import { XopcChatDrafts } from '../service/chatDrafts';
import { gatewaySession } from '../service/gatewaySession';
import { XopcChatPaletteViewModel } from '../viewmodel/chatPaletteViewModel';
import { XopcPaletteItem } from '../common/composerTokens';
import { COMPOSER_INPUT_MIN, COMPOSER_INPUT_MAX, COMPOSER_TOOL_SIZE,
  composerExpanded, composerHasPayload } from '../common/composerLayout';
import { XopcChatDraft } from '../service/chatDrafts';
import { shareIntake } from '../service/shareIntake';
import { voiceCall, XopcVoiceCall } from '../service/voiceCall';
import { resolveVoiceRecordingDestination, XopcVoiceRecordingDestination } from '../common/voiceRecordingGesture';
import { seedChatMediaCache } from '../service/chatMedia';
import { advanceAssistantAudio, latestAssistantAudio, XopcAssistantAudioState } from '../common/assistantAudioAutoplay';
import { assistantAudioAutoplay } from '../service/assistantAudioAutoplay';
import { editChatImageAttachment } from '../service/chatImageEditing';
import { chatMessageNeedsPreview, latestChatMessageId } from '../common/chatMessagePreview';
import { CHAT_MESSAGE_MAX_WIDTH, chatPlainAssistantBubbleText, chatTextBubbleWidth } from '../common/chatBubbleLayout';
import { CHAT_MESSAGE_TAP_SLOP_VP, CHAT_SIDEBAR_PAN_DISTANCE_VP, CHAT_SIDEBAR_PAN_TAG,
  canStartChatSidebarPan } from '../common/chatSidebarGesture';
import { MARKDOWN_HORIZONTAL_SCROLL_ID_PREFIX } from '../common/markdownLayout';
import { chatPresentationRows } from '../common/chatPresentation';
import { XopcBrandLoading } from './MobileComponents';
import { XopcPersonalAgentRecord, XopcPersonalReadTarget, XopcPersonalUnreadSnapshot } from '../model/personalAgent';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { XopcPersonalChatActivity } from './PersonalChatActivity';
import { agentDisplayName, agentExternalRuntimeBadge } from '../common/agentPresentation';
import { chatContextStrip, chatModelSubtitle, shouldShowRuntimeBadge, XopcChatContextStrip } from '../common/chatHeaderPresentation';

interface XopcChatReadingAnchor { rowId: string; offset: number; }
const chatReadingAnchors: Map<string, XopcChatReadingAnchor> = new Map<string, XopcChatReadingAnchor>();
let readAloudOwnerSequence: number = 0;



interface XopcChatMessageMenuAction {
  id: string;
  label: Resource;
  symbol: Resource;
  enabled: boolean;
}

interface XopcGeneratedMediaReply {
  replyId: string;
}

@ComponentV2
export struct XopcChatView {
  @Local phone: XopcPhoneViewModel = new XopcPhoneViewModel();
  @Local phonePage: number = 0;
  @Local generatedMedia: XopcGeneratedMediaViewModel = new XopcGeneratedMediaViewModel();
  @Local generatedVideo?: XopcGeneratedMediaCard;
  @Local generatedVideoOpen: boolean = false;
  @Local pinPlayingMusic: boolean = false;
  @Local generatedMusic: XopcGeneratedMusicPlayback = generatedMusicPlayback;
  private locatedMusicRevision: number = 0;
  private generatedPlaybackScope: string = '';
  @Computed get generatedMediaGroups(): Map<string, XopcGeneratedMediaCard[]> {
    const cards = this.generatedMedia.cards;
    if (!cards.length) return new Map<string, XopcGeneratedMediaCard[]>();
    return generatedMediaByReply(cards, this.presentationRows, this.personalConversation);
  }
  @Computed get generatedMediaChinese(): boolean { return appSettings.effectiveLanguage().startsWith('zh'); }
  @Monitor('generatedMusic.sourceRevision', 'generatedMediaGroups', 'chat.selectedId', 'activePage')
  locateMusicSource(): void {
    const revision = this.generatedMusic.sourceRevision;
    const track = this.generatedMusic.track;
    if (!this.activePage || !track || this.chat.selectedId !== track.conversationId
      || revision === this.locatedMusicRevision) return;
    for (const row of this.generatedMediaGroups.keys()) {
      const cards = this.generatedMediaGroups.get(row);
      if (!cards?.some((card: XopcGeneratedMediaCard): boolean => card.item.id === track.id)) continue;
      const index = row ? this.presentationRows.findIndex((entry: XopcChatRow): boolean => entry.id === row)
        : this.presentationRows.length;
      if (index < 0) return;
      this.locatedMusicRevision = revision;
      this.pauseAutomaticScroll();
      this.messagesScroller.scrollToIndex(index + (this.chat.hasOlder ? 1 : 0), false, row ? ScrollAlign.START : ScrollAlign.END);
      return;
    }
  }
  @Computed get showMusicMiniPlayer(): boolean {
    const track = this.generatedMusic.track;
    return this.activePage && !!track && (track.conversationId !== this.chat.selectedId ||
      !this.generatedMedia.cards.some((card: XopcGeneratedMediaCard): boolean => card.item.id === track.id));
  }
  @Local colors: XopcThemeColors = appThemeColors;
  @Param requestedId: string = '';
  @Param taskId: string = '';
  @Event onTaskClose: () => void = (): void => {};
  @Param requestRevision: number = 0;
  @Param focusRevision: number = 0;
  @Param intakeRevision: number = 0;
  @Param intakeText: string = '';
  @Param activePage: boolean = true;
  @Param embedded: boolean = false;
  @Param automationSetup: boolean = false;
  @Param projectChat: boolean = false;
  @Event onProjectClose: () => void = (): void => {};
  @Param scopedProjectName: string = '';
  @Param personalAgent: XopcPersonalAgentRecord | null = null;
  @Local searchOpen: boolean = false;
  @Local searchQuery: string = '';
  @Local searchCategory: string = 'messages';
  private searchInput: TextInputController = new TextInputController();
  @Computed get chatTopInset(): number {
    return this.embedded ? 0 : this.getUIContext().px2vp(this.layout.systemTopInsetPx);
  }
  @Computed get personalConversation(): boolean {
    return this.personalAgent?.state === 'ready' && this.chat.selectedId === this.personalAgent.conversationId;
  }
  @Local floatingHeaderHeight: number = 0;
  @Local connectionBannerHeight: number = 0;
  @Computed get networkNotice(): string {
    if (this.hasConnectionIssue()) return '';
    if (this.chat.connection === 'connected') {
      return !this.chat.loading && (this.chat.cachedHistory || this.hasChatConnectionError) ? 'sync' : '';
    }
    if (!this.chat.connectionNotice) return '';
    if (this.chat.connection === 'network_offline') return 'offline';
    return this.chat.connectionNotice === 'retry' ? 'retry' : 'progress';
  }
  @Computed get hasChatConnectionError(): boolean {
    return !!this.chat.connectionError && this.chat.error === this.chat.connectionError;
  }
  @Computed get showConnectionBanner(): boolean {
    return this.hasConnectionIssue() || (!!this.chat.error && !this.hasChatConnectionError);
  }
  @Event onOpenSidebar: () => void = (): void => {};
  @Param sidebarSwipeWidth: number = 0;
  @Param sidebarSwipeEnabled: boolean = false;
  @Event onSidebarDragStart: (offsetX: number) => void = (_offsetX: number): void => {};
  @Event onSidebarDragUpdate: (offsetX: number) => void = (_offsetX: number): void => {};
  @Event onSidebarDragEnd: (offsetX: number, velocityX: number) => void = (_offsetX: number, _velocityX: number): void => {};
  @Event onSidebarDragCancel: () => void = (): void => {};
  @Event onNewOrdinaryChat: () => void = (): void => {};
  @Event onOpenPersonalAgent: () => void = (): void => {};
  @Event onLocalChatCreated: (id: string) => void = (_id: string): void => {};
  @Event onConversationUnavailable: (id: string) => void = (_id: string): void => {};
  @Computed get chatHeaderHeight(): number {
    if (this.taskId) return 72 + this.chatTopInset;
    return this.embedded ? 0 : this.floatingHeaderHeight;
  }
  @Computed get overlayHeaderHeight(): number {
    return this.showConnectionBanner ? 0 : this.chatHeaderHeight;
  }
  @Local stickyMusicHeight: number = 0;
  @Computed get messageHeaderClearance(): number {
    return this.pinPlayingMusic ? Math.max(this.overlayHeaderHeight, this.chatHeaderHeight) + 4 + this.stickyMusicHeight
      : this.overlayHeaderHeight;
  }
  @Event onConversationChange: (id: string) => void = (_id: string): void => {};
  @Param personalUnread: XopcPersonalUnreadSnapshot | null = null;
  @Event onPersonalReadTargetChange: (target?: XopcPersonalReadTarget) => void =
    (_target?: XopcPersonalReadTarget): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local chat: XopcChatViewModel = new XopcChatViewModel();
  @Local options: XopcChatOptionsViewModel = new XopcChatOptionsViewModel();
  @Local context: XopcChatContextViewModel = new XopcChatContextViewModel();
  @Local prompt: XopcChatPromptViewModel = new XopcChatPromptViewModel();
  @Local connectionWait: XopcConnectionWaitViewModel = new XopcConnectionWaitViewModel();
  @Local refs: XopcContextRef[] = [];
  @Local panelOpen: boolean = false;
  @Local sheetOpen: boolean = false;
  @Local sheetMode: string = 'actions';
  @Local referenceKind: string = 'note';
  @Local draft: string = '';
  @Local draftComposing: boolean = false;
  @Local editingTurnId: string = '';
  @Local showVoice: boolean = false;
  @Local voiceHeld: boolean = false;
  @Local voiceFinishing: boolean = false;
  @Local voiceRetryDestination: XopcVoiceRecordingDestination = 'send';
  @Local voiceDestination: XopcVoiceRecordingDestination = 'send';
  @Computed get expandedComposer(): boolean {
    return composerExpanded(this.draft, this.attachments.length, this.refs.length, !!this.palette.range);
  }
  @Computed get nextTurnEligible(): boolean {
    return this.activePage && this.layout.foreground && this.phonePage === 0 && !this.panelOpen && !this.sheetOpen
      && !this.restoringDraft && !this.chat.loading && !this.chat.cachedHistory && !this.chat.localDraft
      && this.chat.connection === 'connected' && !this.chat.sending && !this.chat.runId && !!this.chat.transcriptId
      && this.draft.length === 0 && !this.draftComposing && !this.attachments.length && !this.refs.length
      && !this.pickingAttachment && !this.showVoice && this.voice.state === 'idle'
      && !this.editingTurnId
      && !this.prompt.prompt && !this.connectionWait.snapshot?.wait;
  }
  @Computed get nextTurnLocale(): string { return appSettings.effectiveLanguage().startsWith('zh') ? 'zh' : 'en'; }
  @Computed get nextTurnPrompt(): string {
    const item = this.chat.nextTurnSuggestion;
    return this.nextTurnEligible && item && item.conversationId === this.chat.selectedId
      && item.transcriptId === this.chat.transcriptId && item.locale === this.nextTurnLocale ? item.prompt : '';
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
    if (this.sheetMode === 'actions') return 448;
    if (this.sheetMode === 'thinking') return Math.min(620, Math.max(280, 136 + (this.options.selectedModel()?.thinking?.options.length || 1) * 60));
    if (this.sheetMode === 'preparation') return 260;
    return 620;
  }
  @Local voice: XopcVoiceCapture = voiceCapture;
  @Local reader: XopcChatReadAloud = chatReadAloud;
  @Local readAloudMenuOpen: boolean = false;
  @Local composerError: string = '';
  private composerNotice: XopcTransientNotice = new XopcTransientNotice((message: string): void => { this.composerError = message; });
  @Local call: XopcVoiceCall = voiceCall;
  @Local attachments: XopcChatAttachment[] = [];
  @Local draftIntake: XopcChatDraftIntake = chatDraftIntake;
  @Local pickingAttachment: boolean = false;
  @Local imageEditorOpen: boolean = false;
  @Local imageEditorIndex: number = -1;
  @Local imageEditorRotation: number = 0;
  @Local imageEditorAspect: string = 'original';
  @Local imageEditorBusy: boolean = false;
  @Local imageEditorError: string = '';
  @Local messageDetailOpen: boolean = false;
  @Local messageDetailRow: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Local messageDetailContentReady: boolean = false;
  private messageDetailContentTimer: number = -1;
  @Local selectingMessageId: string = '';
  private pendingUserMenuAction: string = '';
  private pendingAssistantMenuAction: string = '';
  private assistantMenuTouch: XopcChatMenuTouch = { rowId: '', x: 0, y: 0 };
  @Local selectionOrigin: XopcChatMenuTouch = { rowId: '', x: 0, y: 0 };
  private assistantMenuActions(row: XopcChatRow): XopcChatMessageMenuAction[] {
    const actions: XopcChatMessageMenuAction[] = [];
    const answer = chatAnswerText(row);
    if (answer) {
      actions.push({ id: 'copy', label: $r('app.string.chat_copy'), symbol: $r('sys.symbol.doc_plaintext'), enabled: true });
      actions.push({ id: 'select', label: $r('app.string.chat_select_text'), symbol: $r('sys.symbol.doc_text'), enabled: true });
    }
    if (!this.chat.runId && !this.chat.sending) {
      actions.push({ id: 'regenerate', label: $r('app.string.chat_regenerate'), symbol: $r('sys.symbol.arrow_clockwise'), enabled: true });
    }
    if (answer) {
      if (!(row.media || []).some((file: XopcHistoryMedia): boolean => file.mimeType.startsWith('audio/'))) {
        actions.push({ id: 'read', label: this.reader.sourceId === row.id && this.reader.state === 'playing'
          ? $r('app.string.pause') : this.reader.sourceId === row.id && this.reader.state === 'paused'
          ? $r('app.string.resume') : $r('app.string.chat_read_aloud'), symbol: $r('sys.symbol.speaker_wave_2'),
          enabled: this.reader.state !== 'loading' });
      }
      actions.push({ id: 'share', label: $r('app.string.chat_share'), symbol: $r('sys.symbol.share'), enabled: true });
      actions.push({ id: 'save', label: $r('app.string.chat_save_note'), symbol: $r('sys.symbol.bookmark'), enabled: !this.savingNote });
    }
    actions.push({ id: 'detail', label: $r('app.string.chat_message_detail'), symbol: $r('sys.symbol.doc_text'), enabled: true });
    actions.push({ id: 'execution', label: $r('app.string.chat_steps'), symbol: $r('sys.symbol.list_bullet'), enabled: true });
    if (extractMarkdownCodeBlocks(answer)) actions.push({ id: 'copy-code', label: $r('app.string.chat_copy_code'), symbol: $r('sys.symbol.doc_plaintext'), enabled: true });
    return actions;
  }
  @Local executionOpen: boolean = false;
  @Local executionRow: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Local executionDetail: XopcExecutionDetail = { turnId: '', steps: [] };
  @Local executionLoading: boolean = false;
  @Local executionError: string = '';
  private executionRepository: XopcChatRepository = new XopcChatRepository();
  private executionSessionId: string = '';
  private executionTimer: number = -1;
  private executionRequest: number = 0;
  private executionSettledPolls: number = 0;
  @Computed get activeExecutionRow(): XopcChatRow {
    return this.presentationRows.find((row: XopcChatRow): boolean => row.id === this.executionRow.id
      || (!!row.turnId && row.turnId === this.executionRow.turnId)) || this.executionRow;
  }
  @Computed get latestMessageId(): string {
    return latestChatMessageId(this.presentationRows);
  }
  @Computed get presentationRows(): XopcChatRow[] {
    return chatPresentationRows(this.chat.rows, this.chat.liveRow || this.chat.liveActivityRow, this.chat.runId);
  }
  private reactionFor(row: XopcChatRow): XopcAgentReaction | undefined {
    if (!this.personalConversation || !this.chat.reactionsAllowed
      || (this.chat.reactionsAvailable ?? this.personalAgent?.messageReactionsAvailable) !== true) return undefined;
    const live = this.chat.liveReaction;
    if (live && live.transcriptId === this.chat.transcriptId &&
      (live.clientMessageId === row.id || live.entryId === row.transcriptEntryId)) return live;
    return row.agentReaction;
  }
  private reactionDuration(row: XopcChatRow): number {
    const reaction = this.reactionFor(row);
    return reaction && this.chat.animatedReactionEntry === reaction.entryId && this.chat.runId === reaction.runId
      && Date.now() - reaction.createdAtMs < 1500 && this.atBottom && this.activePage && this.layout.foreground
      && !this.layout.reduceMotion ? 260 : 0;
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
  private jumpingToBottom: boolean = false;
  @Local bottomRegionHeight: number = 0;
  private messageViewportHeight: number = 0;
  @Local savingNote: boolean = false;
  @Local restoringDraft: boolean = false;
  @Local palette: XopcChatPaletteViewModel = new XopcChatPaletteViewModel();
  @Local layout: XopcLayoutState = layoutState;
  private cursor: number = 0;
  private drafts: XopcChatDrafts = new XopcChatDrafts();
  private draftScope: string = '';
  private intakeReceipts: string[] = [];
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
  private renderKeys: XopcChatRenderKeys = new XopcChatRenderKeys();
  private messagesScroller: Scroller = new Scroller();
  private scrollTimer: number = -1;
  private messageScrollFromUser: boolean = false;
  private firstVisible: number = 0;
  @Local loadingOlder: boolean = false;
  @Local olderFailed: boolean = false;
  private initialScrollPending: boolean = true;
  private initialScrollAttempts: number = 0;
  private olderGeneration: number = 0;
  private readAloudOwner: number = ++readAloudOwnerSequence;
  private assistantAudioState?: XopcAssistantAudioState;

  @Computed get continuousReadSelected(): boolean {
    return this.reader.owner === this.readAloudOwner && this.reader.continuousEnabled;
  }

  private canToggleContinuousRead(): boolean {
    return this.activePage && !this.disposed && !this.chat.loading && !!this.chat.selectedId &&
      (this.continuousReadSelected || (!this.chat.cachedHistory && (this.chat.localDraft || !!this.chat.transcriptId)));
  }

  @Monitor('chat.rows', 'chat.runId', 'chat.selectedId', 'chat.transcriptId', 'chat.loading', 'chat.cachedHistory',
    'activePage', 'voice.state', 'call.phase', 'generatedMusic.player.state', 'generatedMusic.loading', 'generatedVideoOpen')
  onAutoReadChange(): void {
    if (!this.activePage || this.disposed || this.chat.loading || !this.chat.selectedId) {
      this.reader.leaveForeground(this.readAloudOwner);
      return;
    }
    const playbackAllowed = !this.chat.cachedHistory && this.voice.state === 'idle' && this.call.phase === 'idle'
      && !this.generatedMusic.loading && this.generatedMusic.player.state !== 'playing' && !this.generatedVideoOpen;
    const context = this.getUIContext().getHostContext();
    const profile = gatewaySession.currentProfile();
    if (context && profile) {
      this.reader.showConversation(this.readAloudOwner, context, JSON.stringify([profile.gatewayId, profile.deviceId]),
        this.chat.selectedId, this.chat.transcriptId ?? '', chatSpeechReplies(this.chat.rows, this.chat.runId),
        appSettings.effectiveLanguage(), playbackAllowed, this.chat.rows);
    }
  }

  @Monitor('chat.rows', 'chat.runId', 'chat.selectedId', 'chat.loading', 'activePage', 'voice.state', 'call.phase', 'reader.state', 'generatedMusic.track', 'generatedMusic.player.state', 'generatedMusic.loading', 'generatedVideoOpen')
  onAssistantAudioChange(): void {
    const enabled = this.activePage && !this.disposed && !this.chat.loading && !!this.chat.selectedId
      && this.voice.state === 'idle' && this.call.phase === 'idle'
      && this.reader.state === 'idle'
      && !this.generatedMusic.loading && this.generatedMusic.player.state !== 'playing' && !this.generatedVideoOpen;
    const next = advanceAssistantAudio(this.assistantAudioState, this.chat.selectedId, enabled, !!this.chat.runId,
      latestAssistantAudio(this.chat.rows, this.chat.selectedId));
    this.assistantAudioState = next.state;
    if (!enabled) { assistantAudioAutoplay.interrupt(); return; }
    const context = this.getUIContext().getHostContext();
    if (next.candidate && context) assistantAudioAutoplay.enqueue(context, next.candidate);
  }

  @Local skillLabels: Map<string, string> = new Map<string, string>();
  @Computed get draftPresentation(): XopcCapabilityText { return capabilityText(this.draft, this.skillLabels, true); }
  private draftChange?: TextChangeOptions;

  private appliedRequestRevision: number = -1;
  private appliedIntakeRevision: number = -1;

  private applyPalette(item: XopcPaletteItem): void {
    const range = this.palette.range; if (!range || this.restoringDraft) return;
    if (item.kind === 'note') {
      if (!item.sourceId || !item.version) return;
      if (!this.refs.some((ref: XopcContextRef): boolean => ref.kind === 'note' && ref.sourceId === item.sourceId)) {
        if (this.refs.length >= 5) { xopcToast(this.getUIContext(), $r('app.string.chat_ref_limit')); return; }
        this.refs = this.refs.concat([{ kind: 'note', sourceId: item.sourceId, expectedVersion: item.version, title: item.name }]);
      }
    }
    if (item.kind === 'skill') this.skillLabels.set(item.id.slice('skill:'.length), item.name);
    this.draft = this.draft.slice(0, range.start) + item.token + this.draft.slice(range.end);
    this.cursor = range.start + item.token.length; this.palette.close(); this.editor.caretPosition(capabilityDisplayOffset(this.draftPresentation, this.cursor));
  }

  private saveDraft(): void {
    if (this.restoringDraft || !this.draftScope) return;
    this.drafts.save(this.draftScope, { text: this.draft, refs: this.refs, files: this.attachments, intakeReceipts: this.intakeReceipts })
      .catch((_error: Error): void => { if (this.visible) this.chat.error = 'DRAFT_SAVE_FAILED'; });
  }
  @Monitor('nextTurnEligible', 'nextTurnLocale', 'chat.selectedId', 'chat.transcriptId', 'chat.agentId',
    'chat.suggestionRevision', 'options.modelId')
  onNextTurnTarget(): void { this.chat.observeNextTurnSuggestion(this.nextTurnEligible ? this.nextTurnLocale : ''); }

  private fillNextTurnSuggestion(): void {
    const item = this.chat.nextTurnSuggestion;
    if (!this.nextTurnPrompt || !item) return;
    const text = this.chat.acceptNextTurnSuggestion(item.id);
    if (!text) return;
    this.draft = text;
    this.cursor = text.length;
    this.editor.caretPosition(capabilityDisplayOffset(this.draftPresentation, this.cursor));
  }

  @Monitor('draft', 'refs', 'attachments')
  onDraftChange(): void {
    this.voice.dismissError(); this.reader.dismissError(); this.composerNotice.clear();
    clearTimeout(this.draftTimer);
    if (!this.disposed && !this.restoringDraft) this.draftTimer = setTimeout((): void => { this.saveDraft(); }, 300);
  }
  @Computed get selectedConversationId(): string { return this.chat.selectedId; }
  @Monitor('selectedConversationId')
  onDraftTargetChange(): void { void this.restoreDraft(); }

  private async restoreDraft(): Promise<void> {
    const profile = gatewaySession.currentProfile();
    const scope = JSON.stringify([profile?.gatewayId || '', profile?.deviceId || '', this.chat.selectedId]);
    if (!this.chat.selectedId || scope === this.draftScope) return;
    clearTimeout(this.draftTimer); this.saveDraft();
    this.resetMessagePosition(); this.palette.close();
    this.olderGeneration++; this.loadingOlder = false; this.olderFailed = false; this.firstVisible = 0;
    const generation = ++this.draftGeneration;
    this.restoringDraft = true; this.draftScope = scope; this.intakeReceipts = []; this.draftComposing = false; this.draft = ''; this.refs = []; this.attachments = [];
    this.editingTurnId = '';
    try {
      const saved = await this.drafts.read(scope);
      if (generation !== this.draftGeneration) return;
      if (saved) { this.draft = saved.text; this.refs = saved.refs; this.attachments = saved.files; this.intakeReceipts = saved.intakeReceipts ?? []; }
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

  @Monitor('chat.rows', 'chat.liveRow', 'chat.liveActivityRow', 'chat.streaming', 'chat.thinking', 'chat.tool', 'chat.loading', 'generatedMediaGroups', 'activePage')
  onMessageChange(): void {
    this.renderKeys.update(this.chat.selectedId, this.chat.rows, this.chat.liveRow);
    this.updateJumpButton();
    if (!this.visible || !this.activePage || (!this.atBottom && !this.initialScrollPending)
      || this.loadingOlder || (this.chat.loading && !this.chat.cachedHistory)) return;
    if (this.scrollTimer !== -1) return;
    const conversationId = this.chat.selectedId;
    this.scrollTimer = setTimeout((): void => {
      this.scrollTimer = -1;
      if (this.visible && this.activePage && conversationId === this.chat.selectedId && !this.loadingOlder && !this.messageScrollFromUser) {
        if (this.initialScrollPending) {
          const saved = chatReadingAnchors.get(this.readingScope());
          const index = saved ? this.messageIndex(saved.rowId) : -1;
          if (saved && index >= 0) {
            this.initialScrollPending = false;
            this.atBottom = false;
            this.messagesScroller.scrollToIndex(index, false, ScrollAlign.START, { extraOffset: LengthMetrics.vp(-saved.offset) });
            return;
          }
          // Virtual rows above the viewport need an explicit index before edge alignment is reliable.
          const last = this.presentationRows.length + (this.chat.hasOlder ? 1 : 0);
          this.messagesScroller.scrollToIndex(last, false, ScrollAlign.END);
          this.initialScrollAttempts++;
          this.initialScrollPending = !this.messagesScroller.isAtEnd() && this.initialScrollAttempts < 4;
          if (this.initialScrollPending) this.onMessageChange();
        } else if (this.atBottom) this.messagesScroller.scrollEdge(Edge.Bottom);
      }
    }, 16);
  }
  private messageIndex(id: string): number {
    const index = this.presentationRows.findIndex((row: XopcChatRow): boolean => row.id === id || row.sourceIds?.includes(id) === true);
    return index < 0 ? index : index + (this.chat.hasOlder ? 1 : 0);
  }
  private readingScope(): string {
    return this.chat.transcriptId ? JSON.stringify([this.draftScope, this.chat.transcriptId]) : '';
  }
  private saveReadingPosition(): void {
    const scope = this.readingScope();
    if (!scope) return;
    if (this.atBottom) { chatReadingAnchors.delete(scope); return; }
    const header = this.chat.hasOlder ? 1 : 0;
    const index = Math.max(this.firstVisible, header);
    const row = this.presentationRows[index - header];
    if (!row) return;
    const y = this.messagesScroller.getItemRect(index).y;
    chatReadingAnchors.delete(scope);
    chatReadingAnchors.set(scope, { rowId: row.id, offset: y - this.messageHeaderClearance });
    if (chatReadingAnchors.size > 50) {
      for (const oldest of chatReadingAnchors.keys()) { chatReadingAnchors.delete(oldest); break; }
    }
  }
  private isLatestVisible(): boolean {
    if (this.messagesScroller.isAtEnd()) return true;
    const footer = this.messagesScroller.getItemRect(this.presentationRows.length + (this.chat.hasOlder ? 1 : 0));
    return footer.height > 0 && footer.y + footer.height <= this.messageViewportHeight + 24;
  }
  private updateJumpButton(): void {
    if (!this.visible || !this.messageViewportHeight || this.initialScrollPending) return;
    this.showJumpBottom = !this.atBottom && !this.isLatestVisible();
  }
  private pauseAutomaticScroll(): void {
    this.atBottom = false;
    this.initialScrollPending = false;
    clearTimeout(this.scrollTimer);
    this.scrollTimer = -1;
  }
  private resetMessagePosition(): void {
    clearTimeout(this.scrollTimer); this.scrollTimer = -1; this.messageScrollFromUser = false;
    this.jumpingToBottom = false;
    this.initialScrollPending = true; this.initialScrollAttempts = 0;
    this.atBottom = true; this.showJumpBottom = false;
    // A pending prepend may still update rows, but must not restore an obsolete reading anchor.
    this.olderGeneration++; this.loadingOlder = false; this.olderFailed = false;
  }
  @Monitor('bottomRegionHeight', 'messageHeaderClearance')
  onMessageLayoutChange(): void {
    this.updateJumpButton();
    if (!this.visible || !this.atBottom || this.loadingOlder || this.chat.loading) return;
    if (this.initialScrollPending) { this.onMessageChange(); return; }
    clearTimeout(this.scrollTimer);
    const conversationId = this.chat.selectedId;
    this.scrollTimer = setTimeout((): void => {
      this.scrollTimer = -1;
      if (!this.visible || !this.atBottom || this.loadingOlder || conversationId !== this.chat.selectedId) return;
      if (this.messagesScroller.isAtEnd()) return;
      const last = this.presentationRows.length + (this.chat.hasOlder ? 1 : 0);
      // Keyboard avoidance already animates the viewport; do not launch a competing scroll animation.
      this.messagesScroller.scrollToIndex(last, false, ScrollAlign.END);
    }, 0);
  }
  private onMessageViewportChange(previous: Area, current: Area): void {
    this.messageViewportHeight = Number(current.height);
    // Keyboard resize changes the viewport without changing any message rows.
    if (Number(previous.height) !== Number(current.height) || Number(previous.width) !== Number(current.width)) {
      this.onMessageLayoutChange();
    }
  }
  private followAfterSend(): void {
    this.resetMessagePosition();
    this.saveReadingPosition();
    this.onMessageChange();
  }
  private onMessageRowLayoutChange(rowId: string, previous: Area, current: Area): void {
    if (Number(previous.height) !== Number(current.height) &&
      rowId === this.presentationRows[this.presentationRows.length - 1]?.id) this.onMessageChange();
  }
  private onMessageScrollSource(source: ScrollSource): void {
    this.messageScrollFromUser = source === ScrollSource.DRAG || source === ScrollSource.FLING
      || source === ScrollSource.OTHER_USER_INPUT || source === ScrollSource.SCROLL_BAR || source === ScrollSource.SCROLL_BAR_FLING;
  }
  private onMessageScroll(offset: number, state: ScrollState): void {
    if (this.messageScrollFromUser) this.jumpingToBottom = false;
    if (this.messageScrollFromUser && offset !== 0) {
      this.pauseAutomaticScroll();
    }
    if (!this.messageScrollFromUser
      || this.loadingOlder || (this.chat.loading && !this.chat.cachedHistory) || state === ScrollState.Idle) return;
    this.atBottom = offset > 0 && this.isLatestVisible();
    this.updateJumpButton();
    if (offset < 0 && this.messagesScroller.currentOffset().yOffset < 960 && !this.olderFailed) this.loadOlder();
  }
  private async loadOlder(): Promise<void> {
    if (this.loadingOlder || !this.chat.hasOlder || this.chat.loading || this.initialScrollPending) return;
    this.pauseAutomaticScroll();
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
      try { anchorOffset = this.messagesScroller.getItemRect(anchorIndex).y - this.messageHeaderClearance; } catch (_) {}
    });
    if (!this.visible || generation !== this.olderGeneration || conversationId !== this.chat.selectedId) return;
    this.olderFailed = previousRows === this.chat.rows && !!this.chat.error;
    if (anchor && this.visible) {
      const index = this.presentationRows.findIndex((row: XopcChatRow): boolean => row.id === anchor || (!!anchor && !!row.sourceIds?.includes(anchor)));
      setTimeout((): void => {
        if (generation !== this.olderGeneration) return;
        if (this.visible && conversationId === this.chat.selectedId && index >= 0) {
          this.messagesScroller.scrollToIndex(index + (this.chat.hasOlder ? 1 : 0), false, ScrollAlign.START,
            { extraOffset: LengthMetrics.vp(-anchorOffset) });
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
    const conversationId = this.chat.selectedId;
    const generation = this.draftGeneration;
    this.composerNotice.clear();
    try {
      if (action === 'copy') {
        await copyChatMessage(row.role === 'assistant' ? chatAnswerText(row) : capabilityText(row.text, this.skillLabels).text); xopcToast(this.getUIContext(), $r('app.string.chat_copied'));
      } else if (action === 'copy-code') {
        await copyChatMessage(extractMarkdownCodeBlocks(chatAnswerText(row))); xopcToast(this.getUIContext(), $r('app.string.chat_copied'));
      } else if (action === 'edit') { this.fillMessageDraft(row); }
      else if (action === 'read') {
        if (this.reader.sourceId === row.id && this.reader.state === 'loading') return;
        if (this.reader.sourceId === row.id && ['playing', 'paused'].includes(this.reader.state)) await this.reader.toggle();
        else {
          const reply = chatSpeechReplies([row], this.chat.runId)[0];
          if (reply) {
            await this.voice.cancel();
            if (!this.visible || this.disposed || conversationId !== this.chat.selectedId || generation !== this.draftGeneration) return;
            this.generatedVideoOpen = false;
            await this.generatedMusic.pause();
            if (!this.visible || this.disposed || conversationId !== this.chat.selectedId || generation !== this.draftGeneration) return;
            this.onAutoReadChange();
            await this.reader.readFrom(this.readAloudOwner, reply);
          }
        }
      }
      else if (action === 'save' && !this.savingNote) {
        this.savingNote = true; await saveChatMessage(chatAnswerText(row));
        xopcToast(this.getUIContext(), $r('app.string.chat_saved_note'));
      } else if (action === 'regenerate' && !this.chat.runId) {
        let index = this.chat.rows.findIndex((item: XopcChatRow): boolean => item.id === row.id) - 1;
        while (index >= 0 && this.chat.rows[index].role !== 'user') index--;
        if (index >= 0) {
          const source = this.chat.rows[index];
          const files: XopcChatAttachment[] = (source.media || []).map((file): XopcChatAttachment => ({ type: file.type, name: file.name, mimeType: file.mimeType, size: file.size, data: '', uri: file.uri }));
          await this.chat.send(source.text, files, source.refs || []); this.options.refreshPreparation();
        }
      }
    } catch (error) {
      if (this.visible && !this.disposed && conversationId === this.chat.selectedId && generation === this.draftGeneration) {
        this.composerNotice.show((error as Error).message);
      }
    }
    finally { this.savingNote = false; }
  }

  private fillMessageDraft(row: XopcChatRow): void {
    this.editingTurnId = !this.chat.runId && this.isLatestUser(row) ? row.turnId || '' : '';
    this.draft = row.text;
    this.attachments = (row.media || []).map((file: XopcHistoryMedia): XopcChatAttachment => ({
      type: file.type, name: file.name, mimeType: file.mimeType, size: file.size, data: file.data || '', uri: file.uri,
      workspaceRelativePath: file.workspaceRelativePath, duration: file.duration
    }));
    this.refs = (row.refs || []).slice();
    this.showVoice = false; this.setPanel(false); this.cursor = this.draft.length;
    this.editor.stopEditing();
    this.getUIContext().getFocusController().clearFocus();
    this.composerFocusAttempts = 0;
    this.focusComposerOnMount = true; this.focusMountedComposer(); this.saveDraft();
  }

  private isLatestUser(row: XopcChatRow): boolean {
    for (let index = this.presentationRows.length - 1; index >= 0; index--) {
      if (this.presentationRows[index].role === 'user') return this.presentationRows[index].id === row.id;
    }
    return false;
  }

  private cancelEditing(): void {
    this.editingTurnId = ''; this.draft = ''; this.attachments = []; this.refs = [];
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

  private userBubbleWidth(row: XopcChatRow): string {
    if (this.userVoiceOnly(row)) return '132vp';
    const displayText = capabilityText(row.text, this.skillLabels).text;
    const payloadCount = (row.media?.length || 0) + (row.refs?.length || 0);
    if (this.userVoiceMessage(row)) return chatTextBubbleWidth(displayText, 180);
    if (payloadCount > 1) return chatTextBubbleWidth(displayText, 264);
    if (row.media?.length === 1 && row.media[0].mimeType.startsWith('image/')) return chatTextBubbleWidth(displayText, 148);
    if (payloadCount === 1) return chatTextBubbleWidth(displayText, 220);
    return chatTextBubbleWidth(displayText, 44);
  }

  private assistantBubbleWidth(row: XopcChatRow): string {
    const text = chatPlainAssistantBubbleText(row);
    if (!text) return '100%';
    const context = this.getUIContext();
    const measured = context.getMeasureUtils().measureText({ textContent: text, fontSize: 16 });
    return Math.max(44, Math.ceil(context.px2vp(measured)) + 30) + 'vp';
  }

  private openMessageDetail(row: XopcChatRow): void {
    if (this.messageDetailContentTimer !== -1) clearTimeout(this.messageDetailContentTimer);
    this.messageDetailContentReady = false;
    this.messageDetailRow = row;
    this.messageDetailOpen = true;
  }

  private openExecutionDetail(row: XopcChatRow): void {
    this.closeExecutionDetail();
    this.executionRow = row;
    this.executionSessionId = this.chat.selectedId;
    this.executionSettledPolls = 0;
    this.executionDetail = { turnId: row.turnId || row.id, steps: [] };
    this.executionError = '';
    this.executionOpen = true;
    this.refreshExecutionDetail();
    this.executionTimer = setInterval((): void => {
      if (!this.executionOpen || this.executionSessionId !== this.chat.selectedId) {
        this.closeExecutionDetail(); return;
      }
      this.refreshExecutionDetail();
      if (!this.activeExecutionRow.live && ++this.executionSettledPolls >= 3) {
        clearInterval(this.executionTimer); this.executionTimer = -1;
      }
    }, 3000);
  }

  private async refreshExecutionDetail(): Promise<void> {
    if (!this.executionOpen || this.executionLoading) return;
    const request = ++this.executionRequest;
    const sessionId = this.executionSessionId;
    const turnId = this.executionDetail.turnId;
    this.executionLoading = true;
    try {
      const detail = await this.executionRepository.executionDetail(sessionId, turnId);
      if (this.executionOpen && request === this.executionRequest && this.executionSessionId === sessionId) {
        this.executionDetail = detail; this.executionError = '';
      }
    } catch (_) {
      if (this.executionOpen && request === this.executionRequest && this.executionSessionId === sessionId) {
        this.executionError = this.activeExecutionRow.live ? '' : 'UNAVAILABLE';
      }
    } finally {
      if (request === this.executionRequest) this.executionLoading = false;
    }
  }

  private closeExecutionDetail(): void {
    this.executionOpen = false;
    this.executionRequest++;
    this.executionLoading = false;
    if (this.executionTimer !== -1) { clearInterval(this.executionTimer); this.executionTimer = -1; }
  }

  private navigateChatRoute(route: XopcMobileRoute): void {
    if (route.page === 'tasks' && route.itemId) this.onNavigate({ page: 'task-chat', itemId: route.itemId });
    else this.onNavigate(route);
  }

  private navigateFromMessageDetail(route: XopcMobileRoute): void {
    this.messageDetailOpen = false;
    this.navigateChatRoute(route);
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
    shareIntake.liveDraftScope = (): string => this.restoringDraft || this.disposed ? '' : this.draftScope;
    shareIntake.readLiveDraft = (): XopcChatDraft => ({ text: this.draft, files: this.attachments, refs: this.refs, intakeReceipts: this.intakeReceipts });
    shareIntake.applyLiveDraft = (draft: XopcChatDraft): void => {
      this.draft = draft.text; this.attachments = draft.files; this.intakeReceipts = draft.intakeReceipts ?? []; this.cursor = this.draft.length;
    };
    this.visible = this.activePage;
    if (this.visible) { this.bindBack(); }
    this.appliedRequestRevision = this.requestRevision;
    this.chat.taskId = this.taskId;
    this.chat.start(this.requestedId, this.onConversationUnavailable);
  }
  private bindBack(): void { layoutState.dismissChatOverlay = (): boolean => { return this.dismissOverlay(); }; }
  private dismissOverlay(): boolean {
    if (this.selectingMessageId) { this.selectingMessageId = ''; return true; }
    if (this.phonePage === 1) { this.phonePage = 0; return true; }
    if (this.searchOpen) { this.closeMessageSearch(); return true; }
    if (this.panelOpen) { this.setPanel(false); return true; }
    return false;
  }
  private setPanel(open: boolean): void {
    if (this.panelOpen === open) return;
    if (open) {
      this.palette.close();
      this.editor.stopEditing();
      this.getUIContext().getFocusController().clearFocus();
    }
    xopcWithMotion(this.getUIContext(), open ? CHAT_ACTION_PANEL_OPEN_MS : CHAT_ACTION_PANEL_CLOSE_MS,
      open ? Curve.EaseOut : Curve.EaseInOut, (): void => {
      this.panelOpen = open;
    }, undefined, !this.visible || this.layout.reduceMotion);
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
  @Local desktopChatTarget?: XopcDesktopChatTarget;
  @Local desktopReselecting: boolean = false;
  private desktopTargetTimer: number = -1;
  private desktopTargetEpoch: number = 0;

  private observeDesktopTarget(): void {
    clearTimeout(this.desktopTargetTimer);
    this.desktopChatTarget = undefined;
    const epoch = ++this.desktopTargetEpoch;
    if (this.activePage && this.chat.selectedId && !this.embedded && !this.taskId) {
      void this.refreshDesktopTarget(this.chat.selectedId, epoch);
    }
  }

  private async refreshDesktopTarget(id: string, epoch: number): Promise<void> {
    try {
      const target = await loadDesktopChatTarget(id);
      if (epoch !== this.desktopTargetEpoch || !this.activePage) return;
      this.desktopChatTarget = target;
      if (target) this.desktopTargetTimer = setTimeout((): void => { void this.refreshDesktopTarget(id, epoch); }, 5000);
    } catch (_error) {}
  }

  private async selectDesktopAgain(): Promise<void> {
    const endpoint = this.desktopChatTarget?.reselectEndpointId;
    if (!endpoint || this.desktopReselecting) return;
    const id = this.chat.selectedId;
    const epoch = this.desktopTargetEpoch;
    this.desktopReselecting = true;
    try { await reselectDesktopChatTarget(id, endpoint); }
    catch (_error) {}
    finally {
      this.desktopReselecting = false;
      if (epoch === this.desktopTargetEpoch) this.observeDesktopTarget();
    }
  }

  private desktopTargetLabel(): Resource {
    const target = this.desktopChatTarget;
    const name = target?.deviceName ?? '';
    if (target?.deviceState === 'reselect') return $r('app.string.device_execution_reselect', name);
    if (target?.deviceState === 'offline') return $r('app.string.device_execution_offline', name);
    if (target?.deviceState === 'authorization_required') return $r('app.string.device_execution_authorization', name);
    return $r('app.string.device_execution_target', name);
  }

  @Monitor('selectedConversationId', 'activePage')
  onSelectedConversation(): void {
    this.observeDesktopTarget();
    if (this.activePage && this.chat.selectedId) this.onConversationChange(this.chat.selectedId);
  }

  @Monitor('personalConversation', 'chat.transcriptId', 'chat.loading', 'chat.cachedHistory', 'chat.error',
    'chat.historyLastSeq', 'activePage', 'searchOpen', 'phonePage')
  onPersonalReadViewChange(): void {
    this.onPersonalReadTargetChange(this.personalReadTarget());
  }

  private personalReadTarget(): XopcPersonalReadTarget | undefined {
    if (!this.activePage || !this.personalConversation || this.chat.loading || this.chat.cachedHistory ||
      !!this.chat.error || this.phonePage !== 0 || this.searchOpen || !this.chat.transcriptId) return undefined;
    return { conversationId: this.chat.selectedId, transcriptId: this.chat.transcriptId, lastSeq: this.chat.historyLastSeq };
  }

  @Monitor('personalUnread')
  onPersonalUnreadSnapshot(): void {
    const unread = this.personalUnread;
    const target = this.personalReadTarget();
    if (unread && unread.unreadCount > 0 && target?.conversationId === unread.conversationId &&
      (target.transcriptId !== unread.transcriptId || target.lastSeq < unread.lastSeq)) {
      void this.chat.loadHistory(false);
    }
  }
  @Monitor('chat.selectedId', 'chat.transcriptId', 'chat.runId', 'chat.cachedHistory', 'chat.musicJobsRevision',
    'activePage', 'layout.foreground', 'phonePage')
  onGeneratedMediaScopeChange(): void {
    const id = this.chat.selectedId;
    const profile = gatewaySession.currentProfile();
    const scope = profile?.gatewayId && profile.deviceId && id && this.chat.transcriptId
      ? JSON.stringify([profile.gatewayId, profile.deviceId, id, this.chat.transcriptId]) : '';
    if (!this.activePage || !this.layout.foreground || this.phonePage !== 0 || this.generatedPlaybackScope !== scope) {
      this.generatedVideoOpen = false;
    }
    this.generatedPlaybackScope = scope;
    this.generatedMedia.observe(id, scope, this.chat.transcriptId ?? '', this.activePage && this.phonePage === 0
      && this.layout.foreground && !this.chat.cachedHistory, !!this.chat.runId);
  }
  @Monitor('chat.loading', 'chat.agentId')
  onHistoryReady(): void {
    if (this.visible && !this.chat.loading && this.chat.selectedId) void this.connectionWait.refresh();
    const id = this.chat.selectedId + ':' + this.chat.agentId;
    if (this.visible && !this.chat.loading && this.chat.selectedId && this.optionsId !== id) {
      this.optionsId = id; this.options.load(this.chat.selectedId, this.chat.agentId, appSettings.effectiveLanguage());
      this.context.load(this.chat.selectedId); this.prompt.start(this.chat.selectedId);
    }
  }
  @Monitor('chat.auxiliaryRevision')
  onAuxiliaryState(): void { if (this.visible) { this.options.refreshPreparation(); this.prompt.refresh(); void this.connectionWait.refresh(); } }
  @Monitor('chat.selectedId')
  onConnectionWaitTarget(): void {
    this.readAloudMenuOpen = false;
    this.selectingMessageId = '';
    this.voice.dismissError(); this.composerNotice.clear();
    this.connectionWait.start(this.chat.selectedId);
    if (!this.visible || !this.layout.foreground) this.connectionWait.pause();
  }
  @Monitor('chat.runId', 'chat.connection')
  onConnectionWaitRun(): void { if (this.visible && !this.chat.loading) void this.connectionWait.refresh(); }
  @Monitor('layout.foreground')
  onConnectionWaitForeground(): void {
    if (this.layout.foreground && this.activePage) { this.chat.resume(); this.connectionWait.onReturn(); }
    else { this.chat.pause(); this.connectionWait.pause(); }
  }
  @Monitor('activePage')
  onActivityChange(): void {
    if (!this.activePage) { this.composerNotice.clear(); this.selectingMessageId = ''; }
    this.visible = this.activePage;
    if (!this.activePage) { clearTimeout(this.scrollTimer); this.scrollTimer = -1; }
    if (!this.activePage) { clearTimeout(this.composerFocusTimer); this.focusComposerOnMount = false; this.saveDraft(); this.palette.close(); this.voiceHeld = false; this.voiceDestination = 'send'; this.voice.cancel(); this.setPanel(false); this.sheetOpen = false; this.options.pause(); this.prompt.pause(); this.connectionWait.pause(); this.chat.deactivate(); }
    else { this.bindBack(); this.chat.activate(); this.onHistoryReady(); this.onMessageChange(); this.options.resume(); this.prompt.resume(); if (this.layout.foreground) this.connectionWait.onReturn(); }
  }
  @Monitor('requestRevision', 'chat.sending')
  onTargetChange(): void {
    if (this.disposed || !this.requestedId || this.appliedRequestRevision === this.requestRevision || this.chat.sending) return;
    this.appliedRequestRevision = this.requestRevision;
    if (this.requestedId === this.chat.selectedId) return;
    this.chat.taskId = this.taskId;
    this.dismissComposer(); this.sheetOpen = false;
    this.resetMessagePosition();
    this.saveDraft(); this.voiceHeld = false; this.voiceDestination = 'send'; this.voice.cancel(); this.reader.leaveForeground(this.readAloudOwner); this.showVoice = false;
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
  aboutToDisappear(): void { clearTimeout(this.desktopTargetTimer); this.desktopTargetEpoch++; this.generatedMedia.stop(); this.composerNotice.clear(); this.phone.dispose(); this.closeExecutionDetail(); this.visible = false; this.disposed = true; clearTimeout(this.composerFocusTimer); clearTimeout(this.intakeTimer); clearTimeout(this.scrollTimer); this.scrollTimer = -1; clearTimeout(this.draftTimer); this.saveDraft(); this.draftGeneration++; this.palette.dispose(); this.setPanel(false); this.prompt.dispose(); this.connectionWait.dispose(); this.context.dispose(); this.options.dispose(); this.chat.dispose(); this.voiceHeld = false; this.voiceDestination = 'send'; this.voice.cancel(); this.reader.leaveForeground(this.readAloudOwner); this.attachments = []; }

  private async switchAgent(agentId: string): Promise<void> {
    if (this.chat.loading || this.chat.sending || this.restoringDraft) return;
    this.sheetOpen = false;
    this.dismissComposer();
    await this.chat.create(agentId, this.chat.projectId || null, undefined, this.onLocalChatCreated);
  }

  private async newConversation(agentId: string = this.options.agentId, projectId: string | null = this.chat.projectId || null, executionMode?: string): Promise<void> {
    if (this.automationSetup || this.chat.loading || this.chat.sending || this.restoringDraft) return;
    if (this.draft.trim() || this.attachments.length || this.refs.length) {
      const confirmed = await xopcConfirmDialog(this.getUIContext(), {
        message: $r('app.string.discard_changes'),
        destructive: true,
      });
      if (!confirmed) return;
    }
    this.voiceHeld = false; this.voiceDestination = 'send'; this.voice.cancel(); this.draft = ''; this.attachments = []; this.refs = [];
    this.editingTurnId = '';
    this.sheetOpen = false; this.setPanel(false); this.chat.taskId = '';
    await this.chat.create(this.personalConversation ? 'main' : agentId,
      this.personalConversation ? null : projectId, this.personalConversation ? undefined : executionMode, this.onLocalChatCreated);
  }

  @Monitor('draftIntake.revision', 'chat.selectedId', 'restoringDraft', 'activePage')
  applyDraftHandoff(): void {
    if (!this.activePage || this.embedded || this.restoringDraft || !this.chat.selectedId
      || this.chat.selectedId !== this.requestedId) return;
    const profile = gatewaySession.currentProfile();
    const scope = JSON.stringify([profile?.gatewayId || '', profile?.deviceId || '', this.chat.selectedId]);
    if (this.draftScope !== scope) return;
    const submission = this.draftIntake.consume(this.chat.selectedId);
    if (!submission) return;
    this.draft = submission.text; this.refs = submission.refs;
    this.saveDraft();
    this.focusComposerOnMount = true;
    this.focusMountedComposer();
  }

  private async send(): Promise<void> {
    if (this.restoringDraft || this.chat.connection !== 'connected' || this.chat.cachedHistory) return;
    // A local-first conversation becomes visible before its model catalog is loaded.
    // Do not create a doomed optimistic bubble during that short initialization window.
    if (this.options.loading || this.options.saving) return;
    if (!this.options.modelId) { this.chat.error = this.options.error || 'MODEL_UNAVAILABLE'; return; }
    const text = this.draft; const files = this.attachments; const refs = this.refs; const id = this.chat.selectedId;
    if (this.editingTurnId) {
      const replaced = await this.chat.replaceLatest(this.editingTurnId, text, files, refs);
      if (replaced) { this.cancelEditing(); this.options.refreshPreparation(); }
      return;
    }
    const sent = await this.chat.send(text, files, refs, (): void => {
      this.followAfterSend();
      if (this.draft === text) this.draft = '';
      if (this.attachments === files) this.attachments = [];
      if (this.refs === refs) this.refs = [];
      this.palette.close(); this.saveDraft(); this.setPanel(false);
    });
    if (sent && this.visible && id === this.chat.selectedId) this.options.refreshPreparation();
  }
  private async retryMessage(id: string): Promise<void> {
    if (await this.chat.retrySend(id)) { if (this.visible) this.options.refreshPreparation(); }
  }
  private addReference(item: XopcReferenceItem): void {
    if (item.kind === 'file') {
      try {
        validateAttachmentSize(item.size || 0, this.attachments);
        if (!item.relativePath || this.attachments.some((file: XopcChatAttachment): boolean => file.workspaceRelativePath === item.relativePath)) return;
        this.attachments = this.attachments.concat([{ type: item.mimeType?.startsWith('image/') ? 'image' : 'document',
          name: item.title, mimeType: item.mimeType || 'application/octet-stream', size: item.size || 0, data: '', workspaceRelativePath: item.relativePath }]);
      } catch (error) { this.composerNotice.show((error as Error).message); return; }
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
    this.composerNotice.clear();
    this.pickingAttachment = true;
    try {
      const file = kind === 'document' ? await pickChatAttachment(context, this.attachments) : await pickChatPhoto(context, this.attachments, kind === 'camera');
      if (file && this.visible && id === this.chat.selectedId) this.attachments = this.attachments.concat([file]);
    } catch (error) { if (this.visible && id === this.chat.selectedId) this.composerNotice.show((error as Error).message); }
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
      if (!this.visible || this.disposed || id !== this.chat.selectedId || this.chat.connection !== 'connected') return false;
      const context = this.getUIContext().getHostContext();
      let accepted = false;
      this.chat.send('', [attachment], [], (): void => {
        accepted = true; this.followAfterSend();
      });
      if (accepted && context) seedChatMediaCache(context, attachment, id).catch((_error: Error): void => {});
      return accepted;
    });
    if (sent && closeVoiceAfterSend && this.visible && id === this.chat.selectedId) this.showVoice = false;
  }

  private openReference(kind: string): void { this.referenceKind = kind; this.openSheet('references'); }

  private toggleVoice(): void {
    if (this.chat.sending || this.voice.busy || this.voice.state !== 'idle') return;
    this.voice.dismissError(); this.reader.dismissError();
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
    this.generatedVideoOpen = false;
    await Promise.all([this.generatedMusic.pause(), this.reader.stop()]);
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
    if (this.voice.error === 'RECORDING_TOO_SHORT') await this.voice.cancel(true);
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
          this.editor.caretPosition(this.draftPresentation.text.length);
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
      SymbolGlyph(this.showVoice ? $r('sys.symbol.keyboard') : $r('sys.symbol.mic')).fontSize(22)
        .fontColor([this.colors.light && !this.showVoice ? this.colors.secondary : this.colors.chat.action])
    }.id('chat-voice-toggle').width(COMPOSER_TOOL_SIZE).height(COMPOSER_TOOL_SIZE).padding(0)
      .backgroundColor(this.colors.light && !this.showVoice ? Color.Transparent : this.colors.input)
      .responseRegion({ x: -4, y: -4, width: 44, height: 44 })
      .accessibilityText(this.showVoice ? $r('app.string.chat_switch_keyboard') : $r('app.string.record_voice'))
      .enabled(!this.chat.sending && !this.voice.busy && this.voice.state === 'idle')
      .onClick((): void => { this.toggleVoice(); })
  }

  @Builder
  composerAddAction() {
    Button({ type: ButtonType.Circle }) {
      SymbolGlyph(this.panelOpen ? $r('sys.symbol.xmark') : $r('sys.symbol.plus'))
        .fontSize(22).fontColor([this.colors.light && !this.panelOpen ? this.colors.secondary : this.colors.foreground])
    }.id('chat-composer-actions').width(44).height(44).padding(0)
      .backgroundColor(Color.Transparent).accessibilityText(this.panelOpen ? $r('app.string.close') : $r('app.string.add_attachment'))
      .enabled(!!this.chat.selectedId && !this.pickingAttachment && !this.chat.sending && this.voice.state === 'idle' && !this.voice.busy)
      .onClick((): void => { this.setPanel(!this.panelOpen); })
  }

  @Builder
  composerRightActions() {
    Row({ space: 4 }) {
      this.composerAddAction()
      if (this.hasPayload) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.arrow_up')).fontSize(22).fontColor([this.colors.chat.onAction])
        }.id('chat-send').width(COMPOSER_TOOL_SIZE).height(COMPOSER_TOOL_SIZE).padding(0)
          .backgroundColor(this.colors.chat.action).responseRegion({ x: -4, y: -4, width: 44, height: 44 })
          .accessibilityText(this.chat.runId && !this.personalConversation ? $r('app.string.chat_send_next') : $r('app.string.send'))
          .enabled(!!this.chat.selectedId && !this.chat.loading && !this.chat.cachedHistory && !this.pickingAttachment
            && this.chat.connection === 'connected' && this.voice.state === 'idle' && !this.voice.busy && !this.chat.sending
            && !this.options.loading && !this.options.saving && !!this.options.modelId)
          .onClick((): void => { this.send(); })
      }
      if (this.chat.runId) {
        Button({ type: ButtonType.Circle }) { Text('■').fontSize(18).fontColor(this.colors.chat.onAction) }
          .id('chat-stop').width(COMPOSER_TOOL_SIZE).height(COMPOSER_TOOL_SIZE).padding(0)
          .backgroundColor(this.colors.chat.action).responseRegion({ x: -4, y: -4, width: 44, height: 44 })
          .accessibilityText($r('app.string.stop')).onClick((): void => { this.chat.abort(); })
      }
    }
  }

  @Builder
  skeleton() {
    Column({ space: 16 }) {
      ForEach([0, 1, 2, 3], (index: number) => {
        Column() {}.width(index % 2 === 0 ? '90%' : '70%').height(64).borderRadius(this.colors.corner(12))
          .backgroundColor(this.colors.panel)
      }, (index: number): string => index.toString())
    }.width('100%').padding({ top: 16 + this.overlayHeaderHeight, left: 16, right: 16, bottom: 16 })
      .alignItems(HorizontalAlign.Start)
  }

  @Builder
  userMessageMenu(row: XopcChatRow) {
    Menu() {
      MenuItem({ content: $r('app.string.chat_copy') })
        .onClick((): void => { this.pendingUserMenuAction = 'copy'; })
      MenuItem({ content: !this.chat.runId && this.isLatestUser(row) && row.turnId
        ? $r('app.string.chat_edit_latest') : $r('app.string.chat_reuse') })
        .onClick((): void => { this.pendingUserMenuAction = 'edit'; })
    }
  }

  private beginMessageMenu(): void {
    this.pauseAutomaticScroll();
    this.selectingMessageId = '';
    this.pendingUserMenuAction = '';
    this.pendingAssistantMenuAction = '';
  }

  private finishUserMenu(row: XopcChatRow): void {
    const action = this.pendingUserMenuAction;
    this.pendingUserMenuAction = '';
    if (action) void this.messageAction(action, row);
  }

  private finishAssistantMenu(row: XopcChatRow): void {
    const action = this.pendingAssistantMenuAction;
    this.pendingAssistantMenuAction = '';
    if (action === 'select') {
      this.selectionOrigin = this.assistantMenuTouch;
      this.selectingMessageId = row.id;
    }
    else if (action === 'detail') this.openMessageDetail(row);
    else if (action === 'execution') this.openExecutionDetail(row);
    else if (action === 'share') void shareSelectedChatText(this.getUIContext(), chatAnswerText(row));
    else if (action) void this.messageAction(action, row);
  }

  @Builder
  assistantMessageMenu(row: XopcChatRow) {
    Menu() {
      ForEach(this.assistantMenuActions(row), (action: XopcChatMessageMenuAction) => {
        MenuItem({ content: action.label, symbolStartIcon: new SymbolGlyphModifier(action.symbol) })
          .id('chat-assistant-menu-' + action.id).enabled(action.enabled)
          .onClick((): void => { this.pendingAssistantMenuAction = action.id; })
      }, (action: XopcChatMessageMenuAction): string => action.id)
    }.id('chat-assistant-menu').width(232)
  }

  private playGeneratedMedia(card: XopcGeneratedMediaCard, openPlayer: boolean = false): void {
    const id = card.item.id;
    const context = this.getUIContext().getHostContext();
    if (!context) return;
    this.pauseAutomaticScroll();
    void this.reader.stop();
    void assistantAudioAutoplay.interrupt();
    if (card.kind === 'music') {
      const track: XopcMusicTrack = {
        id, conversationId: this.chat.selectedId,
        title: card.item.title || card.item.summary || (this.generatedMediaChinese ? '音乐' : 'Music'),
        sourceTitle: this.personalConversation ? this.personalAgent?.displayName ?? 'Ada' : this.chat.title,
        lyrics: card.item.lyrics, durationMs: card.item.durationMs, versionNumber: card.item.versionNumber
      };
      if (openPlayer) {
        this.dismissComposer();
        this.generatedMusic.openPreview(track);
      } else {
        this.generatedVideoOpen = false;
        void this.generatedMusic.play(track);
      }
    } else {
      this.dismissComposer();
      const scope = this.generatedPlaybackScope;
      void this.generatedMusic.pause().then((): void => {
        if (this.visible && this.layout.foreground && this.phonePage === 0 && scope === this.generatedPlaybackScope) {
          this.generatedVideo = card;
          this.generatedVideoOpen = true;
        }
      });
    }
  }

  @Monitor('generatedMusic.track', 'generatedMusic.player.state', 'chat.selectedId', 'activePage', 'phonePage',
    'bottomRegionHeight', 'overlayHeaderHeight')
  updateMusicPin(): void {
    const track = this.generatedMusic.track;
    if (!track || !this.activePage || this.phonePage !== 0 || track.conversationId !== this.chat.selectedId
      || this.generatedMusic.player.state !== 'playing') {
      this.pinPlayingMusic = false;
      return;
    }
    const components = this.getUIContext().getComponentUtils();
    const viewport = components.getRectangleById('chat-message-viewport');
    if (!viewport.size.height) return;
    const card = components.getRectangleById('generated-music-open-' + track.id);
    const composer = components.getRectangleById('chat-bottom-region');
    const top = viewport.windowOffset.y + this.getUIContext().vp2px(this.overlayHeaderHeight);
    const bottom = composer.size.height ? composer.windowOffset.y : viewport.windowOffset.y + viewport.size.height;
    this.pinPlayingMusic = !card.size.height || card.windowOffset.y + card.size.height <= top || card.windowOffset.y >= bottom;
  }

  @Builder
  generatedVideoDrawer() {
    if (this.generatedVideo) {
      XopcGeneratedVideoDrawer({ card: this.generatedVideo, conversationId: this.chat.selectedId,
        zh: this.generatedMediaChinese, onClose: (): void => { this.generatedVideoOpen = false; } })
    }
  }

  @Builder
  generatedMediaRows($$: XopcGeneratedMediaReply) {
    if (this.generatedMediaGroups.has($$.replyId)) {
      Column({ space: 12 }) {
        Repeat<XopcGeneratedMediaCard>(this.generatedMediaGroups.get($$.replyId) ?? []).each((entry: RepeatItem<XopcGeneratedMediaCard>) => {
          Row() {
            Column() {
              XopcGeneratedMediaRow({ card: entry.item, zh: this.generatedMediaChinese, submitting: this.generatedMedia.submitting,
                confirmationFailed: entry.item.draft && this.generatedMedia.failedDraftId === entry.item.item.id,
                animateActivity: this.activePage && this.layout.foreground && !this.layout.reduceMotion,
                conversationId: this.chat.selectedId, music: this.generatedMusic,
                onPlay: (): void => { this.playGeneratedMedia(entry.item); },
                onOpen: (): void => { this.playGeneratedMedia(entry.item, true); },
                onMusicAreaChange: (): void => { this.updateMusicPin(); },
                onConfirm: (): void => { void this.generatedMedia.confirm(entry.item); } })
            }.width(CHAT_MESSAGE_MAX_WIDTH)
              .alignItems(HorizontalAlign.Start)
          }.width('100%').justifyContent(FlexAlign.Start)
        }).key((card: XopcGeneratedMediaCard): string =>
          card.kind + ':' + card.item.id + ':' + (card.item.state ?? 'draft'))
      }.width('100%').padding({ top: 6 })
    }
  }

  @Builder
  conversation() {
    Stack({ alignContent: Alignment.Bottom }) {
    Column() {
    if (this.chat.loading && !this.chat.rows.length && !this.generatedMediaGroups.size) { this.skeleton() }
    if (!this.chat.loading && !this.chat.rows.length && !this.chat.liveRow && !this.chat.runId && !this.generatedMediaGroups.size && this.automationSetup) {
      Column({ space: 8 }) {
        Text($r('app.string.automation_setup_heading')).fontSize(22).fontWeight(FontWeight.Bold)
          .fontColor(this.colors.foreground).textAlign(TextAlign.Center)
        Text($r('app.string.automation_setup_hint')).fontSize(14).lineHeight(21)
          .fontColor(this.colors.secondary).textAlign(TextAlign.Center)
      }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
        .padding({ left: 28, right: 28, bottom: this.bottomRegionHeight })
    } else if (!this.chat.loading && !this.chat.rows.length && !this.chat.liveRow && !this.chat.runId && !this.generatedMediaGroups.size) {
      XopcChatWelcome({ activePage: this.activePage, showPersonalAvatar: this.embedded || !!this.taskId, standaloneDraft: this.isStandaloneDraft(), projectName: this.scopedProjectName, scope: this.context.summary, language: appSettings.effectiveLanguage(),
        contextPending: this.context.loading || this.options.loading,
        personal: this.personalConversation, personalName: this.personalAgent?.displayName ?? 'Ada',
        personalAgentId: this.personalAgent?.agentId ?? '', personalAppearance: this.personalAgent?.appearance ?? 'loopi',
        showQuickSetup: !this.personalConversation && !this.embedded && !this.taskId && !this.automationSetup,
        agentId: this.currentChatAgent()?.id ?? (this.options.agentId || this.chat.agentId || 'main'),
        agentName: this.currentChatAgentName(),
        agentAppearance: this.currentChatAgentAppearance(),
        agentAvatar: this.currentChatAgent()?.avatar ?? '',
        modelLabel: this.currentChatModelSubtitle(),
        projectLabel: this.context.summary?.work.project?.title || this.scopedProjectName || '',
        onSelectAgent: (): void => { this.dismissComposer(); this.openSheet('agent'); },
        onSelectModel: (): void => { this.dismissComposer(); this.openSheet('model'); },
        onSelectProject: (): void => { this.dismissComposer(); this.openSheet('project'); },
        onDismissComposer: (): void => { this.dismissComposer(); },
        onChoose: (text: string): void => { void this.fillProductDraft(text); }
      }).layoutWeight(1).width('100%').padding({ top: this.overlayHeaderHeight, bottom: this.bottomRegionHeight })
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
                  LoadingProgress().width(24).height(24).color(this.colors.secondary).flexShrink(0).margin({ right: 8 })
                } else if (item.item.sendState === 'failed') {
                  Button({ type: ButtonType.Circle }) {
                    Text('!').fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.colors.danger)
                  }.id('chat-message-retry-' + item.item.id).width(32).height(44).padding(0).flexShrink(0)
                    .backgroundColor(Color.Transparent).accessibilityText($r('app.string.chat_retry_send'))
                    .enabled(!this.chat.sending && !this.chat.loading && !this.chat.cachedHistory && this.chat.connection === 'connected')
                    .onClick((): void => { this.retryMessage(item.item.id); })
                }
                Stack({ alignContent: Alignment.TopStart }) {
                  Column() {
                  XopcChatMessageContent({ skillLabels: this.skillLabels, row: item.item, onReading: (): void => { this.pauseAutomaticScroll(); }, animateStreaming: item.item.live === true && this.atBottom && this.activePage && this.layout.foreground && !this.layout.reduceMotion, conversationId: this.chat.selectedId,
                    previewEligible: item.item.id !== this.latestMessageId,
                    onShowMore: (row: XopcChatRow): void => { this.openMessageDetail(row); },
                    reasoning: this.context.config?.activityDetail?.effective || 'on', onNavigate: (route: XopcMobileRoute): void => { this.navigateChatRoute(route); },
                    onFillDraft: (text: string): void => { this.fillProductDraft(text); } })
                  }.id('chat-user-bubble-' + item.item.id).width('100%')
                  .padding(this.userVoiceOnly(item.item) ? { left: 4, right: 4, top: 0, bottom: 0 }
                    : { left: 14, right: 14, top: 10, bottom: 10 }).alignItems(HorizontalAlign.Start)
                  .borderRadius(this.colors.corner(18)).backgroundColor(this.colors.chat.bubble)
                  .onClick((): void => {
                    if (item.item.id !== this.latestMessageId && chatMessageNeedsPreview(item.item)) this.openMessageDetail(item.item);
                  }, CHAT_MESSAGE_TAP_SLOP_VP)
                  .bindContextMenu(item.item.text ? this.userMessageMenu(item.item) : undefined, ResponseType.LongPress, {
                    hapticFeedbackMode: HapticFeedbackMode.ENABLED,
                    aboutToAppear: (): void => { this.beginMessageMenu(); },
                    onDisappear: (): void => { this.finishUserMenu(item.item); }
                  })
                  if (this.reactionFor(item.item)) {
                    Stack({ alignContent: Alignment.TopStart }) {
                      Text(this.reactionFor(item.item)?.emoji ?? '').id('chat-agent-reaction-' + item.item.id)
                        .fontSize(15).maxFontScale(1).width(26).height(26).textAlign(TextAlign.Center)
                        .backgroundColor(this.colors.reactionFill).borderRadius(13).position({ x: 4, y: 0 })
                        .accessibilityText((this.reactionFor(item.item)?.actorName ?? '') + ' ' + (this.reactionFor(item.item)?.emoji ?? ''))
                      Circle().width(5).height(5).fill(this.colors.reactionFill).position({ x: 3, y: 23 }).accessibilityLevel('no')
                      Circle().width(3).height(3).fill(this.colors.reactionFill).position({ x: 0, y: 28 }).accessibilityLevel('no')
                    }.width(30).height(31).position({ x: -16, y: -16 }).hitTestBehavior(HitTestMode.None)
                      .transition(TransitionEffect.OPACITY.animation({ duration: this.reactionDuration(item.item), curve: Curve.EaseOut }))
                  }
                }.width(this.userBubbleWidth(item.item)).constraintSize({ minWidth: 44, maxWidth: CHAT_MESSAGE_MAX_WIDTH }).flexShrink(1)
              }.width('100%').justifyContent(FlexAlign.End)
            }.width('100%').alignItems(HorizontalAlign.End)
          } else if (item.item.role === 'assistant') {
            Column({ space: 2 }) {
              if (this.personalConversation && item.item.live && !chatAnswerStarted(item.item) && !this.prompt.prompt) {
                XopcChatStepsView({ row: item.item,
                  animateDots: this.chat.connection === 'connected' && this.atBottom && this.activePage
                    && this.layout.foreground && !this.layout.reduceMotion })
              }
              if (chatAnswerStarted(item.item) || (item.item.media || []).length > 0 || (item.item.refs || []).length > 0
                || (!item.item.live && ((item.item.deliveries || []).length > 0 || (item.item.outcome?.deliverables || []).length > 0))
                || (this.personalConversation && item.item.outcome?.status === 'failed')
                || (item.item.blocks || []).some((block: XopcChatBlock): boolean => block.kind === 'review')) {
              Column() {
                Column() {
                  XopcChatMessageContent({ skillLabels: this.skillLabels, row: item.item, onReading: (): void => { this.pauseAutomaticScroll(); }, animateStreaming: item.item.live === true && this.atBottom && this.activePage && this.layout.foreground && !this.layout.reduceMotion, conversationId: this.chat.selectedId,
                    selectingText: this.selectingMessageId === item.item.id,
                    selectionOrigin: this.selectionOrigin,
                    onEndSelection: (): void => { if (this.selectingMessageId === item.item.id) this.selectingMessageId = ''; },
                    previewEligible: item.item.id !== this.latestMessageId,
                    onShowMore: (row: XopcChatRow): void => { this.openMessageDetail(row); },
                    onShowExecution: (row: XopcChatRow): void => { this.openExecutionDetail(row); },
                    connection: this.chat.connection, showWaiting: false,
                    showFailure: this.personalConversation,
                    reasoning: this.context.config?.activityDetail?.effective || 'on', onNavigate: (route: XopcMobileRoute): void => { this.navigateChatRoute(route); },
                    onFillDraft: (text: string): void => { this.fillProductDraft(text); } })
                }.id('chat-assistant-card-' + item.item.id).width(this.assistantBubbleWidth(item.item))
                  .constraintSize({ maxWidth: '100%' }).alignItems(HorizontalAlign.Start)
                  .padding({ left: 14, right: 14, top: 12, bottom: 12 })
                  .backgroundColor(this.colors.assistantBubble).borderRadius(this.colors.corner(20))
                  .onClick((): void => {
                    if (this.selectingMessageId !== item.item.id
                      && item.item.id !== this.latestMessageId && chatMessageNeedsPreview(item.item)) this.openMessageDetail(item.item);
                  }, CHAT_MESSAGE_TAP_SLOP_VP)
                  .onTouch((event: TouchEvent): void => {
                    const touch = event.touches[0];
                    if (event.type === TouchType.Down && touch) {
                      this.assistantMenuTouch = { rowId: item.item.id, x: touch.windowX, y: touch.windowY };
                    }
                  })
                  .bindContextMenu(!item.item.live && this.selectingMessageId !== item.item.id
                    ? this.assistantMessageMenu(item.item) : undefined, ResponseType.LongPress, {
                    hapticFeedbackMode: HapticFeedbackMode.ENABLED,
                    aboutToAppear: (): void => { this.beginMessageMenu(); },
                    onDisappear: (): void => { this.finishAssistantMenu(item.item); }
                  })
              }.width('92%').constraintSize({ maxWidth: 640 }).alignItems(HorizontalAlign.Start)
              }
              if (!this.personalConversation && (item.item.live || !!chatStageStatus(item.item))) {
                XopcChatStepsView({ row: item.item, staged: true, paused: !!item.item.live && !!this.prompt.prompt,
                  animateDots: this.chat.connection === 'connected' && this.atBottom && this.activePage
                    && this.layout.foreground && !this.layout.reduceMotion })
              }
              this.generatedMediaRows({ replyId: item.item.id })
            }.width('100%').alignItems(HorizontalAlign.Start)
          } else {
            Column({ space: 2 }) {
              XopcChatMessageContent({ skillLabels: this.skillLabels, row: item.item, onReading: (): void => { this.pauseAutomaticScroll(); }, animateStreaming: item.item.live === true && this.atBottom && this.activePage && this.layout.foreground && !this.layout.reduceMotion, conversationId: this.chat.selectedId,
                reasoning: this.context.config?.activityDetail?.effective || 'on', onNavigate: (route: XopcMobileRoute): void => { this.navigateChatRoute(route); },
                onFillDraft: (text: string): void => { this.fillProductDraft(text); } })
            }.width('100%').alignItems(HorizontalAlign.Start)
          }
        }.onAreaChange((previous: Area, current: Area): void => {
          this.onMessageRowLayoutChange(item.item.id, previous, current);
        })
      }).key((row: XopcChatRow): string => this.renderKeys.key(row)).virtualScroll({ totalCount: this.presentationRows.length })
      ListItem() {
        Column() {
          Column() {
            this.generatedMediaRows({ replyId: '' })
          }.width('100%')
          Column().id('chat-bottom-clearance').width('100%')
            .height(this.bottomRegionHeight + 12)
        }.width('100%')
      }.onAreaChange((previous: Area, current: Area): void => {
        if (Number(previous.height) !== Number(current.height)) this.onMessageChange();
      })
    }.id('chat-message-list').height('100%').width('100%').padding({ left: 20, right: 20 }).cachedCount(3)
      .stackFromEnd(false)
      .contentStartOffset(this.messageHeaderClearance)
      .onAreaChange((previous: Area, current: Area): void => { this.onMessageViewportChange(previous, current); })
      .onScrollIndex((start: number, end: number): void => {
        this.firstVisible = start;
      })
      .onWillScroll((_offset: number, _state: ScrollState, source: ScrollSource): void => {
        this.onMessageScrollSource(source);
      })
      .onDidScroll((offset: number, state: ScrollState): void => { this.onMessageScroll(offset, state); this.updateMusicPin(); })
      .onScrollStop((): void => {
        this.updateMusicPin();
        const userScrolled = this.messageScrollFromUser;
        this.messageScrollFromUser = false;
        if (this.jumpingToBottom) {
          this.jumpingToBottom = false;
          this.atBottom = true;
        }
        if (userScrolled || this.atBottom) this.saveReadingPosition();
        this.updateJumpButton();
      })
      .onTouch((event: TouchEvent): void => {
        if (event.type === TouchType.Down) {
          clearTimeout(this.scrollTimer); this.scrollTimer = -1; this.dismissComposer();
        } else if (event.type === TouchType.Up && this.initialScrollPending) this.onMessageChange();
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
        .onClick((): void => {
          if (this.jumpingToBottom) return;
          const animate = !this.layout.reduceMotion && !this.messagesScroller.isAtEnd();
          if (!animate) {
            this.resetMessagePosition(); this.saveReadingPosition(); this.onMessageChange();
            return;
          }
          clearTimeout(this.scrollTimer); this.scrollTimer = -1;
          this.initialScrollPending = false;
          this.olderGeneration++; this.loadingOlder = false; this.olderFailed = false;
          this.jumpingToBottom = true;
          this.showJumpBottom = false;
          const last = this.presentationRows.length + (this.chat.hasOlder ? 1 : 0);
          this.messagesScroller.scrollToIndex(last, true, ScrollAlign.END);
        })
    }
    }.id('chat-message-viewport').layoutWeight(1).width('100%').backgroundColor(Color.Transparent)
    }
    }.id('chat-content-viewport').width('100%').height('100%')
      // Keep messages behind the floating dock; reserve clearance inside the list's scroll extent.
      .clip(true)
      .parallelGesture(PanGesture({ fingers: 1, direction: PanDirection.Right, distance: CHAT_SIDEBAR_PAN_DISTANCE_VP })
        .tag(CHAT_SIDEBAR_PAN_TAG)
        .onActionStart((event: GestureEvent): void => {
          this.dismissComposer();
          this.onSidebarDragStart(event.offsetX);
        })
        .onActionUpdate((event: GestureEvent): void => { this.onSidebarDragUpdate(event.offsetX); })
        .onActionEnd((event: GestureEvent): void => { this.onSidebarDragEnd(event.offsetX, event.velocityX); })
        .onActionCancel((): void => { this.onSidebarDragCancel(); }))
      .onGestureRecognizerJudgeBegin((event: BaseGestureEvent, current: GestureRecognizer,
        others: GestureRecognizer[]): GestureJudgeResult => {
        if (current.getTag() !== CHAT_SIDEBAR_PAN_TAG) return GestureJudgeResult.CONTINUE;
        return this.judgeSidebarPan(event as PanGestureEvent, others);
      })
    Column().id('chat-dock-corner-mask').width('100%').height(24).backgroundColor(this.colors.chat.canvas)
    Column() {
    Column() {
    if (this.networkNotice) { this.chatNetworkNotice() }
    if (this.connectionWait.snapshot?.wait) { XopcChatConnectionWait({ model: this.connectionWait }) }
    if (this.prompt.prompt) { XopcChatPrompt({ model: this.prompt }) }
    if (this.options.preparationError) {
      Button($r('app.string.chat_project_preparation_title'))
        .onClick((): void => { this.openSheet('preparation'); })
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
              .padding({ left: 10, right: 9 }).borderRadius(this.colors.corner(10)).clipShape(this.colors.cornerClip(10)).backgroundColor(this.colors.panel)
              .accessibilityText($r('app.string.chat_remove_reference'))
              .responseRegion({ x: 0, y: -4, width: '100%', height: 44 })
              .onClick((): void => { this.refs = this.refs.filter((item: XopcContextRef): boolean => item !== ref); })
          }, (ref: XopcContextRef): string => ref.kind + ':' + ref.sourceId)
        }
      }.scrollable(ScrollDirection.Horizontal).width('92%').height(44)
    }
    if (this.voice.error) {
      Row({ space: 8 }) {
        Text(voiceInputErrorMessage(this.voice.error)).fontSize(13).fontColor(this.colors.secondary).layoutWeight(1).maxLines(3)
        Button('×').width(44).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
          .accessibilityText($r('app.string.dismiss')).onClick((): void => { this.voice.dismissError(); })
      }.id('chat-voice-error').width('100%').padding({ left: 16, right: 8 })
    }
    if (this.reader.owner === this.readAloudOwner && this.reader.error) {
      Row({ space: 8 }) {
        Text(userErrorMessage(this.reader.error, 'media')).fontSize(13).fontColor(this.colors.secondary).layoutWeight(1).maxLines(3)
        Button('×').width(44).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
          .accessibilityText($r('app.string.dismiss')).onClick((): void => { this.reader.dismissError(); })
      }.id('chat-read-aloud-error').width('100%').padding({ left: 16, right: 8 })
    }
    if (this.composerError) {
      Row({ space: 8 }) {
        Text(userErrorMessage(this.composerError, 'generic')).fontSize(13).fontColor(this.colors.secondary).layoutWeight(1).maxLines(3)
        Button('×').width(44).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
          .accessibilityText($r('app.string.dismiss')).onClick((): void => { this.composerNotice.clear(); })
      }.id('chat-composer-error').width('100%').padding({ left: 16, right: 8 })
    }
    if (this.showMusicMiniPlayer && !this.pinPlayingMusic) { XopcMusicMiniPlayer({ onOpen: (): void => { this.dismissComposer(); } }) }
    XopcConversationMcpAction({ conversationId: this.chat.selectedId, shown: this.activePage && !this.embedded,
      activeRun: !!(this.chat.streaming || this.chat.thinking || this.chat.tool) })
    if (this.palette.range && (this.palette.loading || this.palette.items.length || this.palette.error)) {
      Column({ space: 4 }) {
        if (this.palette.loading) {
          Column() {}.height(44).width('100%').borderRadius(this.colors.corner(12)).backgroundColor(this.colors.grouped)
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
              }.width('100%').height(52).padding(8).backgroundColor(Color.Transparent)
                .borderRadius(this.colors.corner(10)).clipShape(this.colors.cornerClip(10))
                .onClick((): void => { this.applyPalette(item); })
            }
          }, (item: XopcPaletteItem): string => item.id)
        }.width('100%').height(Math.min(3, this.palette.items.length) * 56)
      }.id('chat-command-palette').width('92%').padding(8).borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel).margin({ bottom: 4 })
    }
    if (this.taskId) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 6 }) {
          SymbolGlyph($r('sys.symbol.info_circle')).fontSize(13).fontColor([this.colors.secondary])
          Text($r('app.string.task_detail_title')).fontSize(13).fontColor(this.colors.secondary)
        }
      }.id('task-chat-details-tip').height(28).padding({ left: 10, right: 10 }).backgroundColor(this.colors.chat.card)
        .borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14))
        .responseRegion({ x: 0, y: -8, width: '100%', height: 44 })
        .alignSelf(ItemAlign.Start).margin({ left: 16, top: 8, bottom: 8 })
        .onClick((): void => {
          this.dismissComposer();
          this.onNavigate({ page: 'task-detail', itemId: this.taskId });
        })
    }
    if (!this.prompt.prompt) {
    Column() {
    Column() {
      if (this.editingTurnId) {
        Column() {
          Row({ space: 8 }) {
            Text($r('app.string.chat_editing_latest'))
              .fontSize(12).fontColor(this.colors.secondary).layoutWeight(1)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            Button($r('app.string.cancel')).id('chat-edit-cancel').height(36)
              .padding({ left: 8, right: 8 })
              .backgroundColor(Color.Transparent).fontColor(this.colors.accent).fontSize(13)
              .responseRegion({ x: 0, y: -4, width: '100%', height: 44 })
              .onClick((): void => { this.cancelEditing(); })
          }.width('100%').padding({ left: 16, right: 8, top: 4, bottom: 2 }).alignItems(VerticalAlign.Center)
          Column().width('100%').height(0.5).backgroundColor(this.colors.border)
        }.id('chat-editing-banner').width('100%')
      }
      if (this.attachments.length) {
        Scroll() {
          Row({ space: 8 }) {
            ForEach(this.attachments, (file: XopcChatAttachment, index: number) => {
              if (file.mimeType.startsWith('image/')) {
                Stack({ alignContent: Alignment.TopEnd }) {
                  Column() {
                    XopcChatMediaView({ file: this.attachmentPreviews[index], conversationId: this.chat.selectedId,
                      draftPreview: true, compact: true, embedded: true, compactThumbnail: true,
                      compactThumbnailWidth: 96, compactThumbnailHeight: 96, compactThumbnailContain: false,
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
                }.id('chat-composer-attachment-' + index.toString()).width(96).height(96)
                  .borderRadius(this.colors.corner(12)).backgroundColor(this.colors.grouped).clip(true)
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
                  .borderRadius(this.colors.corner(10)).backgroundColor(this.colors.grouped).clip(true)
              }
            }, (file: XopcChatAttachment, index: number): string => index.toString() + ':' + file.name + ':' + file.size.toString())
          }.padding({ left: 12, right: 12, top: 10, bottom: 8 })
        }.id('chat-composer-attachments').scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
          .width('100%').height(this.attachments.some((file: XopcChatAttachment): boolean => file.mimeType.startsWith('image/')) ? 114 : 74)
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
              }.id('chat-voice-record').width('100%').height(44).padding(0).borderRadius(this.colors.corner(14))
                .backgroundColor(this.voiceHeld ? this.colors.grouped : Color.Transparent)
                .enabled(this.voiceHeld || (!this.voiceFinishing && !this.voice.busy && !this.chat.sending))
                .accessibilityText($r('app.string.voice_hold_to_speak'))
                .onTouch((event: TouchEvent): void => { this.handleVoiceTouch(event); })
            }
          }.id('chat-voice-pad').layoutWeight(1)
        } else {
          // Keep one editor node across compact/expanded states so the IME and caret survive the first keystroke.
          Stack({ alignContent: Alignment.Start }) {
            TextArea({ text: this.draftPresentation.text, placeholder: this.nextTurnPrompt ? '' : this.personalConversation
              ? $r('app.string.chat_ask_personal', this.personalAgent?.displayName ?? '') : $r('app.string.message_hint'),
              controller: this.editor })
              .id('chat-composer').width('100%').constraintSize({ minHeight: COMPOSER_INPUT_MIN, maxHeight: this.expandedComposer ? COMPOSER_INPUT_MAX : COMPOSER_INPUT_MIN })
              .padding({ left: 4, right: 4, top: this.expandedComposer ? 5 : 10, bottom: this.expandedComposer ? 5 : 10 }).lineHeight(20)
              .enabled(!this.restoringDraft).backgroundColor(Color.Transparent)
              .enableKeyboardOnFocus(true)
              .fontSize(16).fontColor(this.colors.foreground)
              .placeholderColor(this.colors.light && !this.panelOpen ? this.colors.tertiary : this.colors.chat.secondary)
              .onAppear((): void => { this.focusMountedComposer(); })
              .onEditChange((editing: boolean): void => {
                if (editing) this.setPanel(false);
                else this.draftComposing = false;
              })
              .onWillChange((change: EditableTextChangeValue): boolean => {
                this.draftChange = change.options;
                return true;
              })
              .onChange((value: string, preview?: PreviewText): void => {
                const change = this.draftChange; this.draftChange = undefined;
                this.draftComposing = !!preview?.value;
                if (!value && !this.draftComposing) this.chat.clearAcceptedSuggestion();
                const presentation = this.draftPresentation;
                const range = change?.oldContent === presentation.text ? change?.rangeBefore : undefined;
                this.draft = editCapabilityText(this.draft, presentation, value, range?.start, range?.end);
                this.cursor = capabilityWireOffset(this.draftPresentation, change?.rangeAfter.end ?? value.length);
                this.palette.update(this.draft, this.cursor, this.chat.selectedId, appSettings.effectiveLanguage());
              })
              .onTextSelectionChange((start: number, end: number): void => {
                this.cursor = capabilityWireOffset(this.draftPresentation, end);
                if (start === end) this.palette.update(this.draft, this.cursor, this.chat.selectedId, appSettings.effectiveLanguage()); else this.palette.close();
              })
            if (this.nextTurnPrompt) {
              Button({ type: ButtonType.Normal }) {
                Row({ space: 4 }) {
                  Text(this.nextTurnPrompt).layoutWeight(1).fontSize(16).fontColor(this.colors.secondary)
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text('↳').fontSize(14).fontColor(this.colors.secondary)
                }
              }.id('chat-next-turn-suggestion').width('87%').height(44).padding({ left: 4, right: 4 })
                .backgroundColor(Color.Transparent)
                .accessibilityText($r('app.string.chat_fill_suggestion', this.nextTurnPrompt))
                .onClick((): void => { this.fillNextTurnSuggestion(); })
            }
          }.layoutWeight(1)
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
    }.id('chat-composer-shell').width('100%')
      .backgroundColor(this.panelOpen ? Color.Transparent : this.colors.input).borderRadius(this.colors.corner(28))
      .clip(true).margin({ bottom: 6, top: 8 })
    XopcChatActionPanel({ open: this.panelOpen, canSwitchAgent: this.canSwitchAgent, disabledIds: this.disabledActionIds(),
      onSelect: (id: string): void => { this.chooseAction(id); } })
    }.width('calc(100% - 24vp)').backgroundColor(this.panelOpen ? this.colors.panel : Color.Transparent).borderRadius(this.colors.corner(28))
    }
    }.id('chat-bottom-surface').width('100%').backgroundColor(Color.Transparent)
      .borderRadius(this.colors.corner(24)).clip(true)
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


  private disabledActionIds(): string[] {
    const ids: string[] = [];
    if (this.pickingAttachment || this.attachments.length >= MAX_ATTACHMENTS) ids.push('photos', 'camera', 'document');
    if (this.voice.busy || this.voice.state !== 'idle') ids.push('record-voice');
    if (this.refs.length >= 5) ids.push('reference-note', 'reference-task');
    if (this.attachments.length >= MAX_ATTACHMENTS) ids.push('reference-file');
    return ids;
  }

  @Computed get canSwitchAgent(): boolean {
    return !this.embedded && !this.taskId && !this.personalConversation;
  }

  private chooseAction(id: string): void {
    if (!this.panelOpen || !this.visible) return;
    if (this.chat.sending || this.voice.busy || this.voice.state !== 'idle') return;
    if (id === 'switch-agent') {
      if (this.canSwitchAgent) this.openSheet('agent');
      return;
    }
    this.setPanel(false);
    if (id === 'camera' || id === 'photos' || id === 'document') this.addAttachment(id);
    else if (id.startsWith('reference-')) this.openReference(id.slice('reference-'.length));
    else if (id === 'record-voice' && !this.showVoice) this.toggleVoice();
  }

  private judgeSidebarPan(event: PanGestureEvent, recognizers: GestureRecognizer[]): GestureJudgeResult {
    const finger = event.fingerInfos?.[0] ?? event.fingerList[0];
    if (!finger || event.source !== SourceType.TouchScreen || !this.sidebarSwipeEnabled || !this.activePage || this.phonePage !== 0
      || this.panelOpen || this.voiceHeld
      || !canStartChatSidebarPan(finger.globalX - event.offsetX, this.sidebarSwipeWidth, event.offsetX, event.offsetY)) {
      return GestureJudgeResult.REJECT;
    }
    for (const recognizer of recognizers) {
      if (!recognizer.isBuiltIn() || recognizer.getType() !== GestureControl.GestureType.PAN_GESTURE) continue;
      const target = recognizer.getEventTargetInfo();
      if (target instanceof ScrollableTargetInfo && target.getId().startsWith(MARKDOWN_HORIZONTAL_SCROLL_ID_PREFIX)
        && !target.isBegin()) {
        return GestureJudgeResult.REJECT;
      }
    }
    return GestureJudgeResult.CONTINUE;
  }

  private canStartVoiceCall(): boolean {
    return !!this.chat.selectedId && !this.chat.sending && !this.voice.busy &&
      this.voice.state === 'idle' && this.call.phase === 'idle';
  }

  private startVoiceCall(): void {
    if (!this.visible || !this.canStartVoiceCall()) return;
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.dismissComposer();
    this.generatedVideoOpen = false;
    const conversationId = this.chat.selectedId;
    void Promise.all([this.generatedMusic.pause(), this.reader.stop(), this.voice.cancel()]).then((): void => {
      if (!this.visible || this.chat.selectedId !== conversationId || !this.canStartVoiceCall()) return;
      void this.call.start(context, { conversationId,
      mode: 'auto', background: true,
      name: this.personalConversation ? this.personalAgent?.displayName ?? 'Ada'
        : this.chat.title || this.options.modelName(appSettings.effectiveLanguage()) });
    });
  }

  @Monitor('chat.selectedId', 'chat.connection', 'activePage', 'layout.foreground', 'phonePage')
  syncPhoneWorkspace(): void {
    this.phone.bind(this.chat.selectedId, this.activePage && this.layout.foreground, this.phonePage === 1);
    if (this.phonePage === 1) this.dismissComposer();
  }
  @Monitor('phone.summary')
  onPhoneAvailability(): void { if (this.phone.summary && !this.phone.summary.available) this.phonePage = 0; }

  build() {
    Swiper() {
      this.chatWorkspace()
      if (this.phone.summary?.available || this.phonePage === 1) {
        Column() {
          Column() {
            XopcPhoneView({ phone: this.phone, onReturn: (): void => { this.phonePage = 0; } })
          }.width('100%').layoutWeight(1)
          if (this.phonePage === 1 && this.generatedMusic.track) {
            XopcMusicMiniPlayer()
          }
        }.width('100%').height('100%').padding({ top: this.chatTopInset + 8 })
      }
    }.index(this.phonePage).loop(false).indicator(false).cachedCount(1)
      .disableSwipe(!this.phone.summary?.available || this.phone.state?.ownControl === true || this.phone.busy)
      .onChange((index: number): void => { this.phonePage = index; })
      .width('100%').height(LayoutPolicy.matchParent)
  }

  @Builder
  voiceCallButton() {
    Button({ type: ButtonType.Circle }) {
      SymbolGlyph($r('sys.symbol.phone')).fontSize(21).fontColor([this.colors.foreground])
    }.id('chat-header-voice-call').width(44).height(44).padding(0).backgroundColor(this.colors.chat.card)
      .accessibilityText($r('app.string.voice_call_action_natural')).enabled(this.canStartVoiceCall())
      .onClick((): void => { this.startVoiceCall(); })
  }

  @Computed get showReadAloudPlayback(): boolean {
    return this.activePage && this.phonePage === 0 && this.reader.owner === this.readAloudOwner &&
      this.reader.state !== 'idle';
  }

  private readAloudStatus(): Resource {
    if (this.reader.state === 'loading') return $r('app.string.chat_read_aloud_loading');
    if (this.reader.state === 'paused') return $r('app.string.chat_read_aloud_paused');
    return $r('app.string.chat_read_aloud_playing');
  }

  private toggleContinuousRead(): void {
    if (!this.canToggleContinuousRead()) return;
    this.onAutoReadChange();
    void this.reader.toggleContinuous(this.readAloudOwner);
  }

  @Monitor('showReadAloudPlayback', 'searchOpen')
  closeReadAloudMenu(): void {
    if (!this.showReadAloudPlayback || this.searchOpen) this.readAloudMenuOpen = false;
  }

  @Builder
  readAloudMenuAction(label: Resource, actionId: string, action: () => void) {
    Button({ type: ButtonType.Normal }) {
      Text(label).fontSize(14).fontColor(this.colors.foreground)
        .width('100%').maxLines(2).textAlign(TextAlign.Center)
    }.id(actionId).layoutWeight(1).height(44).padding({ left: 6, right: 6 })
      .backgroundColor(Color.Transparent).borderRadius(this.colors.corner(10)).clipShape(this.colors.cornerClip(10))
      .focusOnTouch(false)
      .onClick((): void => {
        this.readAloudMenuOpen = false;
        if (this.showReadAloudPlayback) action();
      })
  }

  @Builder
  readAloudMenu() {
    Column() {
      Text(this.readAloudStatus()).fontSize(12).fontColor(this.colors.secondary).width('100%')
        .padding({ left: 10, right: 10, top: 6, bottom: 4 })
      Row() {
        if (this.reader.state === 'playing' || this.reader.state === 'paused') {
          this.readAloudMenuAction(this.reader.state === 'paused' ? $r('app.string.resume') : $r('app.string.pause'),
            'chat-read-aloud-toggle', (): void => { void this.reader.toggle(); })
        }
        this.readAloudMenuAction($r('app.string.stop'), 'chat-read-aloud-stop', (): void => { void this.reader.stop(); })
      }.width('100%')
      if (this.continuousReadSelected) {
        Row() {
          this.readAloudMenuAction($r('app.string.chat_continuous_stop'), 'chat-read-aloud-stop-continuous',
            (): void => { this.toggleContinuousRead(); })
        }.width('100%')
      }
    }.id('chat-header-read-aloud-menu').width(176).padding(4)
  }

  @Builder
  continuousReadButton() {
    if (this.showReadAloudPlayback) {
      Button({ type: ButtonType.Circle }) {
        if (this.reader.state === 'loading') {
          LoadingProgress().width(21).height(21).color(this.colors.onAccent)
        } else {
          SymbolGlyph(this.reader.state === 'paused' ? $r('sys.symbol.pause_fill') : $r('sys.symbol.waveform'))
            .fontSize(22).fontColor([this.colors.onAccent])
        }
      }.id('chat-header-read-aloud-playback').width(44).height(44).padding(0)
        .backgroundColor(this.colors.accent)
        .accessibilitySelected(this.continuousReadSelected)
        .accessibilityText(this.readAloudStatus())
        .focusOnTouch(false)
        .onClick((): void => { this.readAloudMenuOpen = !this.readAloudMenuOpen; })
        .bindPopup(this.readAloudMenuOpen, {
          builder: this.readAloudMenu,
          placement: Placement.BottomRight,
          focusable: false,
          showInSubWindow: false,
          backgroundBlurStyle: BlurStyle.NONE,
          popupColor: this.colors.panel,
          onStateChange: (event: PopupStateChangeParam): void => {
            if (!event.isVisible) this.readAloudMenuOpen = false;
          }
        })
    } else {
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph(this.continuousReadSelected ? $r('sys.symbol.speaker_wave_2_fill') : $r('sys.symbol.speaker_slash'))
          .fontSize(21).fontColor([this.continuousReadSelected ? this.colors.accent : this.colors.foreground])
      }.id('chat-header-continuous-read').width(44).height(44).padding(0)
        .backgroundColor(this.continuousReadSelected ? this.colors.accentSoft : this.colors.chat.card)
        .accessibilitySelected(this.continuousReadSelected)
        .accessibilityText(this.continuousReadSelected ? $r('app.string.chat_continuous_stop') : $r('app.string.chat_continuous_start'))
        .enabled(this.canToggleContinuousRead())
        .onClick((): void => { this.toggleContinuousRead(); })
    }
  }

  @Builder
  conversationActions() {
    Row({ space: 3 }) {
      if (this.phone.summary?.available) {
        Button({ type: ButtonType.Circle }) {
          Stack({ alignContent: Alignment.TopEnd }) {
            SymbolGlyph($r('sys.symbol.phone_1')).fontSize(21).fontColor([this.colors.foreground])
            if (this.phone.needsAttention) { Circle().width(7).height(7).fill(this.colors.attentionForeground) }
          }
        }.id('chat-header-phone').width(44).height(44).padding(0).backgroundColor(this.colors.chat.card)
          .accessibilityText($r('app.string.phone_open')).onClick((): void => { this.dismissComposer(); this.phonePage = 1; })
      }
      this.voiceCallButton()
      this.continuousReadButton()
      if (!this.personalConversation) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.slider_horizontal_2')).fontSize(21).fontColor([this.colors.foreground])
        }.width(44).height(44).padding(0).backgroundColor(this.colors.chat.card).id('chat-header-actions')
          .accessibilityText($r('app.string.chat_actions'))
          .onClick((): void => { this.dismissComposer(); this.openSheet('actions'); })
      }
    }
  }

  @Builder
  navigationButtons() {
    Row({ space: 3 }) {
      if (this.projectChat) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([this.colors.foreground])
        }.id('project-chat-close').width(44).height(44).padding(0).backgroundColor(this.colors.chat.card)
          .accessibilityText($r('app.string.back'))
          .onClick((): void => { this.dismissComposer(); this.onProjectClose(); })
      }
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.line_3_horizontal')).fontSize(22).fontColor([this.colors.foreground])
      }.id('chat-header-sidebar').width(44).height(44).padding(0).backgroundColor(this.colors.chat.card)
        .accessibilityText($r('app.string.chat_open_drawer'))
        .onClick((): void => { this.dismissComposer(); this.onOpenSidebar(); })
    }
  }

  private isStandaloneDraft(): boolean {
    return this.chat.localDraft && !this.chat.rows.length && !this.chat.projectId && !this.embedded && !this.taskId && !this.personalConversation;
  }

  private openPersonalOverview(): void {
    this.dismissComposer();
    this.onNavigate({ page: 'personal-agent-overview', itemId: '', canShareConversation: this.canShareConversation() });
  }

  private currentChatAgent(): XopcChatAgent | undefined {
    const id = this.options.agentId || this.chat.agentId;
    return this.options.agents.find((item: XopcChatAgent): boolean => item.id === id);
  }

  private currentChatAgentName(): ResourceStr {
    const agent = this.currentChatAgent();
    if (agent) return agentDisplayName(agent);
    return this.options.agentName() || this.chat.agentId || 'Main';
  }

  private currentChatAgentNameText(): string {
    const label = this.currentChatAgentName();
    return typeof label === 'string'
      ? label
      : this.getUIContext().getHostContext()?.resourceManager.getStringSync(label) ?? '';
  }

  private currentChatAgentAppearance(): string {
    const agent = this.currentChatAgent();
    if (agent && this.personalAgent?.agentId === agent.id) return this.personalAgent.appearance;
    if (agent?.avatar?.startsWith('xopc:loopi:')) return agent.avatar.endsWith(':care') ? 'loopi-care' : 'loopi';
    return 'configured';
  }

  private currentChatAgentBadge(): string {
    const agent = this.currentChatAgent();
    if (!agent) return '';
    const badge = agentExternalRuntimeBadge(agent);
    return shouldShowRuntimeBadge(this.currentChatAgentNameText(), badge) ? badge : '';
  }

  private currentChatModelSubtitle(): string {
    if (!this.options.modelId && !this.options.selectedModel()) return '';
    const language = appSettings.effectiveLanguage();
    return chatModelSubtitle(
      this.options.modelName(language),
      this.options.selectedModel()?.thinking?.mode,
      this.options.thinkingLevel,
      this.options.isFastModeEnabled(),
      language,
    );
  }

  private currentContextStrip(): XopcChatContextStrip | undefined {
    if (this.personalConversation) return undefined;
    return chatContextStrip(this.context.summary, this.scopedProjectName, appSettings.effectiveLanguage());
  }

  @Builder
  chatIdentityPill() {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 1 }) {
        Row({ space: 5 }) {
          XopcPersonalAgentAvatar({
            extent: 18,
            activePage: false,
            agentId: this.currentChatAgent()?.id ?? (this.options.agentId || this.chat.agentId || 'main'),
            appearance: this.currentChatAgentAppearance(),
            avatarReference: this.currentChatAgent()?.avatar ?? '',
            fallbackLabel: this.currentChatAgentNameText(),
            compact: true,
          })
          Text(this.currentChatAgentName())
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .constraintSize({ maxWidth: 120 })
          if (this.currentChatAgentBadge()) {
            Text(this.currentChatAgentBadge())
              .fontSize(10)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary)
              .backgroundColor(this.colors.input)
              .borderRadius(999)
              .padding({ left: 5, right: 5, top: 1, bottom: 1 })
          }
          SymbolGlyph($r('sys.symbol.chevron_down'))
            .fontSize(11)
            .fontColor([this.colors.secondary])
            .accessibilityLevel('no')
        }.justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
        if (this.currentChatModelSubtitle()) {
          Text(this.currentChatModelSubtitle())
            .fontSize(11)
            .fontColor(this.colors.secondary)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }.alignItems(HorizontalAlign.Center)
    }
    .id('chat-header-identity')
    .constraintSize({ minHeight: 44, maxWidth: '100%' })
    .padding({ left: 10, right: 10, top: 4, bottom: 4 })
    .borderRadius(this.colors.corner(18))
    .clipShape(this.colors.cornerClip(18))
    .backgroundColor(this.colors.chat.card)
    .onClick((): void => { this.dismissComposer(); this.openSheet('actions'); })
  }

  @Builder
  chatContextStripBar(strip: XopcChatContextStrip) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 6 }) {
        SymbolGlyph(strip.hasProject ? $r('sys.symbol.folder') : $r('sys.symbol.checkmark_circle'))
          .fontSize(13)
          .fontColor([this.colors.secondary])
          .accessibilityLevel('no')
        if (strip.projectTitle) {
          Text(strip.projectTitle)
            .fontSize(12)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .constraintSize({ maxWidth: strip.taskText ? 120 : 220 })
        }
        if (strip.taskText) {
          if (strip.projectTitle) {
            Text('·').fontSize(12).fontColor(this.colors.tertiary)
          }
          if (strip.needsAttention || strip.isTaskActive) {
            Circle()
              .width(6)
              .height(6)
              .fill(strip.needsAttention ? this.colors.attentionForeground : this.colors.accent)
          }
          Text(strip.taskText)
            .fontSize(12)
            .fontWeight(strip.needsAttention ? FontWeight.Medium : FontWeight.Regular)
            .fontColor(strip.needsAttention ? this.colors.attentionForeground : this.colors.secondary)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .constraintSize({ maxWidth: 180 })
        } else if (strip.environmentTag) {
          Text('·').fontSize(12).fontColor(this.colors.tertiary)
          Text(strip.environmentTag)
            .fontSize(12)
            .fontColor(this.colors.secondary)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .constraintSize({ maxWidth: 140 })
        }
        SymbolGlyph($r('sys.symbol.chevron_right'))
          .fontSize(11)
          .fontColor([this.colors.tertiary])
          .accessibilityLevel('no')
      }.alignItems(VerticalAlign.Center)
    }
    .id('chat-context-bar')
    .constraintSize({ minHeight: 34, maxWidth: 'calc(100% - 24vp)' })
    .padding({ left: 12, right: 10, top: 6, bottom: 6 })
    .margin({ top: 6 })
    .borderRadius(this.colors.corner(14))
    .clipShape(this.colors.cornerClip(14))
    .backgroundColor(strip.needsAttention ? this.colors.attentionFill : this.colors.chat.card)
    .accessibilityText(strip.summaryText)
    .onClick((): void => { this.dismissComposer(); this.openSheet('context'); })
  }

  @Builder
  conversationHeader() {
    Column() {
      if (this.personalConversation) {
        Stack({ alignContent: Alignment.Top }) {
          Row() {
            this.navigationButtons()
            Blank().layoutWeight(1)
            this.conversationActions()
          }.width('100%').padding({ left: 12, right: 12, top: 3 })
          Button({ type: ButtonType.Circle }) {
            XopcPersonalAgentAvatar({ extent: 62,
              activePage: this.activePage && this.phonePage === 0 && !this.searchOpen && !this.sheetOpen,
              moodOverride: this.prompt.prompt ? 'care' : this.chat.runId || this.chat.sending ? 'work' : undefined,
              agentId: this.personalAgent?.agentId ?? '', appearance: this.personalAgent?.appearance ?? 'loopi',
              revision: this.personalAgent?.revision ?? 0 })
          }.id('chat-personal-overview').width(62).height(62).padding(0).backgroundColor(this.colors.chat.card)
            .accessibilityText($r('app.string.personal_overview_open'))
            .onClick((): void => { this.openPersonalOverview(); })
        }.width('100%').height(64)
        XopcPersonalChatActivity({ conversationId: this.chat.selectedId, displayName: this.personalAgent?.displayName ?? '',
          activePage: this.activePage && this.layout.foreground && this.phonePage === 0 && !this.searchOpen && !this.sheetOpen
            && !this.chat.cachedHistory && !this.hasConnectionIssue(),
          reduceMotion: this.layout.reduceMotion, runId: this.chat.runId ?? '', refreshRevision: this.chat.auxiliaryRevision,
          promptId: this.prompt.prompt?.conversationId === this.chat.selectedId ? this.prompt.prompt?.id ?? '' : '',
          onOpenAttention: (): void => { this.openPersonalOverview(); },
          onOpenTask: (taskId: string): void => { this.dismissComposer(); this.onNavigate({ page: 'tasks', itemId: taskId }); } })
      } else if (this.isStandaloneDraft()) {
        Row({ space: 6 }) {
          this.navigationButtons()
          Row() { this.chatIdentityPill() }.layoutWeight(1).justifyContent(FlexAlign.Center)
          this.voiceCallButton()
          this.continuousReadButton()
        }.width('100%').padding({ left: 12, right: 12 }).alignItems(VerticalAlign.Center)
      } else {
        Row({ space: 6 }) {
          this.navigationButtons()
          Row() { this.chatIdentityPill() }.layoutWeight(1).justifyContent(FlexAlign.Center)
          this.conversationActions()
        }.width('100%').padding({ left: 12, right: 12 }).alignItems(VerticalAlign.Center)
      }
      if (!this.personalConversation) {
        if (this.currentContextStrip()) {
          this.chatContextStripBar(this.currentContextStrip()!)
        }
        if (this.desktopChatTarget?.deviceName) {
          if (this.desktopChatTarget?.reselectEndpointId) {
            Button(this.desktopTargetLabel()).height(36).fontSize(12).fontColor(this.colors.chat.action)
              .backgroundColor(this.colors.chat.card).margin({ top: 6 })
              .enabled(!this.desktopReselecting && !this.chat.sending && !this.chat.runId)
              .id('chat-execution-device').onClick((): void => { void this.selectDesktopAgain(); })
          } else {
            Text(this.desktopTargetLabel()).fontSize(12).fontColor(this.colors.secondary).maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .padding({ left: 10, right: 10, top: 5, bottom: 5 })
              .margin({ top: 6 })
              .borderRadius(this.colors.corner(12))
              .backgroundColor(this.colors.chat.card)
              .id('chat-execution-device-label')
          }
        }
      }
    }.id('chat-floating-header').width('100%').alignItems(HorizontalAlign.Center).padding({ top: this.chatTopInset + 8, bottom: 8 })
      .backgroundColor(Color.Transparent).hitTestBehavior(HitTestMode.None)
      .onAreaChange((_previous: Area, current: Area): void => {
        const height = Number(current.height);
        if (height !== this.floatingHeaderHeight) this.floatingHeaderHeight = height;
      })
  }

  @Builder
  chatNetworkNotice() {
    Row({ space: 8 }) {
      SymbolGlyph(this.networkNotice === 'offline' ? $r('sys.symbol.exclamationmark_circle') : $r('sys.symbol.arrow_clockwise'))
        .fontSize(16).fontColor([this.colors.secondary]).accessibilityLevel('no')
      Column({ space: 2 }) {
        Text(this.networkNotice === 'offline' ? $r('app.string.chat_network_offline')
          : this.networkNotice === 'sync' ? $r('app.string.chat_sync_interrupted')
          : this.networkNotice === 'retry' ? $r('app.string.chat_gateway_unreachable') : $r('app.string.chat_network_reconnecting'))
          .fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
        if (this.networkNotice === 'offline' || this.networkNotice === 'retry') {
          Text(this.networkNotice === 'offline' ? $r('app.string.chat_network_auto_resume') : $r('app.string.chat_network_auto_retry'))
            .fontSize(12).fontColor(this.colors.secondary)
        } else if (this.chat.cachedHistory) {
          Text($r('app.string.chat_cached_history')).fontSize(12).fontColor(this.colors.secondary)
        }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start).padding({ top: 8, bottom: 8 })
      if (this.networkNotice === 'retry' || this.networkNotice === 'sync') {
        Button({ type: ButtonType.Normal }) {
          Text(this.networkNotice === 'sync' ? $r('app.string.chat_retry_sync') : $r('app.string.chat_reconnect_now'))
            .fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
        }.id('chat-network-retry').constraintSize({ minWidth: 44, minHeight: 44 }).padding({ left: 8, right: 8 })
          .backgroundColor(Color.Transparent)
          .onClick((): void => {
            if (this.networkNotice === 'sync') void this.chat.retryHistory();
            else this.chat.reconnect();
          })
      }
    }.id('chat-network-notice').width('calc(100% - 24vp)').constraintSize({ minHeight: 44 }).padding({ left: 12, right: 4 })
      .borderRadius(this.colors.corner(14)).backgroundColor(this.colors.chat.card).margin({ top: 4 })
  }

  @Builder
  chatWorkspace() {
    Stack({ alignContent: Alignment.TopStart }) {
    Column() {
      if (this.showConnectionBanner) {
      Column() {
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
      if (this.chat.error && !this.hasChatConnectionError) {
        Row({ space: 8 }) {
          Text(userErrorMessage(this.chat.error, 'generic')).fontSize(12).fontColor(this.colors.secondary).layoutWeight(1).maxLines(3)
          Button($r('app.string.refresh')).height(44).onClick((): void => { this.chat.retryHistory(); })
        }.padding({ left: 16, right: 16 })
      }
      }.width('100%').padding({ top: this.chatHeaderHeight })
        .onAreaChange((_previous: Area, current: Area): void => { this.connectionBannerHeight = Number(current.height); })
      }
      if (this.embedded && (this.showReadAloudPlayback || this.continuousReadSelected)) {
        Row() { this.continuousReadButton() }
          .width('100%').justifyContent(FlexAlign.End).padding({ left: 12, right: 12, bottom: 4 })
      }
      this.conversation()
      Column().width('100%').height(0)
        .bindSheet($$this.generatedVideoOpen, this.generatedVideoDrawer, xopcSheetOptions('large', {
          height: '88%',
          backgroundColor: this.colors.chat.canvas,
          onDisappear: (): void => { if (!this.generatedVideoOpen) this.generatedVideo = undefined; },
        }))
      Column().id('chat-image-editor-sheet-host').width('100%').height(0)
        .bindSheet($$this.imageEditorOpen, this.imageEditorSheet, xopcSheetOptions('medium', {
          height: '75%',
          dragBar: false,
          onDisappear: (): void => { this.imageEditorError = ''; },
        }))
      Column().id('chat-message-detail-sheet-host').width('100%').height(0)
        .bindSheet($$this.messageDetailOpen, this.messageDetailSheet, xopcSheetOptions('immersive', {
          backgroundColor: this.colors.panel,
          onDisappear: (): void => {
            if (this.messageDetailContentTimer !== -1) clearTimeout(this.messageDetailContentTimer);
            this.messageDetailContentTimer = -1;
            this.messageDetailContentReady = false;
          },
        }))
    }.width('100%').height('100%').backgroundColor(this.colors.chat.canvas)
      .bindSheet($$this.sheetOpen, this.optionsSheet, xopcSheetOptions('medium', { height: this.sheetHeight }))
    if (this.chatTopInset > 0) {
      Column().id('chat-status-bar-background').width('100%').height(this.chatTopInset).backgroundColor(this.colors.chat.canvas)
        .hitTestBehavior(HitTestMode.None).accessibilityLevel('no')
    }
    if (!this.embedded && !this.taskId) {
      this.conversationHeader()
    }
    if (this.taskId) {
      XopcTaskChatHeader({ taskId: this.taskId, topInset: this.chatTopInset,
        readAloudAction: () => { this.continuousReadButton(); },
        onClose: (): void => { this.onTaskClose(); },
        onSearch: (): void => { this.openMessageSearch(); },
        onOptions: (): void => { this.openSheet('actions'); } })
    }
    if (this.pinPlayingMusic) {
      Row() { XopcMusicMiniPlayer({ sticky: true, onOpen: (): void => { this.dismissComposer(); } }) }
        .width('100%').justifyContent(FlexAlign.Center)
        .margin({ top: Math.max(this.chatHeaderHeight, this.showConnectionBanner ? this.connectionBannerHeight : 0) + 4 })
        .onAreaChange((_previous: Area, current: Area): void => { this.stickyMusicHeight = Number(current.height); })
        .hitTestBehavior(HitTestMode.Transparent)
    }
    if (this.searchOpen) { this.messageSearchSheet() }
    }.width('100%').height(LayoutPolicy.matchParent)
      .ignoreLayoutSafeArea([LayoutSafeAreaType.SYSTEM], this.embedded || this.layout.systemTopInsetPx <= 0 ? [] : [LayoutSafeAreaEdge.TOP])
      .bindSheet($$this.executionOpen, this.executionDetailSheet, xopcSheetOptions('immersive', {
        height: '92%',
        backgroundColor: this.colors.panel,
        onDisappear: (): void => { this.closeExecutionDetail(); },
      }))
  }

  @Builder
  executionDetailSheet() {
    Column() {
      Row({ space: 12 }) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(20).fontColor([this.colors.foreground])
        }.id('chat-execution-detail-close').width(44).height(44).padding(0).backgroundColor(this.colors.input)
          .accessibilityText($r('app.string.chat_close')).onClick((): void => { this.closeExecutionDetail(); })
        Text($r('app.string.chat_steps')).fontSize(20).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.foreground).layoutWeight(1)
      }.width('100%').padding({ left: 16, right: 16, top: 10, bottom: 12 }).alignItems(VerticalAlign.Center)
      XopcChatExecutionDetailView({ detail: this.executionDetail, row: this.activeExecutionRow,
        loading: this.executionLoading, error: this.executionError,
        onRetry: (): void => { this.refreshExecutionDetail(); } })
    }.id('chat-execution-detail').width('100%').height('100%').backgroundColor(this.colors.panel)
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
      Scroll() {
        Column() {
          if (this.messageDetailContentReady) {
            XopcChatMessageContent({ skillLabels: this.skillLabels, row: this.messageDetailRow, conversationId: this.chat.selectedId,
              textSelectable: true, reasoning: this.context.config?.activityDetail?.effective || 'on',
              onShowExecution: (row: XopcChatRow): void => { this.messageDetailOpen = false; this.openExecutionDetail(row); },
              onNavigate: (route: XopcMobileRoute): void => { this.navigateFromMessageDetail(route); },
              onFillDraft: (text: string): void => { this.fillDraftFromMessageDetail(text); } })
          }
        }.width('100%').padding({ left: 16, right: 16, top: 20, bottom: 32 }).alignItems(HorizontalAlign.Start)
      }.id('chat-message-detail-scroll').layoutWeight(1).width('100%').scrollBar(BarState.Auto)
        .align(Alignment.TopStart).backgroundColor(this.colors.surface)
    }.id('chat-message-detail').width('100%').height('100%').backgroundColor(this.colors.panel)
      .onAppear((): void => {
        this.messageDetailContentTimer = setTimeout((): void => {
          if (this.messageDetailOpen) this.messageDetailContentReady = true;
          this.messageDetailContentTimer = -1;
        }, 0);
      })
  }

  @Builder
  imageEditorSheet() {
    Column({ space: 16 }) {
      Row({ space: 8 }) {
        Text($r('app.string.chat_image_edit')).fontSize(20).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).layoutWeight(1)
        Button($r('app.string.cancel')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.secondary)
          .enabled(!this.imageEditorBusy).onClick((): void => { this.imageEditorOpen = false; })
        Button($r('app.string.chat_image_apply')).height(44).backgroundColor(this.colors.accent).fontColor(this.colors.onAccent)
          .enabled(!this.imageEditorBusy).onClick((): void => { this.applyImageEditor(); })
      }.width('100%')
      Stack({ alignContent: Alignment.Center }) {
        if (this.imageEditorIndex >= 0 && this.imageEditorIndex < this.attachments.length) {
          Image('data:' + this.attachments[this.imageEditorIndex].mimeType + ';base64,' + this.attachments[this.imageEditorIndex].data)
            .width('100%').height('100%').objectFit(ImageFit.Contain).rotate({ angle: this.imageEditorRotation })
            .accessibilityText(this.attachments[this.imageEditorIndex].name)
        }
        if (this.imageEditorBusy) { LoadingProgress().width(32).height(32).color(this.colors.accent) }
      }.width('100%').layoutWeight(1).constraintSize({ minHeight: 220 }).borderRadius(this.colors.corner(16)).clip(true).backgroundColor(this.colors.grouped)
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

  private canShareConversation(): boolean {
    return !!this.chat.selectedId && this.chat.rows.some((row: XopcChatRow): boolean => row.role === 'user' || row.role === 'assistant');
  }

  private openMessageSearch(): void {
    this.dismissComposer();
    this.searchQuery = '';
    this.searchCategory = 'messages';
    this.searchOpen = true;
  }

  private closeMessageSearch(): void {
    this.searchInput.stopEditing();
    this.searchOpen = false;
  }

  private messageSearchContent(row: XopcChatRow): string {
    if (this.searchCategory === 'files' || this.searchCategory === 'images') {
      const images = this.searchCategory === 'images';
      const names = (row.media ?? []).filter((media: XopcHistoryMedia): boolean =>
        media.mimeType.startsWith('image/') === images).map((media: XopcHistoryMedia): string => media.name);
      const artifacts = (row.outcome?.deliverables ?? []).filter((artifact: XopcArtifact): boolean =>
        artifact.kind !== 'site' && (!!artifact.mimeType?.startsWith('image/') || artifact.kind === 'image') === images)
        .map((artifact: XopcArtifact): string => artifact.title);
      return names.concat(artifacts).join('\n');
    }
    if (this.searchCategory === 'links') {
      const links: string[] = row.text.match(/https?:\/\/[^\s<>]+/gi) ?? [];
      const artifacts = (row.outcome?.deliverables ?? []).map((artifact: XopcArtifact): string =>
        artifact.shareUrl ?? artifact.uri ?? '').filter((url: string): boolean => /^https?:\/\//i.test(url));
      return links.concat(artifacts).join('\n');
    }
    return row.role === 'user' ? capabilityText(row.text, this.skillLabels).text : row.text;
  }

  private messageSearchMatches(row: XopcChatRow): boolean {
    const text = this.messageSearchContent(row);
    const query = this.searchQuery.trim().toLowerCase();
    return !!text && (query ? text.toLowerCase().includes(query) : this.searchCategory !== 'messages');
  }

  private messageSearchLabel(category: string): string {
    const zh = appSettings.effectiveLanguage().startsWith('zh');
    if (category === 'files') return zh ? '文件' : 'Files';
    if (category === 'links') return zh ? '链接' : 'Links';
    if (category === 'images') return zh ? '图片' : 'Images';
    return zh ? '消息' : 'Messages';
  }

  @Builder
  messageSearchSheet() {
    Column() {
      List({ space: 12 }) {
        ForEach(this.presentationRows.filter((row: XopcChatRow): boolean => this.messageSearchMatches(row)),
          (row: XopcChatRow) => {
            ListItem() {
              Text(this.messageSearchContent(row)).fontSize(16).fontColor(this.colors.foreground)
                .maxLines(4).textOverflow({ overflow: TextOverflow.Ellipsis }).padding(16)
                .width('100%').backgroundColor(this.colors.panel).borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16))
                .onClick((): void => { this.closeMessageSearch(); this.openMessageDetail(row); }, SEGMENTED_PAGE_TAP_SLOP_VP)
            }
          }, (row: XopcChatRow): string => row.id)
        if (this.searchQuery.trim() && !this.presentationRows.some((row: XopcChatRow): boolean => this.messageSearchMatches(row))) {
          ListItem() {
            Text(appSettings.effectiveLanguage().startsWith('zh') ? '没有找到相关内容' : 'No results')
              .fontSize(14).fontColor(this.colors.secondary)
          }
        }
        if (this.chat.hasOlder && (this.searchQuery.trim() || this.searchCategory !== 'messages')) {
          ListItem() {
            Button($r('app.string.older_messages')).height(44).backgroundColor(Color.Transparent)
              .fontColor(this.colors.accent).enabled(!this.chat.loading)
              .onClick((): void => { void this.chat.loadHistory(true); })
          }
        }
      }.layoutWeight(1).width('100%').padding(20)
      Column({ space: 10 }) {
        XopcSegmentedTabs({ options: [
          { key: 'messages', label: this.messageSearchLabel('messages'), testId: 'chat-search-category-messages' },
          { key: 'files', label: this.messageSearchLabel('files'), testId: 'chat-search-category-files' },
          { key: 'links', label: this.messageSearchLabel('links'), testId: 'chat-search-category-links' },
          { key: 'images', label: this.messageSearchLabel('images'), testId: 'chat-search-category-images' }
        ], selectedKey: this.searchCategory, swipeToSelect: true, onSelect: (key: string): void => {
          this.searchCategory = key;
          this.getUIContext().getFocusController().requestFocus('chat-message-search-input');
        } })
        Row({ space: 10 }) {
          Row({ space: 10 }) {
            SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(20).fontColor([this.colors.secondary])
            TextInput({ text: this.searchQuery, placeholder: $r('app.string.search'), controller: this.searchInput })
              .id('chat-message-search-input').layoutWeight(1).height(48).fontSize(16)
              .backgroundColor(Color.Transparent).fontColor(this.colors.foreground).placeholderColor(this.colors.tertiary)
              .padding(0).defaultFocus(true)
              .onChange((text: string): void => { this.searchQuery = text.slice(0, 500); })
          }.layoutWeight(1).padding({ left: 16, right: 16 }).height(48)
            .backgroundColor(this.colors.input).borderRadius(this.colors.corner(24))
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.xmark')).fontSize(18).fontColor([this.colors.foreground])
          }.id('chat-search-close').width(48).height(48).padding(0).backgroundColor(this.colors.panel)
            .accessibilityText($r('app.string.chat_close')).onClick((): void => { this.closeMessageSearch(); })
        }.width('100%')
      }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 8 })
    }.id('chat-message-search-screen').width('100%').height('100%').padding({ top: this.chatTopInset }).backgroundColor(this.colors.surface)
      .onAppear((): void => {
        setTimeout((): void => { if (this.searchOpen) this.getUIContext().getFocusController().requestFocus('chat-message-search-input'); }, 50);
      })
  }

  @Builder
  optionsSheet() {
    if (this.sheetMode === 'share') {
      XopcConversationShare({ conversationId: this.chat.selectedId, onClose: (): void => { this.sheetOpen = false; } })
    } else if (['context', 'project', 'environment', 'directory', 'references'].includes(this.sheetMode)) {
      XopcChatContext({ model: this.context, initialMode: this.sheetMode, initialReferenceKind: this.referenceKind, refs: this.refs,
        onMode: (mode: string): void => { this.sheetMode = mode; },
        onScope: (projectId: string | null, mode?: string): void => { this.newConversation(this.options.agentId, projectId, mode); },
        onReference: (item: XopcReferenceItem): void => { this.addReference(item); },
        onClose: (): void => { this.sheetOpen = false; }, onRetry: (): void => { this.context.load(this.chat.selectedId); } })
    } else {
    XopcChatOptions({ skillLabels: this.skillLabels, model: this.options, mode: this.sheetMode, personal: this.personalConversation, personalRecord: this.personalAgent,
      conversationTitle: this.chat.title,
      contextSummary: this.contextMenuSummary(),
      canShare: this.canShareConversation(),
      onShare: (): void => { this.sheetMode = 'share'; },
      thinkingBusy: this.chat.sending || !!this.chat.runId,
      onSearch: (): void => { this.sheetOpen = false; this.openMessageSearch(); },
      onContext: (): void => { this.sheetMode = 'context'; },
      onMode: (mode: string): void => { this.sheetMode = mode; }, onClose: (): void => { this.sheetOpen = false; },
      onRetry: (): void => { this.options.load(this.chat.selectedId, this.chat.agentId); },
      hasProjectWorkspace: !!(this.context.summary?.work.project?.id && this.context.summary?.environment),
      onAgentInProject: (agentId: string, projectId: string): void => {
        this.saveDraft();
        this.sheetOpen = false;
        void this.newConversation(agentId, projectId, 'local_checkout');
      },
      onAgent: (id: string): void => {
        this.saveDraft();
        if (id === this.personalAgent?.agentId) {
          this.sheetOpen = false;
          this.onOpenPersonalAgent();
        } else {
          void this.switchAgent(id);
        }
      }, onNewChat: (): void => {
        if (this.automationSetup) return;
        if (this.embedded || this.taskId || this.projectChat) { void this.newConversation(); return; }
        this.sheetOpen = false;
        this.onNewOrdinaryChat();
      },
      onFiles: (): void => { this.sheetOpen = false; this.onNavigate({ page: 'session-files', itemId: this.chat.selectedId }); } })
    }
  }
}
