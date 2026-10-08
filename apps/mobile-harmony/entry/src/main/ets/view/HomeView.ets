import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatView } from './ChatView';
import { CHAT_ACTION_PANEL_CLOSE_MS, CHAT_ACTION_PANEL_OPEN_MS, XopcChatActionPanel } from './ChatActionPanel';
import { XopcSessionsView } from './SessionsView';
import { XopcWorkspaceView } from './WorkspaceView';
import { XopcProjectSpaceView } from './ProjectSpaceView';
import { XopcNotesView } from './NotesView';
import { XopcNotesTabView } from './NotesTabView';
import { XopcFilesView } from './FilesView';
import { XopcSettingsView } from './SettingsView';
import { XopcProgressView } from './HomeHubs';
import { XopcPersonalView } from './PersonalView';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { XopcLoopi } from './Loopi';
import { XopcWorkflowView } from './WorkflowView';
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
import { XopcSection } from '../model/workspace';
import { accessibility } from '@kit.AccessibilityKit';
import { COMPOSER_INPUT_MIN, COMPOSER_TOOL_SIZE } from '../common/composerLayout';
import { XopcChatAttachment, XopcContextRef, XopcSessionItem } from '../model/chat';
import { quickChatIntake } from '../service/quickChatIntake';
import { pickChatAttachment } from '../service/chatAttachmentPicker';
import { pickChatPhoto } from '../service/chatPhotoPicker';
import { MAX_ATTACHMENTS } from '../common/attachments';
import { XopcBrandLoading } from './MobileComponents';
import { common } from '@kit.AbilityKit';
import { discussionCapture, XopcDiscussionCapture } from '../service/discussionCapture';
import { xopcFormatCaptureTime } from '../common/discussionAudio';

@ComponentV2
export struct XopcHomeView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local capture: XopcDiscussionCapture = discussionCapture;
  @Local tab: number = 0;
  @Computed get quickComposerPlaceholder(): ResourceStr {
    return this.tab === 2 ? $r('app.string.quick_chat_progress_placeholder')
      : this.tab === 3 ? $r('app.string.quick_chat_library_placeholder')
      : this.tab === 4 ? $r('app.string.quick_chat_personal_placeholder')
      : $r('app.string.quick_chat_conversations_placeholder');
  }
  @Local detailVisible: boolean = false;
  @Local layout: XopcLayoutState = layoutState;
  @Local secondaryBottomRegionHeight: number = 0;
  @Local attention: XopcProgressViewModel = new XopcProgressViewModel();
  @Local personalAgent: XopcPersonalAgentViewModel = new XopcPersonalAgentViewModel();
  @Local requestedChatId: string = '';
  @Local activeChatId: string = '';
  @Local requestedChatDraft: string = '';
  @Local chatRequestRevision: number = 0;
  @Local chatFocusRevision: number = 0;
  @Local quickDraft: string = '';
  @Local quickSending: boolean = false;
  @Local quickFiles: XopcChatAttachment[] = [];
  @Local quickPicking: boolean = false;
  @Local quickPanelOpen: boolean = false;
  @Local requestedChatAction: string = '';
  @Local chatActionRevision: number = 0;
  @Local creationSheetOpen: boolean = false;
  @Local creationChatId: string = '';
  @Local creationChatDraft: string = '';
  @Local creationChatRevision: number = 0;
  @Local creationHandoffPending: boolean = false;
  @Local returnToConversations: boolean = false;
  @Local pendingChatId: string = '';
  @Local intake: XopcShareIntake = shareIntake;
  private chatRepository: XopcChatRepository = new XopcChatRepository();
  private personalOpening: boolean = false;
  private quickEditor: TextInputController = new TextInputController();
  private deletedChatIds: Set<string> = new Set<string>();
  private replacementRevision: number = 0;
  private readonly onMotionChange = (reduced: boolean): void => { layoutState.reduceMotion = reduced; };
  private attentionTimer: number = -1;
  private pathStack: NavPathStack = new NavPathStack();
  @Event onDisconnected: () => void = (): void => {};

  aboutToAppear(): void {
    layoutState.dismissTabNavigation = (): boolean => this.handleTabBack();
    pushNotifications.restore();
    try {
      layoutState.reduceMotion = accessibility.isAnimationReduceEnabledSync();
      accessibility.onAnimationReduceStateChange(this.onMotionChange);
    } catch (_) { layoutState.reduceMotion = true; }
    notificationNavigation.onTarget = (route: XopcNotificationRoute): void => {
      if (route.target.kind === 'home') { this.returnToConversations = false; this.pathStack.clear(); this.tab = 0; }
      else if (route.target.conversationId) this.navigate({ page: 'chat', itemId: route.target.conversationId });
      else if (route.target.taskId) this.navigate({ page: 'tasks', itemId: route.target.taskId });
      else if (route.target.automationId) this.navigate({ page: 'automations', itemId: route.target.automationId });
    };
    notificationNavigation.consume();
    this.attention.refresh();
    void this.personalAgent.refresh();
    void this.restoreActiveChatId();
    this.attentionTimer = setInterval((): void => { this.attention.refresh(); }, 30000);
  }
  aboutToDisappear(): void {
    quickChatIntake.clear();
    this.setQuickPanel(false, false);
    layoutState.dismissTabNavigation = undefined;
    notificationNavigation.onTarget = undefined; clearInterval(this.attentionTimer); this.attention.dispose();
    try { accessibility.offAnimationReduceStateChange(this.onMotionChange); } catch (_) {}
  }
  private navigate(route: XopcMobileRoute): void {
    if (route.page === 'project-new-chat') { void this.openProjectChat(route.projectId ?? ''); return; }
    if (route.page === 'task-chat') { void this.openTaskChat(route); return; }
    if (route.page === 'understanding-chat') {
      void this.openUnderstandingChat(route);
      return;
    }
    if (route.page === 'chat') {
      this.replacementRevision++;
      this.pendingChatId = '';
      this.returnToConversations = false;
      if (route.itemId) { this.requestedChatId = route.itemId; this.requestedChatDraft = ''; this.chatRequestRevision++; }
      this.pathStack.clear(); this.activateTab(0); return;
    }
    if (route.page === 'progress') { this.pathStack.clear(); this.activateTab(2); return; }
    this.pathStack.pushPath({ name: route.page, param: route });
  }

  private async openProjectChat(projectId: string): Promise<void> {
    if (!projectId) return;
    try {
      const id = await this.chatRepository.create(projectId);
      this.navigate({ page: 'chat', itemId: id });
    } catch (error) {
      this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') });
    }
  }

  private async openTaskChat(route: XopcMobileRoute): Promise<void> {
    const taskId = route.itemId;
    if (!taskId) return;
    try {
      const id = await this.chatRepository.ensureTaskConversation(taskId);
      const target: XopcMobileRoute = {
        page: 'task-conversation', itemId: taskId, title: route.title, prompt: id, projectId: route.projectId
      };
      this.pathStack.pushPath({ name: 'task-conversation', param: target });
    } catch (error) {
      this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') });
    }
  }

  private async openUnderstandingChat(route: XopcMobileRoute): Promise<void> {
    try {
      const id = await this.chatRepository.create();
      const refs: XopcContextRef[] = route.itemId ? [{
        kind: 'user_assertion', sourceId: route.itemId,
        expectedVersion: route.version ?? '', title: route.title ?? ''
      }] : [];
      quickChatIntake.stage(id, route.prompt ?? '', refs);
      this.returnToConversations = false;
      this.switchToChat(id, '', true);
    } catch (error) {
      this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') });
    }
  }
  private async exploreShare(value: XopcIncomingShare): Promise<boolean> {
    try {
      const id = await this.chatRepository.create();
      this.intake.targetChat(id, value.chatPrompt); this.switchToChat(id, value.chatPrompt);
      return true;
    } catch (error) { this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') }); return false; }
  }

  private creationPrompt(kind: string): string {
    const resource: Resource = kind === 'automations' ? $r('app.string.create_automation_chat_prompt')
      : kind === 'projects' ? $r('app.string.create_project_chat_prompt')
      : kind === 'workflows' ? $r('app.string.create_workflow_chat_prompt')
      : $r('app.string.create_task_chat_prompt');
    return this.getUIContext().getHostContext()?.resourceManager.getStringSync(resource.id) ?? '';
  }

  private async openCreationChat(kind: string): Promise<void> {
    try {
      const prompt = this.creationPrompt(kind);
      if (!prompt) throw new Error('CREATION_PROMPT_UNAVAILABLE');
      const id = await this.chatRepository.create();
      this.creationChatId = id;
      this.creationChatDraft = prompt;
      this.creationChatRevision++;
      this.creationHandoffPending = false;
      this.intake.targetChat(id, prompt);
      this.creationSheetOpen = true;
    } catch (error) {
      this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') });
    }
  }

  private activateTab(index: number): void {
    if (this.tab === index) return;
    this.tab = index;
  }

  private selectTab(index: number): void {
    this.returnToConversations = false;
    this.setQuickPanel(false);
    this.activateTab(index);
  }

  private async startNoteCapture(): Promise<void> {
    this.selectTab(3);
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

  private handleTabBack(): boolean {
    if (this.quickPanelOpen) { this.setQuickPanel(false); return true; }
    if (this.tab !== 0 || !this.returnToConversations) return false;
    this.returnToConversations = false;
    this.activateTab(1);
    return true;
  }

  private switchToChat(id: string, prompt: string, focusComposer: boolean = false): void {
    this.replacementRevision++;
    this.pendingChatId = '';
    this.requestedChatId = id;
    this.requestedChatDraft = prompt;
    this.chatRequestRevision++;
    if (focusComposer) this.chatFocusRevision++;
    this.pathStack.clear();
    this.activateTab(0);
  }

  private async restoreActiveChatId(): Promise<void> {
    const revision = this.chatRequestRevision;
    try {
      const id = await this.chatRepository.mainConversation();
      if (revision === this.chatRequestRevision && !this.activeChatId && id) this.activeChatId = id;
    } catch (_) { /* The chat view still restores and reports its own selection. */ }
  }

  private async openPersonalChat(): Promise<void> {
    if (this.personalOpening) return;
    this.personalOpening = true;
    const originatingTab = this.tab;
    const selectedRevision = this.chatRequestRevision;
    try {
      const record = await this.personalAgent.openOrCreate();
      if (this.tab !== originatingTab || selectedRevision !== this.chatRequestRevision) return;
      if (!record) {
        this.getUIContext().getPromptAction().showToast({ message: userErrorMessage(this.personalAgent.error, 'save') });
        return;
      }
      this.returnToConversations = false;
      this.activeChatId = record.conversationId;
      this.switchToChat(record.conversationId, '');
    } finally {
      this.personalOpening = false;
    }
  }

  private openConversationFromList(id: string, focusComposer: boolean): void {
    this.returnToConversations = true;
    const pendingId = id === this.activeChatId ? '' : id;
    this.switchToChat(id, '', focusComposer);
    this.pendingChatId = pendingId;
  }

  private async replaceDeletedChat(id: string): Promise<void> {
    this.deletedChatIds.add(id);
    if (id !== this.activeChatId && id !== this.requestedChatId) return;
    const revision = ++this.replacementRevision;
    this.pendingChatId = 'replacement:' + id;
    try {
      let offset = 0;
      let latestId = '';
      let hasMore = true;
      while (hasMore && !latestId && revision === this.replacementRevision) {
        const page = await this.chatRepository.list('', offset, 20, '');
        latestId = page.items.find((item: XopcSessionItem): boolean => !this.deletedChatIds.has(item.key))?.key ?? '';
        offset += page.items.length;
        hasMore = page.hasMore && page.items.length > 0;
      }
      if (revision !== this.replacementRevision) return;
      const replacement = latestId || await this.chatRepository.create();
      if (revision !== this.replacementRevision) return;
      this.requestedChatId = replacement;
      this.requestedChatDraft = '';
      this.pendingChatId = replacement;
      this.chatRequestRevision++;
    } catch (error) {
      if (revision === this.replacementRevision) {
        this.pendingChatId = '';
        this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'collection') });
      }
    }
  }

  private async sendQuickDraft(): Promise<void> {
    const prompt = this.quickDraft.trim();
    if ((!prompt && !this.quickFiles.length) || this.quickSending || this.quickPicking) return;
    this.quickSending = true;
    this.setQuickPanel(false);
    try {
      const id = await this.chatRepository.create();
      quickChatIntake.enqueue(id, prompt, this.quickFiles);
      this.quickDraft = ''; this.quickFiles = [];
      this.returnToConversations = false;
      this.switchToChat(id, '');
    } catch (error) {
      this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') });
    } finally { this.quickSending = false; }
  }

  private async openQuickChat(action: string = ''): Promise<void> {
    if (this.quickSending) return;
    this.quickSending = true;
    this.setQuickPanel(false);
    try {
      const id = await this.chatRepository.create();
      this.requestedChatAction = action;
      if (action) this.chatActionRevision++;
      this.switchToChat(id, '', !action);
    } catch (error) {
      this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') });
    } finally { this.quickSending = false; }
  }

  private setQuickPanel(open: boolean, animated: boolean = true): void {
    if (this.quickPanelOpen === open) { layoutState.chatActionsOpen = open; return; }
    if (open) {
      this.quickEditor.stopEditing();
      this.getUIContext().getFocusController().clearFocus();
    }
    if (!animated || this.layout.reduceMotion) {
      this.quickPanelOpen = open; layoutState.chatActionsOpen = open;
      return;
    }
    this.getUIContext().animateTo({ duration: open ? CHAT_ACTION_PANEL_OPEN_MS : CHAT_ACTION_PANEL_CLOSE_MS,
      curve: open ? Curve.EaseOut : Curve.EaseInOut }, (): void => {
      this.quickPanelOpen = open; layoutState.chatActionsOpen = open;
    });
  }

  private chooseQuickAction(id: string): void {
    if (!this.quickPanelOpen || this.quickSending || this.quickPicking) return;
    this.setQuickPanel(false);
    if (id === 'photos') this.pickQuickFile('photo');
    else if (id === 'camera') this.pickQuickFile('camera');
    else if (id === 'document') this.pickQuickFile('document');
    else if (id === 'new-chat') void this.openQuickChat();
    else void this.openQuickChat(id);
  }

  private async pickQuickFile(kind: string): Promise<void> {
    const context = this.getUIContext().getHostContext();
    if (!context || this.quickSending || this.quickPicking || this.quickFiles.length >= MAX_ATTACHMENTS) return;
    this.quickPicking = true;
    try {
      const file = kind === 'document' ? await pickChatAttachment(context, this.quickFiles)
        : await pickChatPhoto(context, this.quickFiles, kind === 'camera');
      if (file) this.quickFiles = this.quickFiles.concat([file]);
    } catch (error) { this.getUIContext().getPromptAction().showToast({ message: userErrorMessage((error as Error).message, 'save') }); }
    finally { this.quickPicking = false; }
  }

  private continueCreationChat(): void {
    if (!this.creationChatId) return;
    this.creationHandoffPending = true;
    this.creationSheetOpen = false;
  }

  private completeCreationHandoff(): void {
    if (!this.creationHandoffPending || !this.creationChatId) return;
    this.creationHandoffPending = false;
    // The embedded chat owns the live draft. Let the full chat restore that same draft instead of reapplying the seed prompt.
    this.switchToChat(this.creationChatId, '', true);
  }

  @Builder
  destination(page: string, param: Object) {
    if (page === 'sessions') {
      XopcSessionsView({ onExit: (): void => { this.pathStack.pop(); },
        onOpen: (id: string): void => { this.navigate({ page: 'chat', itemId: id }); },
        onNew: (id: string): void => { this.navigate({ page: 'chat', itemId: id }); } })
    } else if (page === 'notes' || page === 'inbox' || page === 'note-create') {
      XopcNotesView({ initialId: (param as XopcMobileRoute).itemId, initialStatus: page === 'inbox' ? 'inbox' : '',
        createOnAppear: page === 'note-create', projectId: (param as XopcMobileRoute).projectId ?? '',
        onExit: (): void => { this.pathStack.pop(); },
        onOpenConversation: (id: string): void => { this.navigate({ page: 'chat', itemId: id }); } })
    } else if (page === 'project-detail' || (page === 'projects' && !!(param as XopcMobileRoute).itemId)) {
      XopcProjectSpaceView({ projectId: (param as XopcMobileRoute).itemId,
        onExit: (): void => { this.pathStack.pop(); },
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
    } else if (page === 'task-conversation') {
      NavDestination() {
        Column() {
          Row({ space: 8 }) {
            Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([this.colors.foreground]) }
              .width(44).height(44).padding(0).backgroundColor(Color.Transparent)
              .accessibilityText($r('app.string.back')).onClick((): void => { this.pathStack.pop(); })
            Text((param as XopcMobileRoute).title || $r('app.string.task_open_conversation'))
              .fontSize(18).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
              .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          }.width('100%').padding({ left: 8, right: 20, top: 8, bottom: 4 })
          Column() {
            XopcChatView({ requestedId: (param as XopcMobileRoute).prompt ?? '',
              taskId: (param as XopcMobileRoute).itemId, activePage: true, embedded: true,
              onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
          }.layoutWeight(1).width('100%')
        }.width('100%').height('100%').backgroundColor(this.colors.surface)
      }.hideTitleBar(true).onBackPressed((): boolean => { this.pathStack.pop(); return true; })
    } else if (page === 'tasks' || page === 'projects' || page === 'automations' || page === 'project-settings'
      || page === 'task-create' || page === 'automation-create') {
      XopcWorkspaceView({ section: page === 'tasks' || page === 'task-create' ? 'tasks'
        : page === 'projects' || page === 'project-settings' ? 'projects' : 'automations',
        heading: page === 'tasks' || page === 'task-create' ? $r('app.string.tasks')
          : page === 'projects' || page === 'project-settings' ? $r('app.string.projects') : $r('app.string.automations'),
        initialId: (param as XopcMobileRoute).itemId, onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
        createOnAppear: page === 'task-create' || page === 'automation-create',
        projectId: (param as XopcMobileRoute).projectId ?? '',
        onCreateWithChat: async (section: XopcSection): Promise<void> => { await this.openCreationChat(section); },
        onExit: (): void => { this.pathStack.pop(); } })
    } else if (page === 'files' || page === 'session-files') {
      XopcFilesView({ initialId: page === 'files' ? (param as XopcMobileRoute).itemId : '',
        conversationId: page === 'session-files' ? (param as XopcMobileRoute).itemId : '', onExit: (): void => { this.pathStack.pop(); } })
    } else if (page === 'workflows') {
      XopcWorkflowView({ initialId: (param as XopcMobileRoute).itemId,
        onCreateWithChat: async (): Promise<void> => { await this.openCreationChat('workflows'); } })
    } else if (page === 'automation-run') {
      XopcAutomationRunView({ runId: (param as XopcMobileRoute).itemId,
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

  @Builder
  tabItem(index: number, label: ResourceStr, icon: Resource) {
    Button({ type: ButtonType.Normal }) {
    Column({ space: 3 }) {
      Stack({ alignContent: Alignment.TopEnd }) {
        Row() {
          if (index === 0) {
            if (this.personalAgent.record?.state === 'ready'
              && this.personalAgent.record.conversationId === this.activeChatId) {
              XopcPersonalAgentAvatar({ extent: 28, compact: true, activePage: this.tab === 0 && !this.detailVisible,
                agentId: this.personalAgent.record.agentId,
                appearance: this.personalAgent.record.appearance }).id('assistant-tab-personal-avatar')
            } else {
              XopcLoopi({ extent: 28, compact: true, activePage: this.tab === 0 && !this.detailVisible }).id('assistant-tab-loopi')
            }
          } else {
            SymbolGlyph(icon).fontSize(22).fontColor([this.tab === index ? this.colors.accent : this.colors.secondary])
          }
        }.width(42).height(28).justifyContent(FlexAlign.Center).borderRadius(16)
          .backgroundColor(this.tab === index ? this.colors.active : Color.Transparent)
        if (index === 2 && this.attention.needsUser.length) {
          Text(this.attention.needsUser.length > 99 ? '99+' : this.attention.needsUser.length.toString()).fontSize(10)
            .fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft).borderRadius(8)
            .constraintSize({ minWidth: 16, minHeight: 16 }).textAlign(TextAlign.Center).position({ x: 15, y: -5 })
        }
      }
      Text(label).fontSize(11).fontWeight(FontWeight.Medium)
        .fontColor(this.tab === index ? this.colors.accent : this.colors.secondary)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
    }.width('100%').height(44).justifyContent(FlexAlign.Center)
      .backgroundColor(Color.Transparent).borderRadius(26)
    }.id('main-tab-' + index).layoutWeight(1).height(44).padding(0).borderRadius(26).backgroundColor(Color.Transparent)
      .accessibilitySelected(this.tab === index)
      .onClick((): void => { this.selectTab(index); })
  }

  @Builder
  dockItems() {
    Row() {
      this.tabItem(0, this.personalAgent.record?.state === 'ready'
        && this.personalAgent.record.conversationId === this.activeChatId
        ? this.personalAgent.record.displayName : $r('app.string.assistant'), $r('sys.symbol.ellipsis_bubble'))
      this.tabItem(1, $r('app.string.conversations'), $r('sys.symbol.message'))
      this.tabItem(2, $r('app.string.progress'), $r('sys.symbol.checkmark_circle'))
      this.tabItem(3, $r('app.string.notes'), $r('sys.symbol.doc'))
      this.tabItem(4, $r('app.string.personal'), $r('sys.symbol.person'))
    }.width('100%').height(52).padding(4)
  }

  @Builder
  noteCaptureBar() {
    if (this.capture.active) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 10 }) {
          Row() {}.width(9).height(9).borderRadius(5).backgroundColor(this.colors.danger)
          Text(xopcFormatCaptureTime(this.capture.elapsedMs)).fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground)
          Text(this.capture.phase === 'organizing' || this.capture.phase === 'stopping'
            ? $r('app.string.capture_saving') : this.capture.phase === 'paused'
              ? $r('app.string.capture_paused') : $r('app.string.capture_live'))
            .fontSize(14).fontColor(this.colors.secondary).layoutWeight(1)
          SymbolGlyph($r('sys.symbol.chevron_up')).fontSize(14).fontColor([this.colors.tertiary])
        }.width('100%').height(48).padding({ left: 16, right: 14 })
      }.id('note-capture-mini').width('100%').height(48).padding(0).backgroundColor(this.colors.input)
        .borderRadius(16).accessibilityText($r('app.string.capture_open_details'))
        .onClick((): void => { this.selectTab(3); })
    }
  }

  private disabledQuickActionIds(): string[] {
    return this.quickFiles.length >= MAX_ATTACHMENTS ? ['photos', 'camera', 'document'] : [];
  }

  @Builder
  quickComposer() {
    Column() {
      if (this.quickFiles.length) {
        ForEach(this.quickFiles, (file: XopcChatAttachment, index: number) => {
          Row({ space: 8 }) {
            if (file.mimeType.startsWith('image/') && file.data) {
              Image('data:' + file.mimeType + ';base64,' + file.data).width(40).height(40).objectFit(ImageFit.Cover).borderRadius(8)
            }
            Text(file.name).fontSize(13).fontColor(this.colors.foreground).maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
            Button($r('app.string.remove_attachment')).height(40).fontSize(12).backgroundColor(Color.Transparent)
              .fontColor(this.colors.secondary).enabled(!this.quickSending && !this.quickPicking)
              .onClick((): void => { this.quickFiles = this.quickFiles.filter((_file: XopcChatAttachment, position: number): boolean => position !== index); })
          }.width('100%').padding({ left: 12, right: 8, top: 4 })
        }, (file: XopcChatAttachment, index: number): string => file.name + ':' + index)
      }
      Row({ space: 4 }) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.mic')).fontSize(22).fontColor([this.colors.accent])
        }.id('home-quick-voice').width(COMPOSER_TOOL_SIZE).height(COMPOSER_TOOL_SIZE).padding(0)
          .backgroundColor(this.colors.input).responseRegion({ x: -4, y: -4, width: 44, height: 44 })
          .accessibilityText($r('app.string.assistant')).enabled(!this.quickSending)
          .onClick((): void => { void this.openQuickChat(); })
        TextInput({ text: this.quickDraft, placeholder: this.quickComposerPlaceholder, controller: this.quickEditor })
          .id('home-quick-composer').layoutWeight(1).height(COMPOSER_INPUT_MIN).maxLength(4000)
          .padding({ left: 4, right: 4 }).enterKeyType(EnterKeyType.Send)
          .enabled(!this.quickSending && !this.quickPicking).lineHeight(20)
          .fontSize(16).fontColor(this.colors.foreground).placeholderColor(this.colors.tertiary)
          .backgroundColor(Color.Transparent)
          .onChange((text: string): void => { this.quickDraft = text; })
          .onEditChange((editing: boolean): void => { if (editing) this.setQuickPanel(false); })
          .onSubmit((_enterKey: EnterKeyType): void => { this.sendQuickDraft(); })
        if (this.quickFiles.length < MAX_ATTACHMENTS) {
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph(this.quickPanelOpen ? $r('sys.symbol.xmark_circle') : $r('sys.symbol.plus_circle'))
              .fontSize(24).fontColor([this.colors.accent])
          }.id('home-quick-actions').width(COMPOSER_TOOL_SIZE).height(COMPOSER_TOOL_SIZE).padding(0)
            .backgroundColor(this.colors.input).responseRegion({ x: -4, y: -4, width: 44, height: 44 })
            .enabled(!this.quickSending && !this.quickPicking).accessibilityText($r('app.string.add_attachment'))
            .onClick((): void => { this.setQuickPanel(!this.quickPanelOpen); })
        }
        if (this.quickDraft.trim() || this.quickFiles.length) {
          Button({ type: ButtonType.Circle }) {
            if (this.quickSending) {
              LoadingProgress().width(20).height(20).color(this.colors.panel)
            } else {
              SymbolGlyph($r('sys.symbol.arrow_up')).fontSize(22).fontColor([this.colors.panel])
            }
          }.id('home-quick-send').width(COMPOSER_TOOL_SIZE).height(COMPOSER_TOOL_SIZE).padding(0)
            .backgroundColor(this.colors.foreground).responseRegion({ x: -4, y: -4, width: 44, height: 44 })
            .enabled(!this.quickSending && !this.quickPicking).accessibilityText($r('app.string.send'))
            .onClick((): void => { this.sendQuickDraft(); })
        }
      }.width('100%').padding({ left: 4, right: 4, top: 4, bottom: 4 })
    }.id('home-quick-composer-shell').width('calc(100% - 16vp)').backgroundColor(this.colors.input)
      .borderRadius(18).clip(true).margin({ top: 8, bottom: 8 })
  }

  @Builder
  creationChatSheet() {
    Column() {
      Row({ space: 8 }) {
        Column({ space: 2 }) {
          Text($r('app.string.ai_create')).fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
          Text($r('app.string.ai_create_hint')).fontSize(12).fontColor(this.colors.secondary)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Button($r('app.string.continue_in_chat')).height(40).padding({ left: 14, right: 14 })
          .backgroundColor(this.colors.input).fontColor(this.colors.foreground)
          .onClick((): void => { this.continueCreationChat(); })
        Button({ type: ButtonType.Circle, stateEffect: true }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(17).fontColor([this.colors.secondary])
        }.id('creation-chat-close').width(40).height(40).padding(0).backgroundColor(this.colors.input)
          .accessibilityText($r('app.string.close'))
          .onClick((): void => { this.creationHandoffPending = false; this.creationSheetOpen = false; })
      }.width('100%').padding({ left: 20, right: 12, top: 4, bottom: 8 })
      Column() {
        XopcChatView({ requestedId: this.creationChatId, requestRevision: this.creationChatRevision,
          intakeRevision: this.intake.chatRevision, intakeText: this.creationChatDraft,
          activePage: this.creationSheetOpen, embedded: true, attentionItems: [],
          onNavigate: (route: XopcMobileRoute): void => { this.creationSheetOpen = false; this.navigate(route); } })
      }.layoutWeight(1).width('100%')
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
  }

  @LocalBuilder
  chatDock() {
    if (this.tab === 0 && this.layout.isMainDockVisible(0)) {
      Column() {
        if (this.capture.active) { this.noteCaptureBar() }
        this.dockItems()
      }.id('main-tab-dock').width('100%')
    }
  }

  build() {
    Stack() {
      Navigation(this.pathStack) {
        Stack({ alignContent: Alignment.Bottom }) {
      Column() {
      Tabs({ barPosition: BarPosition.End, index: this.tab }) {
        TabContent() { XopcChatView({ requestedId: this.requestedChatId, requestRevision: this.chatRequestRevision,
          personalAgent: this.personalAgent.record,
          focusRevision: this.chatFocusRevision,
          requestedAction: this.requestedChatAction, actionRevision: this.chatActionRevision,
          intakeRevision: this.intake.chatRevision, intakeText: this.requestedChatDraft,
          bottomDock: this.chatDock,
          activePage: this.tab === 0 && !this.detailVisible, attentionItems: this.attention.needsUser, onAttentionRefresh: (): void => { this.attention.refresh(); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
          onConversationChange: (id: string): void => {
            this.activeChatId = id;
            if (this.pendingChatId === id) this.pendingChatId = '';
          } }) }
        TabContent() { XopcSessionsView({ embedded: true, bottomInset: this.secondaryBottomRegionHeight, activePage: this.tab === 1 && !this.detailVisible,
          currentId: this.activeChatId, personalAgent: this.personalAgent.record, personalBusy: this.personalAgent.creating,
          onOpenPersonal: (): void => { void this.openPersonalChat(); },
          onOpen: (id: string): void => { this.openConversationFromList(id, false); },
          onNew: (id: string): void => { this.openConversationFromList(id, true); },
          onDelete: (id: string): void => { void this.replaceDeletedChat(id); },
          onUndoDelete: (id: string): void => {
            this.deletedChatIds.delete(id);
            if (this.pendingChatId === 'replacement:' + id) { this.replacementRevision++; this.pendingChatId = ''; }
          } }) }
        TabContent() { XopcProgressView({ bottomInset: this.secondaryBottomRegionHeight, activePage: this.tab === 2 && !this.detailVisible, onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } }) }
        TabContent() { XopcNotesTabView({ activePage: this.tab === 3 && !this.detailVisible,
          bottomInset: this.secondaryBottomRegionHeight,
          onStartVoice: (): void => { void this.startNoteCapture(); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } }) }
        TabContent() { XopcPersonalView({ activePage: this.tab === 4 && !this.detailVisible,
          bottomInset: this.secondaryBottomRegionHeight,
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } }) }
      }.scrollable(false).barHeight(0).barMode(BarMode.Fixed)
        .animationDuration(0)
        .onChange((index: number): void => { this.tab = index; })
        .width('100%').layoutWeight(1)
      }.id('home-tab-viewport').width('100%').height('100%')
        .clip(true)
      if (this.tab === 0 && this.pendingChatId) {
        Column() {
          XopcBrandLoading({ reduceMotion: this.layout.reduceMotion })
        }.id('chat-navigation-loading').width('100%').height('100%')
          .justifyContent(FlexAlign.Center).backgroundColor(this.colors.surface)
      }
      if (this.tab !== 0) {
        Column().id('secondary-dock-corner-mask').width('100%').height(24).backgroundColor(this.colors.surface)
        Column() {
          Column() {
            if (this.capture.active) {
              this.noteCaptureBar()
            } else {
              this.quickComposer()
              XopcChatActionPanel({ open: this.quickPanelOpen, idPrefix: 'home-quick-action',
                disabledIds: this.disabledQuickActionIds(),
                onSelect: (id: string): void => { this.chooseQuickAction(id); } })
            }
            if (this.layout.isMainDockVisible(this.tab)) { this.dockItems() }
          }.id('secondary-bottom-surface').width('calc(100% - 16vp)').backgroundColor(this.colors.panel)
            .borderRadius(24).clip(true)
        }.id('secondary-bottom-region').width('100%')
          .margin({ top: 4, bottom: 0 })
          .onAreaChange((_previous: Area, current: Area): void => {
            this.secondaryBottomRegionHeight = Number(current.height);
          })
      }
        }.width('100%').height('100%')
      }.hideTitleBar(true).mode(NavigationMode.Stack).navDestination(this.destination)
        .onNavBarStateChange((shown: boolean): void => { this.detailVisible = !shown; })
        .width('100%').height('100%').backgroundColor(this.colors.surface)
      XopcShareIntakeDialog({ onExplore: async (value: XopcIncomingShare): Promise<boolean> => await this.exploreShare(value),
        onSaved: (noteId: string): void => { this.navigate({ page: 'notes', itemId: noteId }); } })
    }.width('100%').height('100%')
      .bindSheet($$this.creationSheetOpen, this.creationChatSheet, {
        height: SheetSize.LARGE, dragBar: true, showClose: false, backgroundColor: this.colors.surface,
        enableOutsideInteractive: false, keyboardAvoidMode: SheetKeyboardAvoidMode.RESIZE_ONLY,
        onDisappear: (): void => { this.completeCreationHandoff(); }
      })
  }
}
