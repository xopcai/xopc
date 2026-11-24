import { XopcCapabilitiesView } from './CapabilitiesView';
import { XopcCapabilityPanelView } from './CapabilityPanelView';
import { XopcPersonalAgentRecord, XopcPersonalReadTarget } from '../model/personalAgent';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcPersonalAgentSettings } from './PersonalAgentSettings';
import { XopcPersonalAgentOverview } from './PersonalAgentOverview';
import { XopcChatOptionsViewModel } from '../viewmodel/chatOptionsViewModel';
import { XopcChatView } from './ChatView';
import { XopcSessionsView } from './SessionsView';
import { XopcChatSidebar } from './ChatSidebar';
import { chatSidebarDragProgress, shouldOpenChatSidebar } from '../common/chatSidebarGesture';
import { XopcWorkspaceView } from './WorkspaceView';
import { XopcProjectSpaceView } from './ProjectSpaceView';
import { XopcNotesView } from './NotesView';
import { XopcNotesTabView } from './NotesTabView';
import { XopcSpaceLibraryView, XopcLibraryOrigin } from './SpaceLibraryView';
import { XopcChatAttachment } from '../model/chat';
import { XopcChatDrafts } from '../service/chatDrafts';
import { gatewaySession } from '../service/gatewaySession';
import { XopcFilesView } from './FilesView';
import { XopcSettingsView } from './SettingsView';
import { XopcModelSettingsView } from './ModelSettingsView';
import { WORK_PAGE_OPTIONS, XopcProgressView } from './HomeHubs';
import { XopcPersonalGoalsView } from './PersonalView';
import { XopcAutomationRunView } from './AutomationRunView';
import { XopcShareCenterView } from './ShareCenterView';
import { XopcAboutYouView } from './AboutYouView';
import { XopcShareIntakeDialog } from './ShareIntakeDialog';
import { XopcIncomingShare } from '../model/share';
import { XopcChatRepository } from '../repository/chatRepository';
import { XopcWorkspaceRepository } from '../repository/workspaceRepository';
import { appSettings } from '../service/settings';
import { XopcHttpError } from '../service/transport';
import { XopcPersonalAgentViewModel } from '../viewmodel/personalAgentViewModel';
import { userErrorMessage } from '../common/userError';
import { shareIntake, XopcShareIntake } from '../service/shareIntake';
import { XopcMobileRoute } from '../model/home';
import { pushNotifications } from '../service/pushNotifications';
import { notificationNavigation } from '../service/notificationNavigation';
import { XopcNotificationRoute } from '../common/notificationRoute';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { XopcProgressViewModel } from '../viewmodel/homeViewModel';
import { accessibility } from '@kit.AccessibilityKit';
import { XopcContextRef } from '../model/chat';
import { chatDraftIntake } from '../service/chatDraftIntake';
import { XopcBrandLoading, XopcErrorState, XopcPageHeader, XopcPageTitleOption } from './MobileComponents';
import { common } from '@kit.AbilityKit';
import { discussionCapture, XopcDiscussionCapture } from '../service/discussionCapture';
import { XopcDiscussionRecordingPanel } from '../viewmodel/discussionRecordingPanel';
import { XopcDiscussionRecordingPanelView } from './DiscussionRecordingPanel';
import { generatedMusicPlayback, XopcGeneratedMusicPlayback } from '../service/generatedMusicPlayback';
import { XopcMusicMiniPlayer } from './MusicPlaybackView';

@ComponentV2
export struct XopcHomeView {
  @Param openSettingsOnMount: boolean = false;
  @Local profileOptions: XopcChatOptionsViewModel = new XopcChatOptionsViewModel();
  @Local colors: XopcThemeColors = appThemeColors;
  @Local capture: XopcDiscussionCapture = discussionCapture;
  @Local recordingPanel: XopcDiscussionRecordingPanel = new XopcDiscussionRecordingPanel();
  @Local recordingViewportWidth: number = 0;
  @Local recordingViewportHeight: number = 0;
  @Local notesListVisible: boolean = false;
  @Local sidebarOpen: boolean = false;
  @Local sidebarMounted: boolean = false;
  @Local sidebarProgress: number = 0;
  @Computed get sidebarWidth(): number { return Math.min(this.recordingViewportWidth * 0.84, 350); }
  private sidebarDragging: boolean = false;
  private sidebarTransition: number = 0;
  @Local chatReady: boolean = false;
  @Local initialChatError: string = '';
  @Local detailVisible: boolean = false;
  @Local detailRoute: string = '';
  private libraryBackHandler?: () => boolean;
  @Local music: XopcGeneratedMusicPlayback = generatedMusicPlayback;
  @Local layout: XopcLayoutState = layoutState;
  @Local attention: XopcProgressViewModel = new XopcProgressViewModel();
  @Computed get pendingAttention(): number { return this.attention.pendingCount; }
  @Local personalAgent: XopcPersonalAgentViewModel = new XopcPersonalAgentViewModel();
  @Local personalReadTarget: XopcPersonalReadTarget | undefined = undefined;
  @Computed get viewedPersonal(): XopcPersonalReadTarget | undefined {
    const target = this.personalReadTarget;
    if (!this.layout.foreground || this.sidebarMounted || this.detailVisible || this.pendingChatId ||
      target?.conversationId !== this.activeChatId) return undefined;
    return target;
  }
  @Local requestedChatId: string = '';
  @Local activeChatId: string = '';
  @Local requestedChatDraft: string = '';
  @Local chatRequestRevision: number = 0;
  @Local chatFocusRevision: number = 0;
  @Local pendingChatId: string = '';
  @Local intake: XopcShareIntake = shareIntake;
  private chatRepository: XopcChatRepository = new XopcChatRepository();
  private workspaceRepository: XopcWorkspaceRepository = new XopcWorkspaceRepository();
  @Local personalOpening: boolean = false;
  private taskOpening: boolean = false;
  private automationOpening: boolean = false;
  private ordinaryOpening: boolean = false;
  private noteCaptureOpening: boolean = false;
  private disposed: boolean = false;
  private navigationRevision: number = 0;
  private readonly onMotionChange = (reduced: boolean): void => { layoutState.reduceMotion = reduced; };
  private attentionTimer: number = -1;
  private pathStack: NavPathStack = new NavPathStack();

  aboutToAppear(): void {
    layoutState.dismissSidebar = (): boolean => this.closeSidebar();
    this.pathStack.setInterception({
      willShow: (_from: NavDestinationContext | NavBar, to: NavDestinationContext | NavBar): void => {
        this.detailRoute = typeof to === 'string' ? '' : to.pathInfo.name;
        const route = typeof to === 'string' ? undefined : to.pathInfo.param as XopcMobileRoute | undefined;
        this.notesListVisible = this.detailRoute === 'notes-list' ||
          ((this.detailRoute === 'notes' || this.detailRoute === 'inbox') && !route?.itemId);
      }
    });
    pushNotifications.restore();
    const captureContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
    void this.capture.restore(captureContext).catch((caught: Error): void => {
      this.getUIContext().getPromptAction().showToast({ message: userErrorMessage(caught.message, 'save') });
    });
    try {
      layoutState.reduceMotion = accessibility.isAnimationReduceEnabledSync();
      accessibility.onAnimationReduceStateChange(this.onMotionChange);
    } catch (_) { layoutState.reduceMotion = true; }
    notificationNavigation.onTarget = (route: XopcNotificationRoute): void => {
      if (route.target.kind === 'home') { this.navigationRevision++; this.closeSidebar(); this.pathStack.clear(); }
      else if (route.target.kind === 'task' && route.target.taskId) {
        this.pathStack.clear();
        this.navigate({ page: 'progress', itemId: '' });
        this.navigate({ page: 'task-detail', itemId: route.target.taskId });
      } else if (route.target.conversationId) this.openConversationFromList(route.target.conversationId, false);
      else if (route.target.kind === 'automation_run' && route.target.runId) {
        this.navigate({ page: 'automation-run', itemId: route.target.runId });
      }
    };
    if (this.openSettingsOnMount) this.navigate({ page: 'settings', itemId: '' });
    notificationNavigation.consume();
    void this.attention.refresh();
    this.refreshPersonalUnread();
    void this.chatRepository.restoreRecent().catch((): void => {});
    void this.chatRepository.refreshRecent().catch((): void => {});
    void this.restoreInitialChat();
    this.attentionTimer = setInterval((): void => {
      if (!this.layout.foreground) return;
      void this.attention.refresh();
      this.refreshPersonalUnread();
      notificationNavigation.flush();
    }, 15000);
  }
  @Monitor('music.sourceRevision')
  onMusicSource(): void {
    const track = this.music.track;
    if (track) this.openConversationFromList(track.conversationId, false);
  }

  @Computed get showDetailMusic(): boolean {
    return !!this.music.track && this.detailVisible && this.detailRoute !== 'library' && this.detailRoute !== 'notes-list' &&
      this.detailRoute !== 'project-chat' && this.detailRoute !== 'task-conversation' &&
      this.detailRoute !== 'automation-configuration-chat';
  }
  @Computed get recordingDocked(): boolean {
    return this.notesListVisible && this.recordingViewportWidth > 0 && this.recordingViewportWidth < 840;
  }
  @Computed get recordingAvailable(): boolean {
    return !this.recordingPanel.dismissed && (this.capture.active || this.capture.phase === 'completed');
  }

  private collapseNotesRecording(): boolean {
    if (!this.recordingDocked || !this.recordingAvailable || this.recordingPanel.small) return false;
    this.recordingPanel.setCompact(true);
    return true;
  }
  aboutToDisappear(): void {
    chatDraftIntake.clear();
    this.disposed = true;
    layoutState.dismissSidebar = undefined;
    notificationNavigation.onTarget = undefined; clearInterval(this.attentionTimer); this.attention.dispose();
    try { accessibility.offAnimationReduceStateChange(this.onMotionChange); } catch (_) {}
  }
  private navigate(route: XopcMobileRoute): void {
    if (route.page === 'automation-setup' && this.automationOpening) return;
    this.navigationRevision++;
    this.closeSidebar();
    if (route.page === 'project-new-chat') { void this.openProjectChat(route.projectId ?? '', route.title); return; }
    if (route.page === 'task-chat' || (route.page === 'tasks' && route.itemId)) {
      void this.openTaskChat(route);
      return;
    }
    if (route.page === 'automation-setup') { void this.openAutomationChat(route); return; }
    if (route.page === 'understanding-chat') {
      void this.openUnderstandingChat(route);
      return;
    }
    if (route.page === 'chat') {
      if (route.itemId) this.openConversationFromList(route.itemId);
      return;
    }
    this.pathStack.pushPath({ name: route.page, param: route });
  }

  private exitWorkDestination(route: XopcMobileRoute): void {
    this.pathStack.pop();
    if (route.returnToSidebar) this.openSidebar();
  }

  private async openAutomationChat(route: XopcMobileRoute): Promise<void> {
    const revision = this.navigationRevision;
    const destination = this.detailRoute;
    const depth = this.pathStack.size();
    this.automationOpening = true;
    try {
      const id = await this.workspaceRepository.openAutomationConfiguration(route.projectId ?? '',
        route.personalSchedule ? appSettings.effectiveLanguage() : '');
      if (this.disposed || revision !== this.navigationRevision || destination !== this.detailRoute || depth !== this.pathStack.size()) return;
      const target: XopcMobileRoute = { page: 'automation-configuration-chat', itemId: id, prompt: route.prompt };
      this.pathStack.pushPath({ name: target.page, param: target });
    } catch (error) {
      if (!this.disposed && revision === this.navigationRevision && destination === this.detailRoute && depth === this.pathStack.size()) {
        this.getUIContext().getPromptAction().showToast({ message: route.personalSchedule && error instanceof XopcHttpError && error.status === 400
          ? $r('app.string.automation_setup_personal_update_gateway') : userErrorMessage((error as Error).message, 'save') });
      }
    } finally { this.automationOpening = false; }
  }

  private async openProjectChat(projectId: string, title: string = ''): Promise<void> {
    if (!projectId) return;
    const revision = this.navigationRevision;
    try {
      const id = await this.chatRepository.create(projectId);
      if (revision === this.navigationRevision && !this.disposed) {
        this.navigate({ page: 'project-chat', itemId: id, projectId, title, prompt: 'draft' });
      }
    } catch (error) {
      this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') });
    }
  }

  private async openTaskChat(route: XopcMobileRoute): Promise<void> {
    const taskId = route.itemId;
    if (!taskId || this.taskOpening) return;
    const sourceRevision = this.navigationRevision;
    const sourceChat = this.activeChatId;
    const sourceDepth = this.pathStack.size();
    const sourceDestination: XopcMobileRoute | undefined = sourceDepth > 0
      ? this.pathStack.getParamByIndex(sourceDepth - 1) as XopcMobileRoute : undefined;
    if (sourceDestination && sourceDestination.page === 'task-conversation'
      && sourceDestination.itemId === taskId) return;
    this.taskOpening = true;
    try {
      const id = await this.chatRepository.ensureTaskConversation(taskId);
      if (this.navigationRevision !== sourceRevision || this.activeChatId !== sourceChat || this.pathStack.size() !== sourceDepth
        || (sourceDepth > 0 && this.pathStack.getParamByIndex(sourceDepth - 1) !== sourceDestination)) return;
      const target: XopcMobileRoute = {
        page: 'task-conversation', itemId: taskId, title: route.title, prompt: id, projectId: route.projectId
      };
      this.pathStack.pushPath({ name: 'task-conversation', param: target });
    } catch (error) {
      this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') });
    } finally { this.taskOpening = false; }
  }

  private async openUnderstandingChat(route: XopcMobileRoute): Promise<void> {
    try {
      const id = await this.chatRepository.create();
      const refs: XopcContextRef[] = route.itemId ? [{
        kind: 'user_assertion', sourceId: route.itemId,
        expectedVersion: route.version ?? '', title: route.title ?? ''
      }] : [];
      chatDraftIntake.stage(id, route.prompt ?? '', refs);
      this.rememberConversation(id);
      this.switchToChat(id, '', true);
    } catch (error) {
      this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') });
    }
  }
  private async exploreShare(value: XopcIncomingShare, targetId: string): Promise<boolean> {
    try {
      const id = value.targetConversationId || targetId || await this.chatRepository.create();
      await this.intake.addToChat(id);
      if (id !== this.activeChatId) this.rememberConversation(id);
      this.switchToChat(id, '');
      return true;
    } catch (error) { this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') }); return false; }
  }

  private async startNoteCapture(): Promise<void> {
    if (this.recordingAvailable) {
      this.recordingPanel.setCompact(false);
      return;
    }
    if (this.noteCaptureOpening) return;
    this.noteCaptureOpening = true;
    this.recordingPanel.fresh();
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    try {
      await this.music.pause();
      await this.capture.start(context);
    } catch (caught) {
      const message = (caught as Error).message;
      if (!message.startsWith('CONSENT_REQUIRED:')) {
        this.getUIContext().getPromptAction().showToast({ message: userErrorMessage(message, 'save') });
        return;
      }
      const version = Number(message.split(':')[1]);
      try {
        const result = await this.getUIContext().getPromptAction().showDialog({
          title: $r('app.string.capture_consent_title'), message: $r('app.string.capture_consent_message'),
          buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
            { text: $r('app.string.capture_consent_continue'), color: this.colors.accent }]
        });
        if (result.index !== 1) { this.capture.reset(); return; }
        await this.capture.acknowledge(version);
        this.capture.reset();
        await this.music.pause();
        await this.capture.start(context);
      } catch (error) {
        this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') });
      }
    } finally {
      this.noteCaptureOpening = false;
    }
  }

  @Monitor('layout.foreground')
  refreshOnReturn(): void {
    if (this.layout.foreground) void this.attention.refresh();
  }

  @Monitor('layout.foreground', 'sidebarMounted', 'detailVisible', 'pendingChatId')
  refreshPersonalUnread(): void {
    if (this.disposed || !this.layout.foreground) return;
    void this.personalAgent.refreshUnread((): XopcPersonalReadTarget | undefined =>
      this.disposed ? undefined : this.viewedPersonal);
  }

  private openSidebar(): void {
    if (this.sidebarOpen) return;
    this.navigationRevision++;
    this.sidebarOpen = true;
    this.sidebarDragging = false;
    if (this.sidebarMounted) this.settleSidebar(1);
    else {
      this.sidebarProgress = 1;
      this.sidebarMounted = true;
    }
    void this.attention.refresh();
  }

  private closeSidebar(): boolean {
    if (!this.sidebarOpen && !this.sidebarDragging) return false;
    if (this.sidebarOpen) this.navigationRevision++;
    this.sidebarOpen = false;
    this.sidebarDragging = false;
    this.settleSidebar(0);
    return true;
  }

  private settleSidebar(target: number): void {
    const revision = ++this.sidebarTransition;
    if (this.layout.reduceMotion || this.sidebarProgress === target) {
      this.sidebarProgress = target;
      if (target === 0) this.sidebarMounted = false;
      return;
    }
    this.getUIContext().animateTo({ duration: 220, curve: Curve.EaseOut, onFinish: (): void => {
      if (!this.disposed && this.sidebarTransition === revision && target === 0) this.sidebarMounted = false;
    } }, (): void => { this.sidebarProgress = target; });
  }

  private startSidebarDrag(offsetX: number): void {
    if (this.sidebarMounted || this.detailVisible || this.pendingChatId) return;
    this.sidebarDragging = true;
    this.sidebarMounted = true;
    this.updateSidebarDrag(offsetX);
  }

  private updateSidebarDrag(offsetX: number): void {
    if (this.sidebarDragging) this.sidebarProgress = chatSidebarDragProgress(offsetX, this.sidebarWidth);
  }

  private finishSidebarDrag(offsetX: number, velocityX: number): void {
    if (!this.sidebarDragging) return;
    if (shouldOpenChatSidebar(offsetX, velocityX, this.sidebarWidth)) this.openSidebar();
    else this.closeSidebar();
  }

  private switchToChat(id: string, prompt: string, focusComposer: boolean = false): void {
    this.navigationRevision++;
    this.initialChatError = '';
    this.pendingChatId = '';
    this.closeSidebar();
    this.requestedChatId = id;
    this.requestedChatDraft = prompt;
    this.chatRequestRevision++;
    if (focusComposer) this.chatFocusRevision++;
    this.chatReady = true;
    this.pathStack.clear();
  }

  private async restoreInitialChat(unavailableId: string = ''): Promise<void> {
    this.initialChatError = '';
    if (this.chatReady && !unavailableId) {
      void this.personalAgent.refresh();
      return;
    }
    const revision = ++this.chatRequestRevision;
    this.chatReady = false;
    this.activeChatId = '';
    this.pendingChatId = '';
    try {
      const savedId = await this.chatRepository.mainConversation();
      if (this.disposed || revision !== this.chatRequestRevision) return;
      if (savedId && savedId !== unavailableId) {
        this.requestedChatId = savedId;
        void this.personalAgent.refresh();
      } else {
        if (savedId) await this.chatRepository.saveMainConversation('');
        if (this.disposed || revision !== this.chatRequestRevision) return;
        await this.personalAgent.refresh();
        if (this.disposed || revision !== this.chatRequestRevision) return;
        if (this.personalAgent.error) throw new Error(this.personalAgent.error);
        const record = await this.personalAgent.openOrCreate();
        if (this.disposed || revision !== this.chatRequestRevision) return;
        if (!record?.conversationId || record.conversationId === unavailableId) {
          throw new Error(this.personalAgent.error || 'PERSONAL_AGENT_UNAVAILABLE');
        }
        this.requestedChatId = record.conversationId;
      }
      this.requestedChatDraft = '';
      this.chatReady = true;
    } catch (error) {
      if (!this.disposed && revision === this.chatRequestRevision) this.initialChatError = (error as Error).message;
    }
  }

  private async openPersonalChat(): Promise<void> {
    if (this.personalOpening) return;
    this.personalOpening = true;
    const revision = this.navigationRevision;
    try {
      const record = await this.personalAgent.openOrCreate();
      if (this.disposed || revision !== this.navigationRevision) return;
      if (!record) {
        this.getUIContext().getPromptAction().showToast({ message: userErrorMessage(this.personalAgent.error, 'save') });
        return;
      }
      this.openConversationFromList(record.conversationId);
    } finally {
      this.personalOpening = false;
    }
  }

  private async openOrdinaryChat(agentId: string = '', prompt: string = '', agentSetup: boolean = false): Promise<void> {
    if (this.ordinaryOpening) return;
    this.ordinaryOpening = true;
    const revision = this.navigationRevision;
    try {
      const resolved = prompt && !agentId ? (await this.chatRepository.agents()).defaultId : agentId;
      if (this.disposed || revision !== this.navigationRevision) return;
      const language = appSettings.effectiveLanguage().startsWith('zh') ? 'zh-CN' : 'en';
      const id = await this.chatRepository.create(undefined, resolved || undefined, undefined, agentSetup ? language : undefined);
      if (!this.disposed && revision === this.navigationRevision) {
        if (prompt) chatDraftIntake.stage(id, prompt, []);
        this.openConversationFromList(id);
      }
    } catch (error) {
      if (!this.disposed && revision === this.navigationRevision) {
        this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') });
      }
    } finally { this.ordinaryOpening = false; }
  }

  private async useLibraryFile(file: XopcChatAttachment, source?: XopcLibraryOrigin): Promise<void> {
    const revision = gatewaySession.connectionRevision();
    const navigation = this.navigationRevision;
    const profile = gatewaySession.currentProfile();
    if (!profile) throw new Error('NOT_PAIRED');
    const id = await this.chatRepository.create(source?.available ? source.projectId : undefined);
    gatewaySession.assertConnection(revision);
    if (this.disposed || navigation !== this.navigationRevision) return;
    await new XopcChatDrafts().save(JSON.stringify([profile.gatewayId, profile.deviceId, id]), { text: '', refs: [], files: [file] });
    gatewaySession.assertConnection(revision);
    if (!this.disposed && navigation === this.navigationRevision) this.openConversationFromList(id);
  }

  private rememberConversation(id: string): void {
    this.chatRepository.saveMainConversation(id).catch((error: Error): void => {
      if (!this.disposed) this.getUIContext().getPromptAction().showToast({ message: userErrorMessage(error.message, 'save') });
    });
  }

  private openConversationFromList(id: string, remember: boolean = true): void {
    if (remember) this.rememberConversation(id);
    if (id === this.activeChatId && this.chatReady && (!this.pendingChatId || this.pendingChatId === id)) {
      this.navigationRevision++;
      this.closeSidebar();
      this.pathStack.clear();
      return;
    }
    this.switchToChat(id, '');
    this.pendingChatId = id;
  }

  private onConversationUnavailable(id: string): void {
    if (this.disposed || !this.chatReady) return;
    if (id !== (this.pendingChatId || this.activeChatId || this.requestedChatId)) return;
    if (this.personalAgent.record?.conversationId === id) return;
    void this.restoreInitialChat(id);
  }

  @Builder
  destination(page: string, param: Object) {
    if (page === 'sessions' || page === 'sessions-search') {
      XopcSessionsView({ startSearching: page === 'sessions-search', currentId: this.activeChatId,
        personalAgent: this.personalAgent.record,
        onExit: (): void => { this.pathStack.pop(); this.openSidebar(); },
        onOpen: (id: string): void => { this.openConversationFromList(id); },
        onTask: (id: string): void => { this.navigate({ page: 'task-chat', itemId: id }); },
        onNew: (id: string): void => { this.openConversationFromList(id); },
        onDelete: (id: string): void => { this.onConversationUnavailable(id); } })
    } else if (page === 'progress') {
      XopcWorkbenchView({ progress: this.attention,
        onExit: (): void => { this.exitWorkDestination(param as XopcMobileRoute); },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
    } else if (page === 'capability-mcp-setup') {
      NavDestination() {
        XopcCapabilityPanelView({
          category: 'connections',
          itemId: 'mcp:setup',
          itemName: this.getUIContext().getHostContext()?.resourceManager.getStringSync($r('app.string.cap_native_mcp').id) ?? 'MCP',
          initialId: (param as XopcMobileRoute).itemId,
          initialUrl: (param as XopcMobileRoute).prompt ?? '',
          onClose: (): void => { this.pathStack.pop(); },
          onUseInChat: (prompt: string): void => {
            this.pathStack.pop();
            void this.openOrdinaryChat('', prompt, false);
          },
        })
      }.hideTitleBar(true).backgroundColor(this.colors.surface)
    } else if (page === 'capabilities') {
      NavDestination() {
        XopcCapabilitiesView({ personal: this.personalAgent.record, onExit: (): void => { this.pathStack.pop(); },
          onPersonalChanged: (): void => { void this.personalAgent.refresh(); },
          onSetupChat: (prompt: string, agentSetup: boolean): void => { void this.openOrdinaryChat('', prompt, agentSetup); },
          onDeviceChat: (id: string): void => { this.openConversationFromList(id); },
          onDeviceFile: (attachment: XopcChatAttachment): Promise<void> => this.useLibraryFile(attachment),
          onOpenAgent: (id: string, personal: boolean): void => {
            if (personal) void this.openPersonalChat(); else void this.openOrdinaryChat(id);
          } })
      }.hideTitleBar(true).backgroundColor(this.colors.surface)
    } else if (page === 'library') {
      NavDestination() {
        XopcSpaceLibraryView({ initialId: (param as XopcMobileRoute).itemId,
          onExit: (): void => { this.pathStack.pop(); },
          onBackHandler: (handler?: () => boolean): void => { this.libraryBackHandler = handler; },
          onOpenSource: (source: XopcLibraryOrigin): void => {
            if (source.kind === 'task' && source.taskId) this.navigate({ page: 'tasks', itemId: source.taskId });
            else if (source.kind === 'automation' && source.automationRunId) this.navigate({ page: 'automation-run', itemId: source.automationRunId });
            else this.openConversationFromList(source.conversationId);
          }, onUseInChat: (file: XopcChatAttachment, source?: XopcLibraryOrigin): Promise<void> => this.useLibraryFile(file, source) })
      }.hideTitleBar(true).backgroundColor(this.colors.surface).onBackPressed((): boolean => this.libraryBackHandler?.() ?? false)
    } else if (page === 'notes-list' || ((page === 'notes' || page === 'inbox') && !(param as XopcMobileRoute).itemId)) {
      NavDestination() {
        XopcNotesTabView({ activePage: this.notesListVisible && this.detailRoute === page && this.layout.foreground,
          recordingAvailable: this.recordingAvailable,
          initialStatus: page === 'inbox' ? 'inbox' : '',
          onExit: (): void => { this.pathStack.pop(); },
          onStartVoice: (): void => { void this.startNoteCapture(); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
      }.hideTitleBar(true).backgroundColor(this.colors.surface).onBackPressed((): boolean => this.collapseNotesRecording())
    } else if (page === 'personal-goals') {
      NavDestination() {
        XopcPersonalGoalsView({ onExit: (): void => { this.pathStack.pop(); } })
      }.hideTitleBar(true).backgroundColor(this.colors.surface)
    } else if (page === 'personal-agent-overview') {
      NavDestination() {
        XopcPersonalAgentOverview({ record: this.personalAgent.record,
          activePage: this.detailRoute === 'personal-agent-overview' && this.layout.foreground,
          canShareConversation: (param as XopcMobileRoute).canShareConversation ?? false,
          onClose: (): void => { this.pathStack.pop(); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
      }.hideTitleBar(true).backgroundColor(this.colors.surface)
    } else if (page === 'personal-agent-profile') {
      NavDestination() {
        XopcPersonalAgentSettings({ record: this.personalAgent.record, chatOptions: this.profileOptions,
          canShare: (param as XopcMobileRoute).canShareConversation ?? false,
          onReloadModels: (): void => {
            const record = this.personalAgent.record;
            if (record) void this.profileOptions.load(record.conversationId, record.agentId);
          },
          onSaved: (record: XopcPersonalAgentRecord): void => { this.personalAgent.record = record; },
          onClose: (): void => { this.pathStack.pop(); } })
      }.hideTitleBar(true).onHidden((): void => { this.profileOptions.dispose(); this.profileOptions = new XopcChatOptionsViewModel(); })
    } else if (page === 'notes' || page === 'inbox' || page === 'note-create') {
      XopcNotesView({ initialId: (param as XopcMobileRoute).itemId,
        createOnAppear: page === 'note-create', projectId: (param as XopcMobileRoute).projectId ?? '',
        onExit: (): void => { this.pathStack.pop(); },
        onOpenConversation: (id: string): void => { this.navigate({ page: 'chat', itemId: id }); } })
    } else if (page === 'project-detail' || (page === 'projects' && !!(param as XopcMobileRoute).itemId)) {
      XopcProjectSpaceView({ projectId: (param as XopcMobileRoute).itemId, deliveries: this.attention.deliveries,
        attention: this.attention.needsUser,
        onExit: (): void => { this.pathStack.pop(); },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
    } else if (page === 'automation-configuration-chat') {
      NavDestination() {
        Column() {
          XopcPageHeader({ heading: $r('app.string.automation_setup_title'), backVisible: true,
            onBack: (): void => { this.pathStack.pop(); } })
          XopcChatView({ requestedId: (param as XopcMobileRoute).itemId, embedded: true, automationSetup: true,
            activePage: this.detailRoute === 'automation-configuration-chat' && this.layout.foreground,
            intakeText: (param as XopcMobileRoute).prompt ?? '', intakeRevision: 1,
            onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
            .width('100%').layoutWeight(1)
        }.width('100%').height('100%').backgroundColor(this.colors.chat.canvas)
      }.hideTitleBar(true).onBackPressed((): boolean => {
        if (layoutState.dismissChatOverlay?.()) return true;
        this.pathStack.pop(); return true;
      })
    } else if (page === 'project-chat') {
      NavDestination() {
        Column() {
          XopcPageHeader({ heading: (param as XopcMobileRoute).prompt === 'draft' ? $r('app.string.project_new_chat')
            : (param as XopcMobileRoute).title || $r('app.string.conversations'),
            backVisible: true, onBack: (): void => { this.pathStack.pop(); } })
          XopcChatView({ requestedId: (param as XopcMobileRoute).itemId, activePage: true, embedded: true,
            scopedProjectName: (param as XopcMobileRoute).title ?? '', onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
            .width('100%').layoutWeight(1)
        }.width('100%').height('100%').backgroundColor(this.colors.chat.canvas)
      }.hideTitleBar(true).onBackPressed((): boolean => {
        if (layoutState.dismissChatOverlay?.()) return true;
        this.pathStack.pop(); return true;
      })
    } else if (page === 'task-conversation') {
      NavDestination() {
        XopcChatView({ requestedId: (param as XopcMobileRoute).prompt ?? '',
          taskId: (param as XopcMobileRoute).itemId, activePage: this.detailRoute === 'task-conversation', embedded: false,
          onTaskClose: (): void => { this.pathStack.pop(); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
      }.hideTitleBar(true).onBackPressed((): boolean => { if (layoutState.dismissChatOverlay?.()) return true; this.pathStack.pop(); return true; })
    } else if (page === 'task-detail') {
      XopcWorkspaceView({ section: 'tasks', heading: $r('app.string.task_detail_title'), initialId: (param as XopcMobileRoute).itemId,
        onExit: (): void => { this.pathStack.pop(); },
        onNavigate: (route: XopcMobileRoute): void => {
          const depth = this.pathStack.size();
          const previous = depth > 1 ? this.pathStack.getParamByIndex(depth - 2) as XopcMobileRoute : undefined;
          if (route.page === 'task-chat' && previous?.page === 'task-conversation' && previous.itemId === route.itemId) {
            this.pathStack.pop();
          } else this.navigate(route);
        } })
    } else if (page === 'task-edit' || page === 'task-status') {
      XopcWorkspaceView({ section: 'tasks', heading: $r('app.string.tasks'), initialId: (param as XopcMobileRoute).itemId,
        initialTaskAction: page === 'task-edit' ? 'edit' : 'status', onExit: (): void => { this.pathStack.pop(); },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
    } else if (page === 'tasks' || page === 'projects' || page === 'automations' || page === 'project-settings'
      || page === 'task-create' || page === 'project-create') {
      XopcWorkspaceView({ section: page === 'tasks' || page === 'task-create' ? 'tasks'
        : page === 'projects' || page === 'project-settings' || page === 'project-create' ? 'projects' : 'automations',
        heading: page === 'tasks' || page === 'task-create' ? $r('app.string.tasks')
          : page === 'projects' || page === 'project-settings' || page === 'project-create' ? $r('app.string.projects') : $r('app.string.automations'),
        initialId: (param as XopcMobileRoute).itemId, onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
        createOnAppear: page === 'task-create' || page === 'project-create',
        projectId: (param as XopcMobileRoute).projectId ?? '',
        onCreated: (target: string, id: string): void => {
          this.pathStack.pop();
          this.navigate({ page: target, itemId: id });
        },
        onExit: (): void => { this.exitWorkDestination(param as XopcMobileRoute); } })
    } else if (page === 'files' || page === 'session-files' || page === 'file-upload') {
      XopcFilesView({ uploadOnAppear: page === 'file-upload', initialId: page === 'files' ? (param as XopcMobileRoute).itemId : '',
        conversationId: page === 'session-files' ? (param as XopcMobileRoute).itemId : '', onExit: (): void => { this.pathStack.pop(); } })
    } else if (page === 'automation-run') {
      XopcAutomationRunView({ runId: (param as XopcMobileRoute).itemId, onExit: (): void => { this.pathStack.pop(); },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
    } else if (page === 'sharing') {
      XopcShareCenterView({ onExit: (): void => { this.pathStack.pop(); } })
    } else if (page === 'model-settings') {
      XopcModelSettingsView({ onExit: (): void => { this.pathStack.pop(); } })
    } else if (page === 'about-you') {
      XopcAboutYouView({ initialId: (param as XopcMobileRoute).itemId, onExit: (): void => { this.pathStack.pop(); },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
    } else {
      NavDestination() {
        if (page === 'settings') {
          XopcSettingsView({ personalAgent: this.personalAgent.record, section: (param as XopcMobileRoute).itemId, useNavigation: true,
            onExit: (): void => { this.pathStack.pop(); },
            onOpenSection: (section: string): void => { this.navigate({ page: 'settings', itemId: section }); },
            onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
        }
        else { Text($r('app.string.unsupported_route')).fontColor(this.colors.secondary).padding(20) }
      }.hideTitleBar(page === 'settings').title($r('app.string.back')).backgroundColor(this.colors.surface)
    }
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column() {
        Navigation(this.pathStack) {
          Stack({ alignContent: Alignment.TopStart }) {
            Column() {
              if (this.chatReady) {
                XopcChatView({ requestedId: this.requestedChatId, requestRevision: this.chatRequestRevision,
                  personalAgent: this.personalAgent.record,
                  personalUnread: this.viewedPersonal ? this.personalAgent.unreadSnapshot : null,
                  focusRevision: this.chatFocusRevision,
                  intakeRevision: this.intake.chatRevision, intakeText: this.requestedChatDraft,
                  activePage: !this.detailVisible,
                  sidebarSwipeWidth: this.recordingViewportWidth,
                  sidebarSwipeEnabled: !this.sidebarMounted && !this.pendingChatId,
                  onOpenSidebar: (): void => { this.openSidebar(); },
                  onSidebarDragStart: (offsetX: number): void => { this.startSidebarDrag(offsetX); },
                  onSidebarDragUpdate: (offsetX: number): void => { this.updateSidebarDrag(offsetX); },
                  onSidebarDragEnd: (offsetX: number, velocityX: number): void => { this.finishSidebarDrag(offsetX, velocityX); },
                  onSidebarDragCancel: (): void => { if (this.sidebarDragging) this.closeSidebar(); },
                  onNewOrdinaryChat: (): void => { void this.openOrdinaryChat(); },
                  onOpenPersonalAgent: (): void => { void this.openPersonalChat(); },
                  onLocalChatCreated: (id: string): void => { this.rememberConversation(id); },
                  onConversationUnavailable: (id: string): void => { this.onConversationUnavailable(id); },
                  onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
                  onPersonalReadTargetChange: (target?: XopcPersonalReadTarget): void => {
                    const previous = this.personalReadTarget;
                    this.personalReadTarget = target;
                    if (target || previous) this.refreshPersonalUnread();
                  },
                  onConversationChange: (id: string): void => {
                    this.activeChatId = id;
                    if (this.pendingChatId === id) this.pendingChatId = '';
                  } })
              }
            }.id('home-chat-viewport').width('100%').height('100%')
              .accessibilityLevel(this.sidebarOpen ? 'no-hide-descendants' : 'auto')
            if (!this.chatReady || this.pendingChatId) {
              Column() {
                if (this.initialChatError) {
                  Row() {
                    Button({ type: ButtonType.Circle }) {
                      SymbolGlyph($r('sys.symbol.line_3_horizontal')).fontSize(22).fontColor([this.colors.foreground])
                    }.width(44).height(44).padding(0).backgroundColor(this.colors.chat.card)
                      .accessibilityText($r('app.string.chat_open_drawer')).onClick((): void => { this.openSidebar(); })
                  }.width('100%').padding({ left: 12, top: this.getUIContext().px2vp(this.layout.systemTopInsetPx) + 8 })
                  Column() {
                    XopcErrorState({ error: this.initialChatError, onAction: (): void => { void this.restoreInitialChat(); } })
                  }.layoutWeight(1).width('100%').justifyContent(FlexAlign.Center)
                } else {
                  XopcBrandLoading({ reduceMotion: this.layout.reduceMotion })
                }
              }.id('chat-navigation-loading').width('100%').height('100%')
                .justifyContent(FlexAlign.Center).backgroundColor(this.colors.surface)
            }
            if (this.sidebarMounted) {
              XopcChatSidebar({ personalAgent: this.personalAgent.record, personalBusy: this.personalOpening || this.personalAgent.creating,
                reveal: this.sidebarProgress, drawerWidth: this.sidebarWidth, interactive: this.sidebarOpen,
                currentId: this.activeChatId, pendingAttention: this.pendingAttention,
                personalUnread: this.personalAgent.unreadSnapshot?.unreadCount ?? 0,
                onClose: (): void => { this.closeSidebar(); },
                onDismissDrag: (offset: number): void => {
                  if (this.sidebarOpen) this.sidebarProgress = 1 - chatSidebarDragProgress(-offset, this.sidebarWidth);
                },
                onDismissEnd: (offset: number, velocity: number): void => {
                  if (!this.sidebarOpen) return;
                  if (shouldOpenChatSidebar(-offset, -velocity, this.sidebarWidth)) this.closeSidebar();
                  else this.settleSidebar(1);
                },
                onPersonal: (): void => { void this.openPersonalChat(); },
                onNew: (): void => { void this.openOrdinaryChat(); },
                onConversation: (id: string): void => { this.openConversationFromList(id); },
                onDelete: (id: string): void => { this.onConversationUnavailable(id); },
                onNavigate: (route: XopcMobileRoute): void => {
                  if (route.page === 'workbench' || route.page === 'automations') {
                    this.navigate({ page: route.page === 'workbench' ? 'progress' : route.page,
                      itemId: '', returnToSidebar: true });
                  } else this.navigate(route);
                } })
            }
          }.width('100%').height(LayoutPolicy.matchParent)
            .ignoreLayoutSafeArea([LayoutSafeAreaType.SYSTEM], [LayoutSafeAreaEdge.TOP])
        }.hideTitleBar(true).mode(NavigationMode.Stack).navDestination(this.destination)
          .onNavBarStateChange((shown: boolean): void => { this.detailVisible = !shown; })
          .width('100%').layoutWeight(1).backgroundColor(this.colors.surface)
        if (this.showDetailMusic) {
          Column() { XopcMusicMiniPlayer() }.width('100%').padding({ top: 4, bottom: 4 })
            .backgroundColor(this.colors.surface)
        }
      }.width('100%').height('100%')
      if (this.recordingAvailable && (!this.recordingDocked || !this.recordingPanel.small) &&
        this.recordingViewportWidth > 0 && this.recordingViewportHeight > 0) {
        if (this.recordingDocked) {
          Column() {}.width('100%').height('100%').backgroundColor('#330F172A').zIndex(49)
            .accessibilityLevel('no').onClick((): void => { this.collapseNotesRecording(); })
        }
        XopcDiscussionRecordingPanelView({ panel: this.recordingPanel,viewportWidth: this.recordingViewportWidth,viewportHeight: this.recordingViewportHeight,
          docked: this.recordingDocked,
          onOpenNote: (id: string): void => { this.recordingPanel.setCompact(true); this.navigate({ page: 'notes',itemId: id }); },
          onRecovery: (): void => { this.pathStack.clear(); this.navigate({ page: 'notes-list', itemId: '' }); void this.capture.refreshPending(this.getUIContext().getHostContext() as common.UIAbilityContext); } })
      }
      XopcShareIntakeDialog({ currentConversationId: this.activeChatId, onExplore: async (value: XopcIncomingShare, targetId: string): Promise<boolean> => await this.exploreShare(value, targetId),
        onSaved: (noteId: string): void => { this.navigate({ page: 'notes', itemId: noteId }); } })
    }.width('100%').height('100%')
      .onAreaChange((_previous: Area,current: Area): void => { this.recordingViewportWidth = Number(current.width); this.recordingViewportHeight = Number(current.height); })

  }
}

@ComponentV2
struct XopcWorkbenchView {
  @Param progress: XopcProgressViewModel = new XopcProgressViewModel();
  @Event onExit: () => void = (): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local selectedIndex: number = 0;
  @Local projectSearchOpen: boolean = false;
  @Local refreshRevision: number = 0;
  private pager: SwiperController = new SwiperController();
  private shown: boolean = false;

  private selectPage(page: string): void {
    const index = WORK_PAGE_OPTIONS.findIndex((option: XopcPageTitleOption): boolean => option.key === page);
    if (index < 0 || index === this.selectedIndex) return;
    this.pager.changeIndex(index, !this.layout.reduceMotion && Math.abs(index - this.selectedIndex) === 1);
  }

  private goBack(): void {
    if (this.selectedIndex === 2 && this.projectSearchOpen) {
      this.projectSearchOpen = false;
      this.getUIContext().getFocusController().clearFocus();
    } else this.onExit();
  }

  private toggleProjectSearch(): void {
    this.projectSearchOpen = !this.projectSearchOpen;
    if (!this.projectSearchOpen) this.getUIContext().getFocusController().clearFocus();
  }

  build() {
    NavDestination() {
      Column() {
        XopcPageHeader({ heading: WORK_PAGE_OPTIONS[this.selectedIndex].label, titleOptions: WORK_PAGE_OPTIONS,
          selectedTitle: WORK_PAGE_OPTIONS[this.selectedIndex].key, titleMenuId: 'work-page-menu',
          onSelectTitle: (page: string): void => { this.selectPage(page); }, backVisible: true,
          onBack: (): void => { this.goBack(); }, searchId: this.selectedIndex === 2 ? 'projects-open-search' : '',
          searchOpen: this.projectSearchOpen, onSearch: (): void => { this.toggleProjectSearch(); },
          actionLabel: this.selectedIndex === 0 ? '' : this.selectedIndex === 1 ? $r('app.string.new_task') : $r('app.string.new_project'),
          actionIcon: $r('sys.symbol.plus'), onAction: (): void => {
            this.onNavigate({ page: this.selectedIndex === 1 ? 'task-create' : 'project-create', itemId: '' });
          } }).id('workbench-header')
        Swiper(this.pager) {
          XopcProgressView({ activePage: true, model: this.progress, onExit: this.onExit,
            onSelectWorkPage: (page: string): void => { this.selectPage(page); }, onNavigate: this.onNavigate })
          XopcWorkspaceView({ section: 'tasks', heading: $r('app.string.tasks'), embeddedInWorkbench: true,
            workbenchRefresh: this.refreshRevision, onExit: this.onExit, onNavigate: this.onNavigate })
          XopcWorkspaceView({ section: 'projects', heading: $r('app.string.projects'), embeddedInWorkbench: true,
            workbenchRefresh: this.refreshRevision, workbenchSearchOpen: this.projectSearchOpen,
            onExit: this.onExit, onNavigate: this.onNavigate })
        }.id('work-page-pager').index(this.selectedIndex).loop(false).indicator(false).cachedCount(2)
          .duration(this.layout.reduceMotion ? 0 : 230)
          .width('100%').layoutWeight(1).clip(true)
          .onChange((index: number): void => {
            this.selectedIndex = index;
            this.getUIContext().getFocusController().clearFocus();
          })
      }.width('100%').height('100%')
    }.hideTitleBar(true).backgroundColor(this.colors.surface)
      .onShown((): void => {
        if (this.shown) {
          this.refreshRevision++;
          void this.progress.refresh();
        }
        this.shown = true;
      })
      .onBackPressed((): boolean => { this.goBack(); return true; })
  }
}
