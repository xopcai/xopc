import { xopcConfirmDialog, xopcSheetOptions, xopcToast } from '../common/dialogActions';
import {
  XOPC_MOTION_STANDARD_MS,
  xopcPagerAnimated,
  xopcPagerDuration,
  xopcWithMotion,
} from '../common/motionTokens';
import {
  bottomChromeInsetFor,
  shouldAllowSidebarEdgeSwipe,
  shouldMarkPersonalViewed,
  shouldShowBottomTabBar,
  XopcCoreMobileTab,
  XopcMobileTab,
  XopcMobileTabNavState,
} from '../common/mobileTabNavigation';
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
import { XopcFloatingTabBar } from './FloatingTabBar';
import {
  CHAT_SIDEBAR_BACK_EDGE,
  CHAT_SIDEBAR_PAN_DISTANCE_VP,
  chatSidebarDragProgress,
  shouldOpenChatSidebar,
} from '../common/chatSidebarGesture';
import { XopcWorkspaceView } from './WorkspaceView';
import { XopcProjectSpaceView } from './ProjectSpaceView';
import { XopcNotesView } from './NotesView';
import { XopcNotesTabView } from './NotesTabView';
import { XopcSpaceLibraryView, XopcLibraryOrigin } from './SpaceLibraryView';
import { XopcChatAttachment, XopcContextRef, XopcSessionItem } from '../model/chat';
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
import { chatDraftIntake } from '../service/chatDraftIntake';
import {
  XopcBrandLoading,
  XopcErrorState,
  XopcListSkeleton,
  XopcPageHeader,
  XopcPageTitleOption,
  XopcSheetHeader,
} from './MobileComponents';
import { common } from '@kit.AbilityKit';
import { discussionCapture, XopcDiscussionCapture } from '../service/discussionCapture';
import { XopcDiscussionRecordingPanel } from '../viewmodel/discussionRecordingPanel';
import { XopcDiscussionRecordingPanelView } from './DiscussionRecordingPanel';
import { generatedMusicPlayback, XopcGeneratedMusicPlayback } from '../service/generatedMusicPlayback';
import { XopcMusicMiniPlayer } from './MusicPlaybackView';
import { voiceCall, XopcVoiceCall } from '../service/voiceCall';

const ROOT_EDGE_SWIPE_BAND_VP: number = 72;

@ComponentV2
export struct XopcHomeView {
  @Param gatewayId: string = '';
  @Param openSettingsOnMount: boolean = false;
  @Local profileOptions: XopcChatOptionsViewModel = new XopcChatOptionsViewModel();
  @Local colors: XopcThemeColors = appThemeColors;
  @Local capture: XopcDiscussionCapture = discussionCapture;
  @Local recordingPanel: XopcDiscussionRecordingPanel = new XopcDiscussionRecordingPanel();
  @Local recordingViewportWidth: number = 0;
  @Local recordingViewportHeight: number = 0;
  @Local sidebarOpen: boolean = false;
  @Local sidebarMounted: boolean = false;
  @Local sidebarProgress: number = 0;
  @Computed get sidebarWidth(): number { return Math.min(this.recordingViewportWidth * 0.84, 350); }
  private sidebarDragging: boolean = false;
  private sidebarTransition: number = 0;

  // Multi-stack tab navigation state
  private tabNav: XopcMobileTabNavState = new XopcMobileTabNavState();
  private adaStack: NavPathStack = new NavPathStack();
  private workbenchStack: NavPathStack = new NavPathStack();
  private notesStack: NavPathStack = new NavPathStack();
  private libraryStack: NavPathStack = new NavPathStack();
  @Local selectedTab: XopcMobileTab = 'ada';
  @Local adaDepth: number = 0;
  @Local workbenchDepth: number = 0;
  @Local notesDepth: number = 0;
  @Local libraryDepth: number = 0;
  @Local adaTopRoute: string = '';
  @Local workbenchTopRoute: string = '';
  @Local notesTopRoute: string = '';
  @Local libraryTopRoute: string = '';
  @Local adaScrollRevision: number = 0;
  @Local workbenchResetRevision: number = 0;
  @Local notesScrollRevision: number = 0;
  @Local libraryScrollRevision: number = 0;

  // Isolated Ada (L0) state vs ordinary session-chat (L1) & project-chat (L1) state
  @Local adaChatReady: boolean = false;
  @Local initialChatError: string = '';
  @Local adaConversationId: string = '';
  @Local adaRequestRevision: number = 0;
  @Local adaFocusRevision: number = 0;
  @Local adaRequestedDraft: string = '';
  @Local sessionChatId: string = '';
  @Local sessionChatRequestRevision: number = 0;
  @Local sessionChatFocusRevision: number = 0;
  @Local projectConversationId: string = '';

  // Quick conversation switcher sheet for session-chat
  @Local sessionSwitcherOpen: boolean = false;
  @Local switcherItems: XopcSessionItem[] = [];
  @Local switcherLoading: boolean = false;

  // Overlay & back handlers
  @Local chatOverlayActive: boolean = false;
  @Local libraryDetailOpen: boolean = false;
  private libraryBackHandler?: () => boolean;
  private workbenchBackHandler?: () => boolean;
  @Local music: XopcGeneratedMusicPlayback = generatedMusicPlayback;
  @Local call: XopcVoiceCall = voiceCall;
  @Local layout: XopcLayoutState = layoutState;
  @Local attention: XopcProgressViewModel = new XopcProgressViewModel();
  @Computed get pendingAttention(): number { return this.attention.pendingCount; }
  @Local personalAgent: XopcPersonalAgentViewModel = new XopcPersonalAgentViewModel();
  @Local personalReadTarget: XopcPersonalReadTarget | undefined = undefined;
  @Local intake: XopcShareIntake = shareIntake;
  private chatRepository: XopcChatRepository = new XopcChatRepository();
  private workspaceRepository: XopcWorkspaceRepository = new XopcWorkspaceRepository();
  private taskOpening: boolean = false;
  private automationOpening: boolean = false;
  private ordinaryOpening: boolean = false;
  private noteCaptureOpening: boolean = false;
  private disposed: boolean = false;
  private navigationRevision: number = 0;
  private readonly onMotionChange = (reduced: boolean): void => { layoutState.reduceMotion = reduced; };
  private attentionTimer: number = -1;

  @Computed get activeStackDepth(): number {
    if (this.selectedTab === 'workbench') return this.workbenchDepth;
    if (this.selectedTab === 'notes') return this.notesDepth;
    if (this.selectedTab === 'library') return this.libraryDepth;
    return this.adaDepth;
  }

  @Computed get detailRoute(): string {
    if (this.selectedTab === 'workbench') return this.workbenchTopRoute;
    if (this.selectedTab === 'notes') return this.notesTopRoute;
    if (this.selectedTab === 'library') return this.libraryTopRoute;
    return this.adaTopRoute;
  }

  @Computed get detailVisible(): boolean {
    return this.activeStackDepth > 0;
  }

  @Computed get fullScreenOverlayActive(): boolean {
    return this.chatOverlayActive || this.libraryDetailOpen || this.sessionSwitcherOpen
      || !!this.intake.pending || (this.call.phase !== 'idle' && this.call.expanded) || this.music.expanded;
  }

  @Computed get showBottomTabBar(): boolean {
    return shouldShowBottomTabBar(this.activeStackDepth, this.layout.keyboardVisible, this.fullScreenOverlayActive);
  }

  @Computed get bottomChromeInset(): number {
    return bottomChromeInsetFor(this.showBottomTabBar);
  }

  @Computed get allowSidebarEdgeSwipe(): boolean {
    return shouldAllowSidebarEdgeSwipe(this.activeStackDepth, this.sidebarMounted, this.fullScreenOverlayActive);
  }

  @Computed get viewedPersonal(): XopcPersonalReadTarget | undefined {
    const target = this.personalReadTarget;
    if (!this.adaChatReady || !target || target.conversationId !== this.adaConversationId) return undefined;
    if (!shouldMarkPersonalViewed(this.selectedTab, this.activeStackDepth, this.sidebarMounted,
      this.layout.foreground, this.fullScreenOverlayActive)) {
      return undefined;
    }
    return target;
  }

  @Computed get visibleConversationId(): string {
    if (this.detailRoute === 'session-chat') return this.sessionChatId;
    if (this.detailRoute === 'project-chat') return this.projectConversationId;
    return '';
  }

  @Computed get notesListVisible(): boolean {
    return (this.selectedTab === 'notes' && this.notesDepth === 0) || this.detailRoute === 'notes-list';
  }

  @Computed get showGlobalMusicMiniPlayer(): boolean {
    if (!this.music.track) return false;
    if (this.activeStackDepth === 0) {
      return this.selectedTab === 'workbench' || this.selectedTab === 'library';
    }
    return this.detailRoute !== 'library' && this.detailRoute !== 'notes-list'
      && this.detailRoute !== 'session-chat' && this.detailRoute !== 'project-chat'
      && this.detailRoute !== 'task-conversation' && this.detailRoute !== 'automation-configuration-chat';
  }

  @Computed get recordingDocked(): boolean {
    return this.notesListVisible && this.recordingViewportWidth > 0 && this.recordingViewportWidth < 840;
  }

  @Computed get recordingAvailable(): boolean {
    return !this.recordingPanel.dismissed && (this.capture.active || this.capture.phase === 'completed');
  }

  private stackFor(tab: XopcMobileTab): NavPathStack {
    if (tab === 'workbench') return this.workbenchStack;
    if (tab === 'notes') return this.notesStack;
    if (tab === 'library') return this.libraryStack;
    return this.adaStack;
  }

  private activeStack(): NavPathStack {
    return this.stackFor(this.selectedTab);
  }

  private updateTabStackMetrics(tab: XopcCoreMobileTab, stack: NavPathStack, topName: string): void {
    const depth = stack.size();
    const routes: XopcMobileRoute[] = [];
    for (let index = 0; index < depth; index++) {
      const param = stack.getParamByIndex(index) as XopcMobileRoute | undefined;
      if (param) routes.push(param);
    }
    this.tabNav.syncStack(tab, routes);
    if (tab === 'ada') {
      this.adaDepth = depth;
      this.adaTopRoute = depth > 0 ? topName : '';
      if (this.adaTopRoute !== 'session-chat') this.sessionChatId = '';
    } else if (tab === 'workbench') {
      this.workbenchDepth = depth;
      this.workbenchTopRoute = depth > 0 ? topName : '';
    } else if (tab === 'notes') {
      this.notesDepth = depth;
      this.notesTopRoute = depth > 0 ? topName : '';
    } else {
      this.libraryDepth = depth;
      this.libraryTopRoute = depth > 0 ? topName : '';
    }
  }

  private attachStackInterception(tab: XopcCoreMobileTab, stack: NavPathStack): void {
    stack.setInterception({
      willShow: (_from: NavDestinationContext | NavBar, to: NavDestinationContext | NavBar): void => {
        const name = typeof to === 'string' ? '' : to.pathInfo.name;
        this.updateTabStackMetrics(tab, stack, name);
      },
      didShow: (_from: NavDestinationContext | NavBar, to: NavDestinationContext | NavBar): void => {
        const name = typeof to === 'string' ? '' : to.pathInfo.name;
        this.updateTabStackMetrics(tab, stack, name);
      },
    });
  }

  aboutToAppear(): void {
    layoutState.dismissSidebar = (): boolean => this.closeSidebar();
    layoutState.handleBackPress = (): boolean => this.handleBackPress();
    this.attachStackInterception('ada', this.adaStack);
    this.attachStackInterception('workbench', this.workbenchStack);
    this.attachStackInterception('notes', this.notesStack);
    this.attachStackInterception('library', this.libraryStack);
    pushNotifications.restore();
    const captureContext = this.getUIContext().getHostContext() as common.UIAbilityContext;
    void this.capture.restore(captureContext).catch((caught: Error): void => {
      xopcToast(this.getUIContext(), userErrorMessage(caught.message, 'save'));
    });
    try {
      layoutState.reduceMotion = accessibility.isAnimationReduceEnabledSync();
      accessibility.onAnimationReduceStateChange(this.onMotionChange);
    } catch (_) { layoutState.reduceMotion = true; }
    notificationNavigation.onTarget = (route: XopcNotificationRoute): void => {
      this.applyNotificationRoute(route);
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

  aboutToDisappear(): void {
    chatDraftIntake.clear();
    this.disposed = true;
    layoutState.dismissSidebar = undefined;
    layoutState.handleBackPress = undefined;
    layoutState.bottomChromeInset = 0;
    notificationNavigation.onTarget = undefined;
    clearInterval(this.attentionTimer);
    this.attention.dispose();
    try { accessibility.offAnimationReduceStateChange(this.onMotionChange); } catch (_) {}
  }

  @Monitor('bottomChromeInset')
  syncBottomChromeInset(): void {
    this.layout.bottomChromeInset = this.bottomChromeInset;
  }

  @Monitor('gatewayId')
  onGatewayIdChanged(): void {
    if (!this.gatewayId) return;
    this.resetForGatewaySwitch();
    void this.attention.refresh();
    this.refreshPersonalUnread();
    void this.restoreInitialChat();
  }

  private resetForGatewaySwitch(): void {
    this.navigationRevision++;
    this.tabNav.resetForGatewaySwitch();
    this.adaStack.clear(false);
    this.workbenchStack.clear(false);
    this.notesStack.clear(false);
    this.libraryStack.clear(false);
    this.sidebarOpen = false;
    this.sidebarMounted = false;
    this.sidebarProgress = 0;
    this.sidebarDragging = false;
    this.selectedTab = 'ada';
    this.adaDepth = 0;
    this.workbenchDepth = 0;
    this.notesDepth = 0;
    this.libraryDepth = 0;
    this.adaTopRoute = '';
    this.workbenchTopRoute = '';
    this.notesTopRoute = '';
    this.libraryTopRoute = '';
    this.adaChatReady = false;
    this.adaConversationId = '';
    this.initialChatError = '';
    this.sessionChatId = '';
    this.projectConversationId = '';
    this.sessionSwitcherOpen = false;
    this.personalReadTarget = undefined;
  }

  @Monitor('music.sourceRevision')
  onMusicSource(): void {
    const track = this.music.track;
    if (track) this.openConversationTarget(track.conversationId);
  }

  private collapseNotesRecording(): boolean {
    if (!this.recordingDocked || !this.recordingAvailable || this.recordingPanel.small) return false;
    this.recordingPanel.setCompact(true);
    return true;
  }

  private popActiveStack(): void {
    const stack = this.activeStack();
    if (stack.size() > 0) {
      this.tabNav.popTab(this.selectedTab);
      stack.pop();
    }
  }

  private handleBackPress(): boolean {
    const hasOverlay = this.layout.keyboardVisible
      || this.sessionSwitcherOpen
      || (layoutState.dismissChatOverlay?.() ?? false)
      || this.collapseNotesRecording()
      || (this.selectedTab === 'library' && this.libraryDepth === 0 && (this.libraryBackHandler?.() ?? false))
      || (this.selectedTab === 'workbench' && this.workbenchDepth === 0 && (this.workbenchBackHandler?.() ?? false));
    if (hasOverlay) {
      if (this.layout.keyboardVisible) this.getUIContext().getFocusController().clearFocus();
      if (this.sessionSwitcherOpen) this.sessionSwitcherOpen = false;
      return true;
    }
    this.tabNav.sidebarOpen = this.sidebarOpen || this.sidebarDragging;
    const action = this.tabNav.resolveBackPress(false);
    if (action === 'sidebar') {
      this.closeSidebar();
      return true;
    }
    if (action === 'pop') {
      this.activeStack().pop();
      return true;
    }
    if (action === 'switch-ada') {
      this.selectedTab = 'ada';
      return true;
    }
    return false;
  }

  private selectTab(tab: XopcMobileTab): void {
    this.navigationRevision++;
    this.closeSidebar();
    const result = this.tabNav.selectTab(tab);
    this.selectedTab = this.tabNav.selectedTab;
    if (result === 'popped-to-root') {
      this.stackFor(tab).clear();
      return;
    }
    if (result === 'scroll-to-top') {
      if (tab === 'ada') this.adaScrollRevision++;
      else if (tab === 'workbench') this.workbenchResetRevision++;
      else if (tab === 'notes') this.notesScrollRevision++;
      else if (tab === 'library') this.libraryScrollRevision++;
    } else if (tab === 'workbench') {
      void this.attention.refresh();
    }
  }

  private switchToAdaRoot(): void {
    this.navigationRevision++;
    this.closeSidebar();
    this.tabNav.selectedTab = 'ada';
    this.tabNav.clearTab('ada');
    this.selectedTab = 'ada';
    this.adaStack.clear();
  }

  private applyNotificationRoute(route: XopcNotificationRoute): void {
    this.navigationRevision++;
    this.closeSidebar();
    const personalId = this.personalAgent.record?.conversationId || this.adaConversationId;
    const plan = this.tabNav.applyNotificationRoute(route, personalId);
    this.selectedTab = plan.tab;
    const stack = this.stackFor(plan.tab);
    stack.clear(false);
    for (const item of plan.routes) {
      if (item.page === 'session-chat') this.sessionChatId = item.itemId;
      stack.pushPath({ name: item.page, param: item }, false);
    }
  }

  private navigate(route: XopcMobileRoute): void {
    if (route.page === 'automation-setup' && this.automationOpening) return;
    this.navigationRevision++;
    this.closeSidebar();
    if (route.page === 'workbench' || route.page === 'progress') {
      this.selectTab('workbench');
      return;
    }
    if (route.page === 'notes-list' && !route.itemId) {
      this.selectTab('notes');
      return;
    }
    if (route.page === 'library' && !route.itemId) {
      this.selectTab('library');
      return;
    }
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
    if (route.page === 'project-chat') this.projectConversationId = route.itemId ?? '';
    if (route.page === 'chat') {
      if (route.itemId) this.openConversationTarget(route.itemId);
      return;
    }
    const transition = this.tabNav.pushOnActiveTab(route);
    if (transition.operation === 'push' && transition.route) {
      this.stackFor(transition.tab).pushPath({ name: transition.route.page, param: transition.route });
    } else if (transition.operation === 'pop') {
      this.stackFor(transition.tab).pop();
    }
  }

  private openSidebarRoute(route: XopcMobileRoute): void {
    this.navigationRevision++;
    this.closeSidebar();
    const transition = this.tabNav.openSidebarLowFrequencyRoute(route);
    if (transition.route) {
      this.stackFor(transition.tab).pushPath({ name: transition.route.page, param: transition.route });
    }
  }

  private async openAutomationChat(route: XopcMobileRoute): Promise<void> {
    const revision = this.navigationRevision;
    const tab = this.selectedTab;
    const stack = this.stackFor(tab);
    const destination = this.detailRoute;
    const depth = stack.size();
    this.automationOpening = true;
    try {
      const id = await this.workspaceRepository.openAutomationConfiguration(route.projectId ?? '',
        route.personalSchedule ? appSettings.effectiveLanguage() : '');
      if (this.disposed || revision !== this.navigationRevision || tab !== this.selectedTab
        || destination !== this.detailRoute || depth !== stack.size()) return;
      const target: XopcMobileRoute = { page: 'automation-configuration-chat', itemId: id, prompt: route.prompt };
      this.tabNav.pushOnTab(tab, target);
      stack.pushPath({ name: target.page, param: target });
    } catch (error) {
      if (!this.disposed && revision === this.navigationRevision && tab === this.selectedTab
        && destination === this.detailRoute && depth === stack.size()) {
        xopcToast(this.getUIContext(), route.personalSchedule && error instanceof XopcHttpError && error.status === 400
          ? $r('app.string.automation_setup_personal_update_gateway') : userErrorMessage((error as Error).message, 'save'));
      }
    } finally { this.automationOpening = false; }
  }

  private async openProjectChat(projectId: string, title: string = ''): Promise<void> {
    if (!projectId) return;
    const revision = this.navigationRevision;
    try {
      const id = await this.chatRepository.create(projectId);
      if (revision === this.navigationRevision && !this.disposed) {
        this.navigate({ page: 'project-chat', itemId: id, projectId, title });
      }
    } catch (error) {
      xopcToast(this.getUIContext(), userErrorMessage((error as Error).message, 'save'));
    }
  }

  private closeProjectChat(): void {
    this.navigationRevision++;
    this.closeSidebar();
    this.popActiveStack();
  }

  private async openTaskChat(route: XopcMobileRoute): Promise<void> {
    const taskId = route.itemId;
    if (!taskId || this.taskOpening) return;
    const sourceRevision = this.navigationRevision;
    const sourceTab = this.selectedTab;
    const stack = this.stackFor(sourceTab);
    const sourceDepth = stack.size();
    const sourceDestination: XopcMobileRoute | undefined = sourceDepth > 0
      ? stack.getParamByIndex(sourceDepth - 1) as XopcMobileRoute : undefined;
    if (sourceDestination && sourceDestination.page === 'task-conversation'
      && sourceDestination.itemId === taskId) return;
    this.taskOpening = true;
    try {
      const id = await this.chatRepository.ensureTaskConversation(taskId);
      if (this.navigationRevision !== sourceRevision || this.selectedTab !== sourceTab || stack.size() !== sourceDepth
        || (sourceDepth > 0 && stack.getParamByIndex(sourceDepth - 1) !== sourceDestination)) return;
      const target: XopcMobileRoute = {
        page: 'task-conversation', itemId: taskId, title: route.title, prompt: id, projectId: route.projectId
      };
      const transition = this.tabNav.pushOnTab(sourceTab, target);
      if (transition.operation === 'pop') stack.pop();
      else if (transition.operation === 'push') stack.pushPath({ name: 'task-conversation', param: target });
    } catch (error) {
      xopcToast(this.getUIContext(), userErrorMessage((error as Error).message, 'save'));
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
      this.openSessionChatFromSidebar(id, '', true);
    } catch (error) {
      xopcToast(this.getUIContext(), userErrorMessage((error as Error).message, 'save'));
    }
  }

  private async exploreShare(value: XopcIncomingShare, targetId: string): Promise<boolean> {
    try {
      const id = value.targetConversationId || targetId || await this.chatRepository.create();
      await this.intake.addToChat(id);
      this.openConversationTarget(id);
      return true;
    } catch (error) {
      xopcToast(this.getUIContext(), userErrorMessage((error as Error).message, 'save'));
      return false;
    }
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
        xopcToast(this.getUIContext(), userErrorMessage(message, 'save'));
        return;
      }
      const version = Number(message.split(':')[1]);
      try {
        const confirmed = await xopcConfirmDialog(this.getUIContext(), {
          title: $r('app.string.capture_consent_title'),
          message: $r('app.string.capture_consent_message'),
          confirmLabel: $r('app.string.capture_consent_continue'),
        });
        if (!confirmed) { this.capture.reset(); return; }
        await this.capture.acknowledge(version);
        this.capture.reset();
        await this.music.pause();
        await this.capture.start(context);
      } catch (error) {
        xopcToast(this.getUIContext(), userErrorMessage((error as Error).message, 'save'));
      }
    } finally {
      this.noteCaptureOpening = false;
    }
  }

  @Monitor('layout.foreground')
  refreshOnReturn(): void {
    if (this.layout.foreground) void this.attention.refresh();
  }

  @Monitor('layout.foreground', 'sidebarMounted', 'selectedTab', 'adaDepth', 'fullScreenOverlayActive', 'adaChatReady')
  refreshPersonalUnread(): void {
    if (this.disposed || !this.layout.foreground) return;
    void this.personalAgent.refreshUnread((): XopcPersonalReadTarget | undefined =>
      this.disposed ? undefined : this.viewedPersonal);
  }

  private openSidebar(): void {
    if (this.sidebarOpen) return;
    this.navigationRevision++;
    this.sidebarOpen = true;
    this.tabNav.sidebarOpen = true;
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
    this.tabNav.sidebarOpen = false;
    this.sidebarDragging = false;
    this.settleSidebar(0);
    return true;
  }

  private settleSidebar(target: number): void {
    const revision = ++this.sidebarTransition;
    if (this.sidebarProgress === target) {
      if (target === 0) this.sidebarMounted = false;
      return;
    }
    xopcWithMotion(this.getUIContext(), XOPC_MOTION_STANDARD_MS, Curve.EaseOut, (): void => {
      this.sidebarProgress = target;
    }, (): void => {
      if (!this.disposed && this.sidebarTransition === revision && target === 0) this.sidebarMounted = false;
    }, this.layout.reduceMotion);
  }

  private startSidebarDrag(offsetX: number): void {
    if (!this.allowSidebarEdgeSwipe) return;
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

  // AdaRoot (L0) is permanently anchored to personalAgent.conversationId.
  private async restoreInitialChat(): Promise<void> {
    this.initialChatError = '';
    if (this.adaChatReady && this.adaConversationId) {
      void this.personalAgent.refresh();
      return;
    }
    const revision = ++this.adaRequestRevision;
    this.adaChatReady = false;
    try {
      await this.personalAgent.refresh();
      if (this.disposed || revision !== this.adaRequestRevision) return;
      if (this.personalAgent.error) throw new Error(this.personalAgent.error);
      const record = await this.personalAgent.openOrCreate();
      if (this.disposed || revision !== this.adaRequestRevision) return;
      if (!record?.conversationId) {
        throw new Error(this.personalAgent.error || 'PERSONAL_AGENT_UNAVAILABLE');
      }
      this.adaConversationId = record.conversationId;
      this.adaRequestedDraft = '';
      this.adaChatReady = true;
    } catch (error) {
      if (!this.disposed && revision === this.adaRequestRevision) this.initialChatError = (error as Error).message;
    }
  }

  private openSessionChatFromSidebar(id: string, prompt: string = '', focusComposer: boolean = false): void {
    if (!id) return;
    if (id === (this.personalAgent.record?.conversationId || this.adaConversationId)) {
      this.switchToAdaRoot();
      return;
    }
    this.navigationRevision++;
    this.closeSidebar();
    const transition = this.tabNav.openSessionChatFromSidebar({ page: 'session-chat', itemId: id, prompt });
    this.selectedTab = 'ada';
    this.sessionChatId = id;
    this.sessionChatRequestRevision++;
    if (focusComposer) this.sessionChatFocusRevision++;
    if (transition.operation === 'replace' && transition.route) {
      this.adaStack.replacePath({ name: 'session-chat', param: transition.route }, !this.layout.reduceMotion);
    } else if (transition.route) {
      this.adaStack.pushPath({ name: 'session-chat', param: transition.route }, !this.layout.reduceMotion);
    }
  }

  private switchSessionChatInPlace(id: string): void {
    if (!id) return;
    if (id === (this.personalAgent.record?.conversationId || this.adaConversationId)) {
      this.sessionSwitcherOpen = false;
      this.switchToAdaRoot();
      return;
    }
    this.sessionSwitcherOpen = false;
    this.navigationRevision++;
    const transition = this.tabNav.switchSessionChatInPlace({ page: 'session-chat', itemId: id });
    this.selectedTab = transition.tab;
    this.sessionChatId = id;
    this.sessionChatRequestRevision++;
    const stack = this.stackFor(transition.tab);
    if (transition.operation === 'replace' && transition.route) {
      stack.replacePath({ name: 'session-chat', param: transition.route }, !this.layout.reduceMotion);
    } else if (transition.route) {
      stack.pushPath({ name: 'session-chat', param: transition.route }, !this.layout.reduceMotion);
    }
  }

  private openConversationTarget(id: string): void {
    const personalId = this.personalAgent.record?.conversationId || this.adaConversationId;
    if (personalId && id === personalId) {
      this.switchToAdaRoot();
      return;
    }
    this.openSessionChatFromSidebar(id);
  }

  private openConversationFromSearch(id: string): void {
    this.navigationRevision++;
    const personalId = this.personalAgent.record?.conversationId || this.adaConversationId;
    const result = this.tabNav.openConversationFromSearch(id, personalId);
    if (result.operation === 'switch-ada-root') {
      this.selectedTab = 'ada';
      this.adaStack.clear();
      return;
    }
    if (result.route) {
      this.sessionChatId = id;
      this.sessionChatRequestRevision++;
      this.stackFor(result.tab).pushPath({ name: 'session-chat', param: result.route });
    }
  }

  private promoteSessionChatDraft(draftId: string, conversationId: string, route?: XopcMobileRoute): void {
    if (!conversationId) return;
    if (route) {
      route.itemId = conversationId;
      route.draftId = undefined;
    }
    this.tabNav.promoteSessionChatDraft(draftId, conversationId);
    this.sessionChatId = conversationId;
  }

  private onSessionChatUnavailable(id: string): void {
    if (this.disposed || !id) return;
    if (id === (this.personalAgent.record?.conversationId || this.adaConversationId)) return;
    const result = this.tabNav.handleSessionUnavailable(id);
    if (result.popped && result.tab) {
      const stack = this.stackFor(result.tab);
      if (stack.size() > 0) stack.pop();
      if (this.sessionChatId === id) this.sessionChatId = '';
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
        this.openSessionChatFromSidebar(id, '', true);
      }
    } catch (error) {
      if (!this.disposed && revision === this.navigationRevision) {
        xopcToast(this.getUIContext(), userErrorMessage((error as Error).message, 'save'));
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
    if (!this.disposed && navigation === this.navigationRevision) this.openSessionChatFromSidebar(id);
  }

  private openSessionSwitcher(): void {
    this.sessionSwitcherOpen = true;
    const cached = this.chatRepository.cachedRecent();
    if (cached) {
      this.switcherItems = cached.items.filter((item: XopcSessionItem): boolean =>
        item.key !== this.personalAgent.record?.conversationId && item.status !== 'archived' && item.messageCount > 0);
    }
    this.switcherLoading = !this.switcherItems.length;
    void this.chatRepository.refreshRecent().then((page): void => {
      if (this.disposed) return;
      this.switcherItems = page.items.filter((item: XopcSessionItem): boolean =>
        item.key !== this.personalAgent.record?.conversationId && item.status !== 'archived' && item.messageCount > 0);
    }).catch((): void => {}).finally((): void => { this.switcherLoading = false; });
  }

  @Builder
  sessionSwitcherSheet() {
    Column({ space: 8 }) {
      XopcSheetHeader({
        heading: $r('app.string.chat_switch_conversation'),
        onClose: (): void => { this.sessionSwitcherOpen = false; },
      })
      Button({ type: ButtonType.Normal }) {
        Row({ space: 10 }) {
          SymbolGlyph($r('sys.symbol.square_and_pencil')).fontSize(18).fontColor([this.colors.accent])
          Text($r('app.string.new_chat')).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
            .layoutWeight(1).textAlign(TextAlign.Start)
        }.width('100%').padding({ left: 14, right: 14 })
      }.id('session-switcher-new').width('100%').height(48).backgroundColor(this.colors.accentSoft)
        .borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14))
        .onClick((): void => {
          this.sessionSwitcherOpen = false;
          void this.openOrdinaryChat();
        })
      List({ space: 6 }) {
        if (this.switcherLoading && !this.switcherItems.length) {
          ListItem() { XopcListSkeleton() }
        }
        ForEach(this.switcherItems, (item: XopcSessionItem) => {
          ListItem() {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 10 }) {
                Text(item.displayName || item.name || item.title || $r('app.string.untitled'))
                  .fontSize(15)
                  .fontWeight(item.key === this.sessionChatId ? FontWeight.Medium : FontWeight.Normal)
                  .fontColor(item.key === this.sessionChatId ? this.colors.accent : this.colors.foreground)
                  .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  .textAlign(TextAlign.Start)
                if (item.status === 'pinned') {
                  SymbolGlyph($r('sys.symbol.pin')).fontSize(13).fontColor([this.colors.secondary])
                }
              }.width('100%').padding({ left: 14, right: 14 })
            }.id('session-switcher-item-' + item.key).width('100%').constraintSize({ minHeight: 48 })
              .backgroundColor(item.key === this.sessionChatId ? this.colors.active : this.colors.grouped)
              .borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12))
              .onClick((): void => { this.switchSessionChatInPlace(item.key); })
          }
        }, (item: XopcSessionItem): string => item.key)
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
    }.id('session-switcher-sheet').width('100%').height('100%')
      .padding({ left: 16, right: 16, bottom: 16 }).backgroundColor(this.colors.panel)
  }

  @Builder
  destination(page: string, param: Object) {
    if (page === 'session-chat') {
      NavDestination() {
        XopcChatView({
          requestedId: (param as XopcMobileRoute).itemId,
          requestRevision: this.sessionChatRequestRevision,
          focusRevision: this.sessionChatFocusRevision,
          intakeRevision: this.intake.chatRevision,
          intakeText: (param as XopcMobileRoute).prompt ?? '',
          personalAgent: this.personalAgent.record,
          sessionChat: true,
          activePage: this.detailRoute === 'session-chat',
          bottomChromeInset: 0,
          onSessionClose: (): void => { this.popActiveStack(); },
          onOpenSessionSwitcher: (): void => { this.openSessionSwitcher(); },
          onNewOrdinaryChat: (): void => { void this.openOrdinaryChat(); },
          onOpenPersonalAgent: (): void => { this.switchToAdaRoot(); },
          onLocalChatCreated: (id: string): void => {
            this.promoteSessionChatDraft((param as XopcMobileRoute).itemId, id, param as XopcMobileRoute);
          },
          onConversationUnavailable: (id: string): void => { this.onSessionChatUnavailable(id); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
          onConversationChange: (id: string): void => {
            const route = param as XopcMobileRoute;
            if (route.itemId && route.itemId !== id) {
              this.promoteSessionChatDraft(route.itemId, id, route);
            }
            this.sessionChatId = id;
          },
        })
      }.hideTitleBar(true).onBackPressed((): boolean => {
        if (layoutState.dismissChatOverlay?.()) return true;
        this.popActiveStack();
        return true;
      })
    } else if (page === 'sessions' || page === 'sessions-search') {
      XopcSessionsView({ startSearching: page === 'sessions-search', currentId: this.visibleConversationId,
        personalAgent: this.personalAgent.record,
        onExit: (): void => { this.popActiveStack(); },
        onOpen: (id: string): void => { this.openConversationFromSearch(id); },
        onTask: (id: string): void => { this.navigate({ page: 'task-chat', itemId: id }); },
        onNew: (id: string): void => { this.openSessionChatFromSidebar(id, '', true); },
        onDelete: (id: string): void => { this.onSessionChatUnavailable(id); } })
    } else if (page === 'capability-mcp-setup') {
      NavDestination() {
        XopcCapabilityPanelView({
          category: 'connections',
          itemId: 'mcp:setup',
          itemName: this.getUIContext().getHostContext()?.resourceManager.getStringSync($r('app.string.cap_native_mcp').id) ?? 'MCP',
          initialId: (param as XopcMobileRoute).itemId,
          initialUrl: (param as XopcMobileRoute).prompt ?? '',
          onClose: (): void => { this.popActiveStack(); },
          onUseInChat: (prompt: string): void => {
            this.popActiveStack();
            void this.openOrdinaryChat('', prompt, false);
          },
        })
      }.hideTitleBar(true).backgroundColor(this.colors.surface)
    } else if (page === 'capabilities') {
      NavDestination() {
        XopcCapabilitiesView({ personal: this.personalAgent.record, onExit: (): void => { this.popActiveStack(); },
          onPersonalChanged: (): void => { void this.personalAgent.refresh(); },
          onSetupChat: (prompt: string, agentSetup: boolean): void => { void this.openOrdinaryChat('', prompt, agentSetup); },
          onDeviceChat: (id: string): void => { this.openConversationTarget(id); },
          onDeviceFile: (attachment: XopcChatAttachment): Promise<void> => this.useLibraryFile(attachment),
          onOpenAgent: (id: string, personal: boolean): void => {
            if (personal) this.switchToAdaRoot(); else void this.openOrdinaryChat(id);
          } })
      }.hideTitleBar(true).backgroundColor(this.colors.surface)
    } else if (page === 'library') {
      NavDestination() {
        XopcSpaceLibraryView({ initialId: (param as XopcMobileRoute).itemId,
          onExit: (): void => { this.popActiveStack(); },
          onBackHandler: (handler?: () => boolean): void => { this.libraryBackHandler = handler; },
          onOpenSource: (source: XopcLibraryOrigin): void => {
            if (source.kind === 'task' && source.taskId) this.navigate({ page: 'tasks', itemId: source.taskId });
            else if (source.kind === 'automation' && source.automationRunId) this.navigate({ page: 'automation-run', itemId: source.automationRunId });
            else this.openConversationTarget(source.conversationId);
          }, onUseInChat: (file: XopcChatAttachment, source?: XopcLibraryOrigin): Promise<void> => this.useLibraryFile(file, source) })
      }.hideTitleBar(true).backgroundColor(this.colors.surface).onBackPressed((): boolean => this.libraryBackHandler?.() ?? false)
    } else if (page === 'notes-list' || ((page === 'notes' || page === 'inbox') && !(param as XopcMobileRoute).itemId)) {
      NavDestination() {
        XopcNotesTabView({ activePage: this.notesListVisible && this.detailRoute === page && this.layout.foreground,
          recordingAvailable: this.recordingAvailable,
          initialStatus: page === 'inbox' ? 'inbox' : '',
          onExit: (): void => { this.popActiveStack(); },
          onStartVoice: (): void => { void this.startNoteCapture(); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
      }.hideTitleBar(true).backgroundColor(this.colors.surface).onBackPressed((): boolean => this.collapseNotesRecording())
    } else if (page === 'personal-goals') {
      NavDestination() {
        XopcPersonalGoalsView({ onExit: (): void => { this.popActiveStack(); } })
      }.hideTitleBar(true).backgroundColor(this.colors.surface)
    } else if (page === 'personal-agent-overview') {
      NavDestination() {
        XopcPersonalAgentOverview({ record: this.personalAgent.record,
          activePage: this.detailRoute === 'personal-agent-overview' && this.layout.foreground,
          canShareConversation: (param as XopcMobileRoute).canShareConversation ?? false,
          onClose: (): void => { this.popActiveStack(); },
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
          onClose: (): void => { this.popActiveStack(); } })
      }.hideTitleBar(true).onHidden((): void => { this.profileOptions.dispose(); this.profileOptions = new XopcChatOptionsViewModel(); })
    } else if (page === 'notes' || page === 'inbox' || page === 'note-create') {
      XopcNotesView({ initialId: (param as XopcMobileRoute).itemId,
        createOnAppear: page === 'note-create', projectId: (param as XopcMobileRoute).projectId ?? '',
        onExit: (): void => { this.popActiveStack(); },
        onOpenConversation: (id: string): void => { this.navigate({ page: 'chat', itemId: id }); } })
    } else if (page === 'project-detail' || (page === 'projects' && !!(param as XopcMobileRoute).itemId)) {
      XopcProjectSpaceView({ projectId: (param as XopcMobileRoute).itemId, deliveries: this.attention.deliveries,
        attention: this.attention.needsUser,
        onExit: (): void => { this.popActiveStack(); },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
    } else if (page === 'automation-configuration-chat') {
      NavDestination() {
        Column() {
          XopcPageHeader({ heading: $r('app.string.automation_setup_title'), backVisible: true,
            onBack: (): void => { this.popActiveStack(); } })
          XopcChatView({ requestedId: (param as XopcMobileRoute).itemId, embedded: true, automationSetup: true,
            activePage: this.detailRoute === 'automation-configuration-chat' && this.layout.foreground,
            intakeText: (param as XopcMobileRoute).prompt ?? '', intakeRevision: 1,
            onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
            .width('100%').layoutWeight(1)
        }.width('100%').height('100%').backgroundColor(this.colors.chat.canvas)
      }.hideTitleBar(true).onBackPressed((): boolean => {
        if (layoutState.dismissChatOverlay?.()) return true;
        this.popActiveStack(); return true;
      })
    } else if (page === 'project-chat') {
      NavDestination() {
        XopcChatView({ requestedId: (param as XopcMobileRoute).itemId,
          activePage: this.detailRoute === 'project-chat', projectChat: true,
          scopedProjectName: (param as XopcMobileRoute).title ?? '',
          onProjectClose: (): void => { this.closeProjectChat(); },
          onOpenSidebar: (): void => { this.openSidebar(); },
          sidebarSwipeWidth: this.recordingViewportWidth, sidebarSwipeEnabled: false,
          onConversationChange: (id: string): void => { this.projectConversationId = id; },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
      }.hideTitleBar(true).onBackPressed((): boolean => {
        if (this.closeSidebar() || layoutState.dismissChatOverlay?.()) return true;
        this.closeProjectChat(); return true;
      })
    } else if (page === 'task-conversation') {
      NavDestination() {
        XopcChatView({ requestedId: (param as XopcMobileRoute).prompt ?? '',
          taskId: (param as XopcMobileRoute).itemId, activePage: this.detailRoute === 'task-conversation', embedded: false,
          onTaskClose: (): void => { this.popActiveStack(); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
      }.hideTitleBar(true).onBackPressed((): boolean => { if (layoutState.dismissChatOverlay?.()) return true; this.popActiveStack(); return true; })
    } else if (page === 'task-detail') {
      XopcWorkspaceView({ section: 'tasks', heading: $r('app.string.task_detail_title'), initialId: (param as XopcMobileRoute).itemId,
        onExit: (): void => { this.popActiveStack(); },
        onNavigate: (route: XopcMobileRoute): void => {
          const stack = this.activeStack();
          const depth = stack.size();
          const previous = depth > 1 ? stack.getParamByIndex(depth - 2) as XopcMobileRoute : undefined;
          if (route.page === 'task-chat' && previous?.page === 'task-conversation' && previous.itemId === route.itemId) {
            this.popActiveStack();
          } else this.navigate(route);
        } })
    } else if (page === 'task-edit' || page === 'task-status') {
      XopcWorkspaceView({ section: 'tasks', heading: $r('app.string.tasks'), initialId: (param as XopcMobileRoute).itemId,
        initialTaskAction: page === 'task-edit' ? 'edit' : 'status', onExit: (): void => { this.popActiveStack(); },
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
          this.popActiveStack();
          this.navigate({ page: target, itemId: id });
        },
        onExit: (): void => { this.popActiveStack(); } })
    } else if (page === 'files' || page === 'session-files' || page === 'file-upload') {
      XopcFilesView({ uploadOnAppear: page === 'file-upload', initialId: page === 'files' ? (param as XopcMobileRoute).itemId : '',
        conversationId: page === 'session-files' ? (param as XopcMobileRoute).itemId : '', onExit: (): void => { this.popActiveStack(); } })
    } else if (page === 'automation-run') {
      XopcAutomationRunView({ runId: (param as XopcMobileRoute).itemId, onExit: (): void => { this.popActiveStack(); },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
    } else if (page === 'sharing') {
      XopcShareCenterView({ onExit: (): void => { this.popActiveStack(); } })
    } else if (page === 'model-settings') {
      XopcModelSettingsView({ onExit: (): void => { this.popActiveStack(); } })
    } else if (page === 'about-you') {
      XopcAboutYouView({ initialId: (param as XopcMobileRoute).itemId, onExit: (): void => { this.popActiveStack(); },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
    } else {
      NavDestination() {
        if (page === 'settings') {
          XopcSettingsView({ personalAgent: this.personalAgent.record, section: (param as XopcMobileRoute).itemId, useNavigation: true,
            onExit: (): void => { this.popActiveStack(); },
            onOpenSection: (section: string): void => { this.navigate({ page: 'settings', itemId: section }); },
            onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
        }
        else { Text($r('app.string.unsupported_route')).fontColor(this.colors.secondary).padding(20) }
      }.hideTitleBar(page === 'settings').title($r('app.string.back')).backgroundColor(this.colors.surface)
    }
  }

  private judgeRootEdgeSwipe(event: PanGestureEvent): GestureJudgeResult {
    const finger = event.fingerInfos?.[0] ?? event.fingerList[0];
    if (!finger || event.source !== SourceType.TouchScreen || !this.allowSidebarEdgeSwipe || this.selectedTab === 'ada') {
      return GestureJudgeResult.REJECT;
    }
    const startX = finger.globalX - event.offsetX;
    if (startX < CHAT_SIDEBAR_BACK_EDGE || startX > ROOT_EDGE_SWIPE_BAND_VP || event.offsetX <= Math.abs(event.offsetY) * 1.25) {
      return GestureJudgeResult.REJECT;
    }
    return GestureJudgeResult.CONTINUE;
  }

  @Builder
  adaTabStack() {
    Navigation(this.adaStack) {
      Stack({ alignContent: Alignment.TopStart }) {
        Column() {
          if (this.adaChatReady) {
            XopcChatView({
              requestedId: this.adaConversationId,
              requestRevision: this.adaRequestRevision,
              personalAgent: this.personalAgent.record,
              personalUnread: this.viewedPersonal ? this.personalAgent.unreadSnapshot : null,
              focusRevision: this.adaFocusRevision,
              intakeRevision: this.intake.chatRevision,
              intakeText: this.adaRequestedDraft,
              activePage: this.selectedTab === 'ada' && this.adaDepth === 0,
              bottomChromeInset: this.bottomChromeInset,
              scrollToLatestRevision: this.adaScrollRevision,
              sidebarSwipeWidth: this.recordingViewportWidth,
              sidebarSwipeEnabled: this.allowSidebarEdgeSwipe && this.adaChatReady,
              onOpenSidebar: (): void => { this.openSidebar(); },
              onSidebarDragStart: (offsetX: number): void => { this.startSidebarDrag(offsetX); },
              onSidebarDragUpdate: (offsetX: number): void => { this.updateSidebarDrag(offsetX); },
              onSidebarDragEnd: (offsetX: number, velocityX: number): void => { this.finishSidebarDrag(offsetX, velocityX); },
              onSidebarDragCancel: (): void => { if (this.sidebarDragging) this.closeSidebar(); },
              onNewOrdinaryChat: (): void => { void this.openOrdinaryChat(); },
              onOpenPersonalAgent: (): void => { this.switchToAdaRoot(); },
              onOverlayActiveChange: (active: boolean): void => { this.chatOverlayActive = active; },
              onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
              onPersonalReadTargetChange: (target?: XopcPersonalReadTarget): void => {
                const previous = this.personalReadTarget;
                this.personalReadTarget = target;
                if (target || previous) this.refreshPersonalUnread();
              },
            })
          }
        }.id('home-chat-viewport').width('100%').height('100%')
        if (!this.adaChatReady) {
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
                .padding({ bottom: this.bottomChromeInset })
            } else {
              XopcBrandLoading({ reduceMotion: this.layout.reduceMotion })
            }
          }.id('chat-navigation-loading').width('100%').height('100%')
            .justifyContent(FlexAlign.Center).backgroundColor(this.colors.surface)
        }
      }.width('100%').height(LayoutPolicy.matchParent)
        .ignoreLayoutSafeArea([LayoutSafeAreaType.SYSTEM], [LayoutSafeAreaEdge.TOP])
    }.hideTitleBar(true).mode(NavigationMode.Stack).navDestination(this.destination)
      .width('100%').height('100%').backgroundColor(this.colors.surface)
      .visibility(this.selectedTab === 'ada' ? Visibility.Visible : Visibility.Hidden)
      .zIndex(this.selectedTab === 'ada' ? 2 : 0)
      .hitTestBehavior(this.selectedTab === 'ada' ? HitTestMode.Default : HitTestMode.None)
      .accessibilityLevel(this.selectedTab === 'ada' && !this.sidebarOpen ? 'auto' : 'no-hide-descendants')
  }

  @Builder
  workbenchTabStack() {
    Navigation(this.workbenchStack) {
      XopcWorkbenchView({
        progress: this.attention,
        activePage: this.selectedTab === 'workbench' && this.workbenchDepth === 0 && this.layout.foreground,
        bottomChromeInset: this.bottomChromeInset,
        resetRevision: this.workbenchResetRevision,
        onOpenSidebar: (): void => { this.openSidebar(); },
        onBackHandler: (handler?: () => boolean): void => { this.workbenchBackHandler = handler; },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
      })
    }.hideTitleBar(true).mode(NavigationMode.Stack).navDestination(this.destination)
      .width('100%').height('100%').backgroundColor(this.colors.surface)
      .visibility(this.selectedTab === 'workbench' ? Visibility.Visible : Visibility.Hidden)
      .zIndex(this.selectedTab === 'workbench' ? 2 : 0)
      .hitTestBehavior(this.selectedTab === 'workbench' ? HitTestMode.Default : HitTestMode.None)
      .accessibilityLevel(this.selectedTab === 'workbench' && !this.sidebarOpen ? 'auto' : 'no-hide-descendants')
  }

  @Builder
  notesTabStack() {
    Navigation(this.notesStack) {
      XopcNotesTabView({
        activePage: this.selectedTab === 'notes' && this.notesDepth === 0 && this.layout.foreground,
        rootTab: true,
        bottomChromeInset: this.bottomChromeInset,
        scrollTopRevision: this.notesScrollRevision,
        recordingAvailable: this.recordingAvailable,
        onOpenSidebar: (): void => { this.openSidebar(); },
        onStartVoice: (): void => { void this.startNoteCapture(); },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
      })
    }.hideTitleBar(true).mode(NavigationMode.Stack).navDestination(this.destination)
      .width('100%').height('100%').backgroundColor(this.colors.surface)
      .visibility(this.selectedTab === 'notes' ? Visibility.Visible : Visibility.Hidden)
      .zIndex(this.selectedTab === 'notes' ? 2 : 0)
      .hitTestBehavior(this.selectedTab === 'notes' ? HitTestMode.Default : HitTestMode.None)
      .accessibilityLevel(this.selectedTab === 'notes' && !this.sidebarOpen ? 'auto' : 'no-hide-descendants')
  }

  @Builder
  libraryTabStack() {
    Navigation(this.libraryStack) {
      XopcSpaceLibraryView({
        rootTab: true,
        activePage: this.selectedTab === 'library' && this.libraryDepth === 0 && this.layout.foreground,
        bottomChromeInset: this.bottomChromeInset,
        scrollTopRevision: this.libraryScrollRevision,
        onOpenSidebar: (): void => { this.openSidebar(); },
        onDetailOpenChange: (open: boolean): void => { this.libraryDetailOpen = open; },
        onBackHandler: (handler?: () => boolean): void => { this.libraryBackHandler = handler; },
        onOpenSource: (source: XopcLibraryOrigin): void => {
          if (source.kind === 'task' && source.taskId) this.navigate({ page: 'tasks', itemId: source.taskId });
          else if (source.kind === 'automation' && source.automationRunId) this.navigate({ page: 'automation-run', itemId: source.automationRunId });
          else this.openConversationTarget(source.conversationId);
        },
        onUseInChat: (file: XopcChatAttachment, source?: XopcLibraryOrigin): Promise<void> => this.useLibraryFile(file, source),
      })
    }.hideTitleBar(true).mode(NavigationMode.Stack).navDestination(this.destination)
      .width('100%').height('100%').backgroundColor(this.colors.surface)
      .visibility(this.selectedTab === 'library' ? Visibility.Visible : Visibility.Hidden)
      .zIndex(this.selectedTab === 'library' ? 2 : 0)
      .hitTestBehavior(this.selectedTab === 'library' ? HitTestMode.Default : HitTestMode.None)
      .accessibilityLevel(this.selectedTab === 'library' && !this.sidebarOpen ? 'auto' : 'no-hide-descendants')
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Stack({ alignContent: Alignment.Bottom }) {
        Stack({ alignContent: Alignment.TopStart }) {
          this.adaTabStack()
          this.workbenchTabStack()
          this.notesTabStack()
          this.libraryTabStack()
        }.width('100%').height('100%')
          .parallelGesture(PanGesture({ fingers: 1, direction: PanDirection.Right, distance: CHAT_SIDEBAR_PAN_DISTANCE_VP })
            .tag('root-tab-sidebar-open')
            .onActionStart((event: GestureEvent): void => { this.startSidebarDrag(event.offsetX); })
            .onActionUpdate((event: GestureEvent): void => { this.updateSidebarDrag(event.offsetX); })
            .onActionEnd((event: GestureEvent): void => { this.finishSidebarDrag(event.offsetX, event.velocityX); })
            .onActionCancel((): void => { if (this.sidebarDragging) this.closeSidebar(); }))
          .onGestureRecognizerJudgeBegin((event: BaseGestureEvent, current: GestureRecognizer): GestureJudgeResult => {
            if (current.getTag() !== 'root-tab-sidebar-open') return GestureJudgeResult.CONTINUE;
            return this.judgeRootEdgeSwipe(event as PanGestureEvent);
          })

        if (this.showGlobalMusicMiniPlayer) {
          Column() { XopcMusicMiniPlayer() }
            .width('100%')
            .padding({ top: 4, bottom: this.bottomChromeInset > 0 ? this.bottomChromeInset + 8 : 4 })
            .hitTestBehavior(HitTestMode.Transparent)
            .zIndex(30)
        }

        if (this.showBottomTabBar) {
          XopcFloatingTabBar({
            selectedTab: this.selectedTab,
            personalAgent: this.personalAgent.record,
            personalUnread: this.personalAgent.unreadSnapshot?.unreadCount ?? 0,
            pendingAttention: this.pendingAttention,
            recordingAvailable: this.recordingAvailable,
            recordingActive: this.capture.phase === 'recording',
            onSelectTab: (tab: XopcMobileTab): void => { this.selectTab(tab); },
          }).zIndex(35)
        }
      }.width('100%').height('100%')

      if (this.sidebarMounted) {
        Stack() {
          XopcChatSidebar({
            personalAgent: this.personalAgent.record,
            reveal: this.sidebarProgress,
            drawerWidth: this.sidebarWidth,
            interactive: this.sidebarOpen,
            currentId: this.visibleConversationId,
            onClose: (): void => { this.closeSidebar(); },
            onDismissDrag: (offset: number): void => {
              if (this.sidebarOpen) this.sidebarProgress = 1 - chatSidebarDragProgress(-offset, this.sidebarWidth);
            },
            onDismissEnd: (offset: number, velocity: number): void => {
              if (!this.sidebarOpen) return;
              if (shouldOpenChatSidebar(-offset, -velocity, this.sidebarWidth)) this.closeSidebar();
              else this.settleSidebar(1);
            },
            onNew: (): void => { void this.openOrdinaryChat(); },
            onConversation: (id: string): void => {
              if (this.detailRoute === 'project-chat' && id === this.projectConversationId) this.closeSidebar();
              else this.openSessionChatFromSidebar(id);
            },
            onDelete: (id: string): void => { this.onSessionChatUnavailable(id); },
            onNavigate: (route: XopcMobileRoute): void => { this.openSidebarRoute(route); },
          })
        }.width('100%').height('100%').zIndex(45)
          .ignoreLayoutSafeArea([LayoutSafeAreaType.SYSTEM], [LayoutSafeAreaEdge.TOP])
      }

      if (this.recordingAvailable && (!this.recordingDocked || !this.recordingPanel.small) &&
        this.recordingViewportWidth > 0 && this.recordingViewportHeight > 0) {
        if (this.recordingDocked) {
          Column() {}.width('100%').height('100%').backgroundColor(this.colors.scrim).zIndex(49)
            .accessibilityLevel('no').onClick((): void => { this.collapseNotesRecording(); })
        }
        XopcDiscussionRecordingPanelView({ panel: this.recordingPanel,
          viewportWidth: this.recordingViewportWidth,
          viewportHeight: this.recordingViewportHeight,
          bottomChromeInset: this.bottomChromeInset,
          docked: this.recordingDocked,
          onOpenNote: (id: string): void => {
            this.recordingPanel.setCompact(true);
            this.selectedTab = 'notes';
            this.tabNav.selectedTab = 'notes';
            this.navigate({ page: 'notes', itemId: id });
          },
          onRecovery: (): void => {
            this.selectedTab = 'notes';
            this.tabNav.selectedTab = 'notes';
            this.tabNav.clearTab('notes');
            this.notesStack.clear();
            void this.capture.refreshPending(this.getUIContext().getHostContext() as common.UIAbilityContext);
          },
        })
      }

      XopcShareIntakeDialog({
        currentConversationId: this.visibleConversationId || this.adaConversationId,
        onExplore: async (value: XopcIncomingShare, targetId: string): Promise<boolean> => await this.exploreShare(value, targetId),
        onSaved: (noteId: string): void => {
          this.selectedTab = 'notes';
          this.tabNav.selectedTab = 'notes';
          this.tabNav.clearTab('notes');
          this.notesStack.clear(false);
          this.navigate({ page: 'notes', itemId: noteId });
        },
      })

      Column().width('100%').height(0)
        .bindSheet($$this.sessionSwitcherOpen, this.sessionSwitcherSheet, xopcSheetOptions('medium'))
    }.width('100%').height('100%')
      .onAreaChange((_previous: Area, current: Area): void => {
        this.recordingViewportWidth = Number(current.width);
        this.recordingViewportHeight = Number(current.height);
      })
  }
}

@ComponentV2
struct XopcWorkbenchView {
  @Param progress: XopcProgressViewModel = new XopcProgressViewModel();
  @Param activePage: boolean = false;
  @Param bottomChromeInset: number = 0;
  @Param resetRevision: number = 0;
  @Event onOpenSidebar: () => void = (): void => {};
  @Event onBackHandler: (handler?: () => boolean) => void = (_handler?: () => boolean): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local selectedIndex: number = 0;
  @Local projectSearchOpen: boolean = false;
  @Local refreshRevision: number = 0;
  @Local progressScrollTopRevision: number = 0;
  private pager: SwiperController = new SwiperController();
  private shown: boolean = false;

  aboutToAppear(): void {
    this.onBackHandler((): boolean => {
      if (this.selectedIndex === 2 && this.projectSearchOpen) {
        this.projectSearchOpen = false;
        this.getUIContext().getFocusController().clearFocus();
        return true;
      }
      return false;
    });
  }

  aboutToDisappear(): void {
    this.onBackHandler();
  }

  @Monitor('activePage')
  onActiveChange(): void {
    if (this.activePage) {
      if (this.shown) {
        this.refreshRevision++;
        void this.progress.refresh();
      }
      this.shown = true;
    }
  }

  @Monitor('resetRevision')
  onResetRequest(): void {
    if (this.resetRevision <= 0) return;
    if (this.projectSearchOpen) {
      this.projectSearchOpen = false;
      this.getUIContext().getFocusController().clearFocus();
    }
    if (this.selectedIndex !== 0) {
      this.selectPage('progress');
    }
    this.progressScrollTopRevision++;
  }

  private selectPage(page: string): void {
    const index = WORK_PAGE_OPTIONS.findIndex((option: XopcPageTitleOption): boolean => option.key === page);
    if (index < 0 || index === this.selectedIndex) return;
    this.pager.changeIndex(index, xopcPagerAnimated(this.layout.reduceMotion, index - this.selectedIndex));
  }

  private toggleProjectSearch(): void {
    this.projectSearchOpen = !this.projectSearchOpen;
    if (!this.projectSearchOpen) this.getUIContext().getFocusController().clearFocus();
  }

  build() {
    Column() {
      XopcPageHeader({
        heading: WORK_PAGE_OPTIONS[this.selectedIndex].label,
        titleOptions: WORK_PAGE_OPTIONS,
        selectedTitle: WORK_PAGE_OPTIONS[this.selectedIndex].key,
        titleMenuId: 'work-page-menu',
        onSelectTitle: (page: string): void => { this.selectPage(page); },
        backVisible: false,
        drawerVisible: true,
        drawerId: 'workbench-header-sidebar',
        onOpenDrawer: (): void => { this.onOpenSidebar(); },
        searchId: this.selectedIndex === 2 ? 'projects-open-search' : '',
        searchOpen: this.projectSearchOpen,
        onSearch: (): void => { this.toggleProjectSearch(); },
        actionLabel: this.selectedIndex === 0 ? '' : this.selectedIndex === 1 ? $r('app.string.new_task') : $r('app.string.new_project'),
        actionIcon: $r('sys.symbol.plus'),
        onAction: (): void => {
          this.onNavigate({ page: this.selectedIndex === 1 ? 'task-create' : 'project-create', itemId: '' });
        },
      }).id('workbench-header')
      Swiper(this.pager) {
        XopcProgressView({
          activePage: this.activePage,
          model: this.progress,
          bottomChromeInset: this.bottomChromeInset,
          scrollTopRevision: this.progressScrollTopRevision,
          onSelectWorkPage: (page: string): void => { this.selectPage(page); },
          onNavigate: this.onNavigate,
        })
        XopcWorkspaceView({
          section: 'tasks',
          heading: $r('app.string.tasks'),
          embeddedInWorkbench: true,
          workbenchRefresh: this.refreshRevision,
          bottomChromeInset: this.bottomChromeInset,
          onNavigate: this.onNavigate,
        })
        XopcWorkspaceView({
          section: 'projects',
          heading: $r('app.string.projects'),
          embeddedInWorkbench: true,
          workbenchRefresh: this.refreshRevision,
          workbenchSearchOpen: this.projectSearchOpen,
          bottomChromeInset: this.bottomChromeInset,
          onNavigate: this.onNavigate,
        })
      }.id('work-page-pager').index(this.selectedIndex).loop(false).indicator(false).cachedCount(2)
        .duration(xopcPagerDuration(this.layout.reduceMotion))
        .width('100%').layoutWeight(1).clip(true)
        .onChange((index: number): void => {
          this.selectedIndex = index;
          this.getUIContext().getFocusController().clearFocus();
        })
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
  }
}
