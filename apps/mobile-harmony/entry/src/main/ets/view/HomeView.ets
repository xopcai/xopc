import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatView } from './ChatView';
import { XopcSessionsView } from './SessionsView';
import { XopcWorkspaceView } from './WorkspaceView';
import { XopcNotesView } from './NotesView';
import { XopcNotesTabView } from './NotesTabView';
import { XopcFilesView } from './FilesView';
import { XopcSettingsView } from './SettingsView';
import { XopcProgressView } from './HomeHubs';
import { XopcPersonalView } from './PersonalView';
import { XopcWorkflowView } from './WorkflowView';
import { XopcAutomationRunView } from './AutomationRunView';
import { XopcShareCenterView } from './ShareCenterView';
import { XopcShareIntakeDialog } from './ShareIntakeDialog';
import { XopcIncomingShare } from '../model/share';
import { XopcChatRepository } from '../repository/chatRepository';
import { shareIntake, XopcShareIntake } from '../service/shareIntake';
import { XopcMobileRoute } from '../model/home';
import { pushNotifications } from '../service/pushNotifications';
import { notificationNavigation } from '../service/notificationNavigation';
import { XopcNotificationRoute } from '../common/notificationRoute';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { XopcProgressViewModel } from '../viewmodel/homeViewModel';
import { XopcSection } from '../model/workspace';
import { accessibility } from '@kit.AccessibilityKit';

@ComponentV2
export struct XopcHomeView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local tab: number = 0;
  @Local detailVisible: boolean = false;
  @Local layout: XopcLayoutState = layoutState;
  @Local attention: XopcProgressViewModel = new XopcProgressViewModel();
  @Local requestedChatId: string = '';
  @Local requestedChatDraft: string = '';
  @Local chatRequestRevision: number = 0;
  @Local chatFocusRevision: number = 0;
  @Local quickDraft: string = '';
  @Local quickSending: boolean = false;
  @Local creationSheetOpen: boolean = false;
  @Local creationChatId: string = '';
  @Local creationChatDraft: string = '';
  @Local creationChatRevision: number = 0;
  @Local creationHandoffPending: boolean = false;
  @Local intake: XopcShareIntake = shareIntake;
  private chatRepository: XopcChatRepository = new XopcChatRepository();
  private readonly onMotionChange = (reduced: boolean): void => { layoutState.reduceMotion = reduced; };
  private attentionTimer: number = -1;
  private pathStack: NavPathStack = new NavPathStack();
  @Event onDisconnected: () => void = (): void => {};

  aboutToAppear(): void {
    pushNotifications.restore();
    try {
      layoutState.reduceMotion = accessibility.isAnimationReduceEnabledSync();
      accessibility.onAnimationReduceStateChange(this.onMotionChange);
    } catch (_) { layoutState.reduceMotion = true; }
    notificationNavigation.onTarget = (route: XopcNotificationRoute): void => {
      if (route.target.kind === 'home') { this.pathStack.clear(); this.tab = 0; }
      else if (route.target.conversationId) this.navigate({ page: 'chat', itemId: route.target.conversationId });
      else if (route.target.taskId) this.navigate({ page: 'tasks', itemId: route.target.taskId });
      else if (route.target.automationId) this.navigate({ page: 'automations', itemId: route.target.automationId });
    };
    notificationNavigation.consume();
    this.attention.refresh();
    this.attentionTimer = setInterval((): void => { this.attention.refresh(); }, 30000);
  }
  aboutToDisappear(): void {
    notificationNavigation.onTarget = undefined; clearInterval(this.attentionTimer); this.attention.dispose();
    try { accessibility.offAnimationReduceStateChange(this.onMotionChange); } catch (_) {}
  }
  private navigate(route: XopcMobileRoute): void {
    if (route.page === 'chat') {
      if (route.itemId) { this.requestedChatId = route.itemId; this.requestedChatDraft = ''; this.chatRequestRevision++; }
      this.pathStack.clear(); this.transitionToTab(0); return;
    }
    if (route.page === 'progress') { this.pathStack.clear(); this.transitionToTab(1); return; }
    this.pathStack.pushPath({ name: route.page, param: route });
  }
  private async exploreShare(value: XopcIncomingShare): Promise<boolean> {
    try {
      const id = await this.chatRepository.create();
      this.intake.targetChat(id, value.chatPrompt); this.switchToChat(id, value.chatPrompt);
      return true;
    } catch (error) { this.getUIContext().getPromptAction().showToast({ message: (error as Error).message }); return false; }
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
      this.getUIContext().getPromptAction().showToast({ message: (error as Error).message });
    }
  }

  private transitionToTab(index: number): void {
    if (this.tab === index) return;
    this.getUIContext().animateTo({ duration: this.layout.reduceMotion ? 0 : 220, curve: Curve.EaseOut }, (): void => {
      this.tab = index;
    });
  }

  private switchToChat(id: string, prompt: string, focusComposer: boolean = false): void {
    this.requestedChatId = id;
    this.requestedChatDraft = prompt;
    this.chatRequestRevision++;
    if (focusComposer) this.chatFocusRevision++;
    this.pathStack.clear();
    this.transitionToTab(0);
  }

  private async sendQuickDraft(): Promise<void> {
    const prompt = this.quickDraft.trim();
    if (!prompt || this.quickSending) return;
    this.quickSending = true;
    try {
      const id = await this.chatRepository.create();
      this.quickDraft = '';
      this.intake.targetChat(id, prompt);
      this.switchToChat(id, prompt);
    } catch (error) {
      this.getUIContext().getPromptAction().showToast({ message: (error as Error).message });
    } finally { this.quickSending = false; }
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
        onOpen: (id: string): void => { this.navigate({ page: 'chat', itemId: id }); } })
    } else if (page === 'notes' || page === 'inbox' || page === 'note-create') {
      XopcNotesView({ initialId: (param as XopcMobileRoute).itemId, initialStatus: page === 'inbox' ? 'inbox' : '',
        createOnAppear: page === 'note-create', onExit: (): void => { this.pathStack.pop(); },
        onOpenConversation: (id: string): void => { this.navigate({ page: 'chat', itemId: id }); } })
    } else if (page === 'tasks' || page === 'projects' || page === 'automations') {
      XopcWorkspaceView({ section: page === 'tasks' ? 'tasks' : page === 'projects' ? 'projects' : 'automations',
        heading: page === 'tasks' ? $r('app.string.tasks') : page === 'projects' ? $r('app.string.projects') : $r('app.string.automations'),
        initialId: (param as XopcMobileRoute).itemId, onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
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
    } else {
      NavDestination() {
        if (page === 'settings') {
          XopcSettingsView({ initialSection: (param as XopcMobileRoute).itemId, useNavigation: true,
            onExit: (): void => { this.pathStack.pop(); },
            onOpenSection: (section: string): void => { this.navigate({ page: 'settings', itemId: section }); },
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
          SymbolGlyph(icon).fontSize(22).fontColor([this.tab === index ? this.colors.accent : this.colors.secondary])
        }.width(42).height(28).justifyContent(FlexAlign.Center).borderRadius(16)
          .backgroundColor(this.tab === index ? this.colors.active : Color.Transparent)
        if (index === 1 && this.attention.needsUser.length) {
          Text(this.attention.needsUser.length > 99 ? '99+' : this.attention.needsUser.length.toString()).fontSize(10)
            .fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft).borderRadius(8)
            .constraintSize({ minWidth: 16, minHeight: 16 }).textAlign(TextAlign.Center).position({ x: 15, y: -5 })
        }
      }
      Text(label).fontSize(11).fontWeight(FontWeight.Medium)
        .fontColor(this.tab === index ? this.colors.accent : this.colors.secondary)
    }.width('100%').height(44).justifyContent(FlexAlign.Center)
      .backgroundColor(Color.Transparent).borderRadius(26)
    }.id('main-tab-' + index).layoutWeight(1).height(44).padding(0).borderRadius(26).backgroundColor(Color.Transparent)
      .accessibilitySelected(this.tab === index)
      .onClick((): void => { this.transitionToTab(index); })
  }

  @Builder
  dockItems() {
    Row() {
      this.tabItem(0, $r('app.string.chat'), $r('sys.symbol.message'))
      this.tabItem(1, $r('app.string.progress'), $r('sys.symbol.checkmark_circle'))
      this.tabItem(2, $r('app.string.library'), $r('sys.symbol.square_stack_3d'))
      this.tabItem(3, $r('app.string.personal'), $r('sys.symbol.person'))
    }.width('100%').height(52).padding(4)
  }

  @Builder
  quickComposer() {
    Row({ space: 4 }) {
      SymbolGlyph($r('sys.symbol.message')).fontSize(20).fontColor([this.colors.secondary])
        .width(36).height(36)
      TextInput({ text: this.quickDraft, placeholder: $r('app.string.quick_chat_placeholder') })
        .id('home-quick-composer').layoutWeight(1).height(44).maxLength(4000)
        .padding({ left: 4, right: 4 }).enterKeyType(EnterKeyType.Send)
        .enabled(!this.quickSending)
        .fontSize(16).fontColor(this.colors.foreground).placeholderColor(this.colors.tertiary)
        .backgroundColor(Color.Transparent)
        .onChange((text: string): void => { this.quickDraft = text; })
        .onSubmit((_enterKey: EnterKeyType): void => { this.sendQuickDraft(); })
      Button({ type: ButtonType.Circle, stateEffect: true }) {
        if (this.quickSending) {
          LoadingProgress().width(20).height(20).color(this.colors.panel)
        } else {
          SymbolGlyph($r('sys.symbol.arrow_up')).fontSize(20)
            .fontColor([this.quickDraft.trim() ? this.colors.panel : this.colors.tertiary])
        }
      }.id('home-quick-send').width(44).height(44).padding(0)
        .backgroundColor(this.quickDraft.trim() || this.quickSending ? this.colors.foreground : this.colors.input)
        .enabled(Boolean(this.quickDraft.trim()) && !this.quickSending)
        .accessibilityText($r('app.string.send'))
        .onClick((): void => { this.sendQuickDraft(); })
    }.width('calc(100% - 16vp)').height(48).padding({ left: 4, right: 4, top: 2, bottom: 2 })
      .margin({ top: 8, bottom: 8 })
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
          onNavigate: (route: XopcMobileRoute): void => { this.creationSheetOpen = false; this.navigate(route); },
          onOpenConversation: (id: string): void => { this.creationSheetOpen = false; this.switchToChat(id, ''); } })
      }.layoutWeight(1).width('100%')
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
  }

  @LocalBuilder
  chatDock() {
    if (this.tab === 0 && this.layout.isMainDockVisible(0)) {
      Column() {
        this.dockItems()
      }.id('main-tab-dock').width('100%').backgroundColor(this.colors.panel)
    }
  }

  build() {
    Stack() {
      Navigation(this.pathStack) {
        Column() {
      Tabs({ barPosition: BarPosition.End, index: this.tab }) {
        TabContent() { XopcChatView({ requestedId: this.requestedChatId, requestRevision: this.chatRequestRevision,
          focusRevision: this.chatFocusRevision,
          intakeRevision: this.intake.chatRevision, intakeText: this.requestedChatDraft,
          bottomDock: this.chatDock,
          activePage: this.tab === 0 && !this.detailVisible, attentionItems: this.attention.needsUser, onAttentionRefresh: (): void => { this.attention.refresh(); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
          onOpenConversation: (id: string): void => { this.navigate({ page: 'chat', itemId: id }); } }) }
        TabContent() { XopcProgressView({ activePage: this.tab === 1 && !this.detailVisible, onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } }) }
        TabContent() { XopcNotesTabView({ activePage: this.tab === 2 && !this.detailVisible, onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } }) }
        TabContent() { XopcPersonalView({ onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } }) }
      }.scrollable(false).barHeight(0).barMode(BarMode.Fixed)
        .animationDuration(this.layout.reduceMotion ? 0 : 220)
        .onChange((index: number): void => { this.tab = index; })
        .width('100%').layoutWeight(1)
      if (this.tab !== 0) {
        Column() {
          this.quickComposer()
          if (this.layout.isMainDockVisible(this.tab)) { this.dockItems() }
        }.id('secondary-bottom-region').width('92%').backgroundColor(this.colors.panel)
          .borderRadius(20).clip(true).margin({ top: 4, bottom: this.layout.keyboardVisible ? 0 : 8 })
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
