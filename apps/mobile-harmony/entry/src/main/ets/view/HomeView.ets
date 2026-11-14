import { XopcPersonalAgentRecord } from '../model/personalAgent';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcPersonalAgentSettings } from './PersonalAgentSettings';
import { XopcChatOptionsViewModel } from '../viewmodel/chatOptionsViewModel';
import { XopcChatView } from './ChatView';
import { XopcSessionsView } from './SessionsView';
import { XopcChatSidebar } from './ChatSidebar';
import { chatSidebarDragProgress, shouldOpenChatSidebar } from '../common/chatSidebarGesture';
import { XopcWorkspaceView } from './WorkspaceView';
import { XopcProjectSpaceView } from './ProjectSpaceView';
import { XopcNotesView } from './NotesView';
import { XopcNotesTabView } from './NotesTabView';
import { XopcFilesView } from './FilesView';
import { XopcSettingsView } from './SettingsView';
import { XopcProgressView } from './HomeHubs';
import { XopcPersonalView } from './PersonalView';
import { XopcAutomationRunView } from './AutomationRunView';
import { XopcShareCenterView } from './ShareCenterView';
import { XopcAboutYouView } from './AboutYouView';
import { XopcShareIntakeDialog } from './ShareIntakeDialog';
import { XopcIncomingShare } from '../model/share';
import { XopcChatRepository } from '../repository/chatRepository';
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
import { XopcBrandLoading, XopcErrorState, XopcHubRow, XopcPageHeader } from './MobileComponents';
import { common } from '@kit.AbilityKit';
import { discussionCapture, XopcDiscussionCapture } from '../service/discussionCapture';
import { XopcDiscussionRecordingPanel } from '../viewmodel/discussionRecordingPanel';
import { XopcDiscussionRecordingPanelView } from './DiscussionRecordingPanel';

@ComponentV2
export struct XopcHomeView {
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
  @Local chatReady: boolean = false;
  @Local initialChatError: string = '';
  @Local detailVisible: boolean = false;
  @Local layout: XopcLayoutState = layoutState;
  @Local attention: XopcProgressViewModel = new XopcProgressViewModel();
  @Computed get pendingAttention(): number { return this.attention.pendingCount; }
  @Local personalAgent: XopcPersonalAgentViewModel = new XopcPersonalAgentViewModel();
  @Local requestedChatId: string = '';
  @Local activeChatId: string = '';
  @Local requestedChatDraft: string = '';
  @Local chatRequestRevision: number = 0;
  @Local chatFocusRevision: number = 0;
  @Local pendingChatId: string = '';
  @Local intake: XopcShareIntake = shareIntake;
  private chatRepository: XopcChatRepository = new XopcChatRepository();
  @Local personalOpening: boolean = false;
  private taskOpening: boolean = false;
  private ordinaryOpening: boolean = false;
  private disposed: boolean = false;
  private navigationRevision: number = 0;
  private readonly onMotionChange = (reduced: boolean): void => { layoutState.reduceMotion = reduced; };
  private attentionTimer: number = -1;
  private pathStack: NavPathStack = new NavPathStack();
  @Event onDisconnected: () => void = (): void => {};

  aboutToAppear(): void {
    layoutState.dismissSidebar = (): boolean => this.closeSidebar();
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
        this.navigate({ page: 'tasks', itemId: route.target.taskId });
      } else if (route.target.conversationId) this.openConversationFromList(route.target.conversationId, false);
      else if (route.target.automationId) this.navigate({ page: 'automations', itemId: route.target.automationId });
    };
    notificationNavigation.consume();
    void this.attention.refresh();
    void this.restoreInitialChat();
    this.attentionTimer = setInterval((): void => { if (this.layout.foreground) void this.attention.refresh(); }, 15000);
  }
  aboutToDisappear(): void {
    chatDraftIntake.clear();
    this.disposed = true;
    layoutState.dismissSidebar = undefined;
    notificationNavigation.onTarget = undefined; clearInterval(this.attentionTimer); this.attention.dispose();
    try { accessibility.offAnimationReduceStateChange(this.onMotionChange); } catch (_) {}
  }
  private navigate(route: XopcMobileRoute): void {
    this.navigationRevision++;
    this.closeSidebar();
    if (route.page === 'project-new-chat') { void this.openProjectChat(route.projectId ?? '', route.title); return; }
    if (route.page === 'task-chat') { void this.openTaskChat(route); return; }
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
    this.recordingPanel.fresh();
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    try {
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
        await this.capture.start(context);
      } catch (error) {
        this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') });
      }
    }
  }

  @Monitor('layout.foreground')
  refreshOnReturn(): void {
    if (this.layout.foreground) void this.attention.refresh();
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

  private async openOrdinaryChat(): Promise<void> {
    if (this.ordinaryOpening) return;
    this.ordinaryOpening = true;
    const revision = this.navigationRevision;
    try {
      const id = await this.chatRepository.create();
      if (!this.disposed && revision === this.navigationRevision) this.openConversationFromList(id);
    } catch (error) {
      if (!this.disposed && revision === this.navigationRevision) {
        this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') });
      }
    } finally { this.ordinaryOpening = false; }
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
    if (page === 'sessions') {
      XopcSessionsView({ currentId: this.activeChatId, personalAgent: this.personalAgent.record,
        onExit: (): void => { this.pathStack.pop(); this.openSidebar(); },
        onOpen: (id: string): void => { this.openConversationFromList(id); },
        onTask: (id: string): void => { this.navigate({ page: 'task-chat', itemId: id }); },
        onNew: (id: string): void => { this.openConversationFromList(id); },
        onDelete: (id: string): void => { this.onConversationUnavailable(id); } })
    } else if (page === 'progress') {
      NavDestination() {
        XopcProgressView({ activePage: true, model: this.attention, onExit: (): void => { this.pathStack.pop(); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
      }.hideTitleBar(true).backgroundColor(this.colors.surface)
    } else if (page === 'library') {
      NavDestination() {
        XopcNotesTabView({ activePage: true, onExit: (): void => { this.pathStack.pop(); }, deliveries: this.attention.deliveries,
          deliveriesLoading: this.attention.loading, deliveryError: this.attention.homeError,
          onRefreshDeliveries: (): void => { void this.attention.refresh(); },
          onStartVoice: (): void => { void this.startNoteCapture(); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
      }.hideTitleBar(true).backgroundColor(this.colors.surface)
    } else if (page === 'personal' || page === 'personal-goals') {
      NavDestination() {
        XopcPersonalView({ record: this.personalAgent.record, goalsPage: page === 'personal-goals', onExit: (): void => { this.pathStack.pop(); }, onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
      }.hideTitleBar(true).backgroundColor(this.colors.surface)
    } else if (page === 'personal-agent-profile') {
      NavDestination() {
        XopcPersonalAgentSettings({ record: this.personalAgent.record, chatOptions: this.profileOptions, showSearch: false,
          onReloadModels: (): void => {
            const record = this.personalAgent.record;
            if (record) void this.profileOptions.load(record.conversationId, record.agentId);
          },
          onSaved: (record: XopcPersonalAgentRecord): void => { this.personalAgent.record = record; },
          onClose: (): void => { this.pathStack.pop(); } })
      }.hideTitleBar(true).onHidden((): void => { this.profileOptions.dispose(); this.profileOptions = new XopcChatOptionsViewModel(); })
    } else if (page === 'notes' || page === 'inbox' || page === 'note-create') {
      XopcNotesView({ initialId: (param as XopcMobileRoute).itemId, initialStatus: page === 'inbox' ? 'inbox' : '',
        createOnAppear: page === 'note-create', projectId: (param as XopcMobileRoute).projectId ?? '',
        onExit: (): void => { this.pathStack.pop(); },
        onOpenConversation: (id: string): void => { this.navigate({ page: 'chat', itemId: id }); } })
    } else if (page === 'project-detail' || (page === 'projects' && !!(param as XopcMobileRoute).itemId)) {
      XopcProjectSpaceView({ projectId: (param as XopcMobileRoute).itemId, deliveries: this.attention.deliveries,
        attention: this.attention.needsUser,
        onExit: (): void => { this.pathStack.pop(); },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
    } else if (page === 'all-work') {
      NavDestination() {
        Column({ space: 12 }) {
          XopcHubRow({ heading: $r('app.string.tasks'), symbol: $r('sys.symbol.checkmark_circle'),
            onOpen: (): void => { this.navigate({ page: 'tasks', itemId: '' }); } })
          XopcHubRow({ heading: $r('app.string.projects'), symbol: $r('sys.symbol.folder'),
            onOpen: (): void => { this.navigate({ page: 'projects', itemId: '' }); } })
          XopcHubRow({ heading: $r('app.string.automations'), symbol: $r('sys.symbol.clock'),
            onOpen: (): void => { this.navigate({ page: 'automations', itemId: '' }); } })
        }.width('100%').padding(20)
      }.title($r('app.string.all_work')).backgroundColor(this.colors.surface)
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
          taskId: (param as XopcMobileRoute).itemId, activePage: true, embedded: false,
          onTaskClose: (): void => { this.pathStack.pop(); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
      }.hideTitleBar(true).onBackPressed((): boolean => { if (layoutState.dismissChatOverlay?.()) return true; this.pathStack.pop(); return true; })
    } else if (page === 'task-edit' || page === 'task-status') {
      XopcWorkspaceView({ section: 'tasks', heading: $r('app.string.tasks'), initialId: (param as XopcMobileRoute).itemId,
        initialTaskAction: page === 'task-edit' ? 'edit' : 'status', onExit: (): void => { this.pathStack.pop(); },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
    } else if (page === 'tasks' || page === 'projects' || page === 'automations' || page === 'project-settings'
      || page === 'task-create' || page === 'automation-create' || page === 'project-create') {
      XopcWorkspaceView({ section: page === 'tasks' || page === 'task-create' ? 'tasks'
        : page === 'projects' || page === 'project-settings' || page === 'project-create' ? 'projects' : 'automations',
        heading: page === 'tasks' || page === 'task-create' ? $r('app.string.tasks')
          : page === 'projects' || page === 'project-settings' || page === 'project-create' ? $r('app.string.projects') : $r('app.string.automations'),
        initialId: (param as XopcMobileRoute).itemId, onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
        createOnAppear: page === 'task-create' || page === 'automation-create' || page === 'project-create',
        projectId: (param as XopcMobileRoute).projectId ?? '',
        onCreated: (target: string, id: string): void => {
          this.pathStack.pop();
          this.navigate({ page: target, itemId: id });
        },
        onExit: (): void => { this.pathStack.pop(); } })
    } else if (page === 'files' || page === 'session-files' || page === 'file-upload') {
      XopcFilesView({ uploadOnAppear: page === 'file-upload', initialId: page === 'files' ? (param as XopcMobileRoute).itemId : '',
        conversationId: page === 'session-files' ? (param as XopcMobileRoute).itemId : '', onExit: (): void => { this.pathStack.pop(); } })
    } else if (page === 'automation-run') {
      XopcAutomationRunView({ runId: (param as XopcMobileRoute).itemId, onExit: (): void => { this.pathStack.pop(); },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
    } else if (page === 'sharing') {
      XopcShareCenterView({ onExit: (): void => { this.pathStack.pop(); } })
    } else if (page === 'about-you') {
      XopcAboutYouView({ initialId: (param as XopcMobileRoute).itemId, onExit: (): void => { this.pathStack.pop(); },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
    } else {
      NavDestination() {
        if (page === 'settings') {
          XopcSettingsView({ initialSection: (param as XopcMobileRoute).itemId, useNavigation: true,
            onExit: (): void => { this.pathStack.pop(); },
            onOpenSection: (section: string): void => { this.navigate({ page: 'settings', itemId: section }); },
            onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
            onDisconnected: (): void => { this.onDisconnected(); } })
        }
        else { Text($r('app.string.unsupported_route')).fontColor(this.colors.secondary).padding(20) }
      }.hideTitleBar(page === 'settings').title($r('app.string.back')).backgroundColor(this.colors.surface)
    }
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Navigation(this.pathStack) {
        Stack({ alignContent: Alignment.TopStart }) {
          Column() {
            if (this.chatReady) {
              XopcChatView({ requestedId: this.requestedChatId, requestRevision: this.chatRequestRevision,
                personalAgent: this.personalAgent.record,
                pendingAttention: this.pendingAttention,
                onPersonalAgentSaved: (record: XopcPersonalAgentRecord): void => { this.personalAgent.record = record; },
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
                onLocalChatCreated: (id: string): void => { this.rememberConversation(id); },
                onConversationUnavailable: (id: string): void => { this.onConversationUnavailable(id); },
                onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
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
              onClose: (): void => { this.closeSidebar(); },
              onPersonal: (): void => { void this.openPersonalChat(); },
              onNew: (): void => { void this.openOrdinaryChat(); },
              onConversation: (id: string): void => { this.openConversationFromList(id); },
              onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
          }
        }.width('100%').height(LayoutPolicy.matchParent)
          .ignoreLayoutSafeArea([LayoutSafeAreaType.SYSTEM], [LayoutSafeAreaEdge.TOP])
      }.hideTitleBar(true).mode(NavigationMode.Stack).navDestination(this.destination)
        .onNavBarStateChange((shown: boolean): void => { this.detailVisible = !shown; })
        .width('100%').height('100%').backgroundColor(this.colors.surface)
      if (!this.recordingPanel.dismissed && (this.capture.active || this.capture.phase === 'completed') && this.recordingViewportWidth > 0 && this.recordingViewportHeight > 0) {
        XopcDiscussionRecordingPanelView({ panel: this.recordingPanel,viewportWidth: this.recordingViewportWidth,viewportHeight: this.recordingViewportHeight,
          onSaved: (_id: string): void => {},
          onOpenNote: (id: string): void => { this.recordingPanel.setCompact(true); this.navigate({ page: 'notes',itemId: id }); },
          onRecovery: (): void => { this.pathStack.clear(); this.navigate({ page: 'library', itemId: '' }); void this.capture.refreshPending(this.getUIContext().getHostContext() as common.UIAbilityContext); } })
      }
      XopcShareIntakeDialog({ currentConversationId: this.activeChatId, onExplore: async (value: XopcIncomingShare, targetId: string): Promise<boolean> => await this.exploreShare(value, targetId),
        onSaved: (noteId: string): void => { this.navigate({ page: 'notes', itemId: noteId }); } })
    }.width('100%').height('100%')
      .onAreaChange((_previous: Area,current: Area): void => { this.recordingViewportWidth = Number(current.width); this.recordingViewportHeight = Number(current.height); })

  }
}
