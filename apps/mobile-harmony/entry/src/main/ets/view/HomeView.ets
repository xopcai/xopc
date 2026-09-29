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
import { XopcAboutYouView } from './AboutYouView';
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
import { COMPOSER_INPUT_MIN, COMPOSER_TOOL_SIZE } from '../common/composerLayout';
import { XopcChatAttachment, XopcContextRef } from '../model/chat';
import { quickChatIntake } from '../service/quickChatIntake';
import { pickChatAttachment } from '../service/chatAttachmentPicker';
import { pickChatPhoto } from '../service/chatPhotoPicker';
import { MAX_ATTACHMENTS } from '../common/attachments';

@ComponentV2
export struct XopcHomeView {
  @Local colors: XopcThemeColors = appThemeColors;
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
  @Local intake: XopcShareIntake = shareIntake;
  private chatRepository: XopcChatRepository = new XopcChatRepository();
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
    this.attentionTimer = setInterval((): void => { this.attention.refresh(); }, 30000);
  }
  aboutToDisappear(): void {
    quickChatIntake.clear();
    this.setQuickPanel(false);
    layoutState.dismissTabNavigation = undefined;
    notificationNavigation.onTarget = undefined; clearInterval(this.attentionTimer); this.attention.dispose();
    try { accessibility.offAnimationReduceStateChange(this.onMotionChange); } catch (_) {}
  }
  private navigate(route: XopcMobileRoute): void {
    if (route.page === 'understanding-chat') {
      void this.openUnderstandingChat(route);
      return;
    }
    if (route.page === 'chat') {
      this.returnToConversations = false;
      if (route.itemId) { this.requestedChatId = route.itemId; this.requestedChatDraft = ''; this.chatRequestRevision++; }
      this.pathStack.clear(); this.activateTab(0); return;
    }
    if (route.page === 'progress') { this.pathStack.clear(); this.activateTab(2); return; }
    this.pathStack.pushPath({ name: route.page, param: route });
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
      this.getUIContext().getPromptAction().showToast({ message: (error as Error).message });
    }
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

  private activateTab(index: number): void {
    if (this.tab === index) return;
    this.tab = index;
  }

  private selectTab(index: number): void {
    this.returnToConversations = false;
    this.setQuickPanel(false);
    this.activateTab(index);
  }

  private handleTabBack(): boolean {
    if (this.quickPanelOpen) { this.setQuickPanel(false); return true; }
    if (this.tab !== 0 || !this.returnToConversations) return false;
    this.returnToConversations = false;
    this.activateTab(1);
    return true;
  }

  private switchToChat(id: string, prompt: string, focusComposer: boolean = false): void {
    this.requestedChatId = id;
    this.requestedChatDraft = prompt;
    this.chatRequestRevision++;
    if (focusComposer) this.chatFocusRevision++;
    this.pathStack.clear();
    this.activateTab(0);
  }

  private openConversationFromList(id: string, focusComposer: boolean): void {
    this.returnToConversations = true;
    this.switchToChat(id, '', focusComposer);
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
      this.getUIContext().getPromptAction().showToast({ message: (error as Error).message });
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
      this.getUIContext().getPromptAction().showToast({ message: (error as Error).message });
    } finally { this.quickSending = false; }
  }

  private setQuickPanel(open: boolean): void {
    this.quickPanelOpen = open;
    layoutState.chatActionsOpen = open;
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
    } catch (error) { this.getUIContext().getPromptAction().showToast({ message: (error as Error).message }); }
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
          SymbolGlyph(icon).fontSize(22).fontColor([this.tab === index ? this.colors.accent : this.colors.secondary])
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
    }.width('100%').height(44).justifyContent(FlexAlign.Center)
      .backgroundColor(Color.Transparent).borderRadius(26)
    }.id('main-tab-' + index).layoutWeight(1).height(44).padding(0).borderRadius(26).backgroundColor(Color.Transparent)
      .accessibilitySelected(this.tab === index)
      .onClick((): void => { this.selectTab(index); })
  }

  @Builder
  dockItems() {
    Row() {
      this.tabItem(0, $r('app.string.assistant'), $r('sys.symbol.ellipsis_bubble'))
      this.tabItem(1, $r('app.string.conversations'), $r('sys.symbol.message'))
      this.tabItem(2, $r('app.string.progress'), $r('sys.symbol.checkmark_circle'))
      this.tabItem(3, $r('app.string.library'), $r('sys.symbol.square_stack_3d'))
      this.tabItem(4, $r('app.string.personal'), $r('sys.symbol.person'))
    }.width('100%').height(52).padding(4)
  }

  @Builder
  quickActionTile(id: string, label: Resource, symbol: Resource, enabled: boolean) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 6 }) {
        Row() {
          SymbolGlyph(symbol).fontSize(24).fontColor([this.colors.foreground])
        }.width(48).height(48).justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
          .borderRadius(14).backgroundColor(this.colors.input)
        Text(label).fontSize(12).fontColor(this.colors.secondary).maxLines(2).textAlign(TextAlign.Center)
      }.width('100%')
    }.id('home-quick-action-' + id).width('25%').height(84).padding(2).backgroundColor(Color.Transparent)
      .accessibilityText(label).enabled(enabled).onClick((): void => { this.chooseQuickAction(id); })
  }

  @Builder
  quickActionPanel() {
    Swiper() {
      Column({ space: 4 }) {
        Row() {
          this.quickActionTile('photos', $r('app.string.chat_photos'), $r('sys.symbol.picture'), this.quickFiles.length < MAX_ATTACHMENTS)
          this.quickActionTile('camera', $r('app.string.chat_camera'), $r('sys.symbol.camera'), this.quickFiles.length < MAX_ATTACHMENTS)
          this.quickActionTile('document', $r('app.string.chat_local_files'), $r('sys.symbol.folder'), this.quickFiles.length < MAX_ATTACHMENTS)
          this.quickActionTile('record-voice', $r('app.string.record_voice'), $r('sys.symbol.mic'), true)
        }.width('100%')
        Row() {
          this.quickActionTile('reference-note', $r('app.string.chat_reference_note'), $r('sys.symbol.doc'), true)
          this.quickActionTile('reference-task', $r('app.string.chat_reference_task'), $r('sys.symbol.checkmark_circle'), true)
          this.quickActionTile('reference-file', $r('app.string.chat_reference_file'), $r('sys.symbol.folder'), true)
          this.quickActionTile('new-chat', $r('app.string.new_chat'), $r('sys.symbol.square_and_pencil'), true)
        }.width('100%')
      }.width('100%').padding({ left: 6, right: 6, top: 4, bottom: 20 })
      Column({ space: 4 }) {
        Row() {
          this.quickActionTile('voice-no-tools', $r('app.string.voice_call_action_natural'), $r('sys.symbol.waveform'), true)
          this.quickActionTile('voice-with-tools', $r('app.string.voice_call_action_assistant'), $r('sys.symbol.speaker_wave_2'), true)
        }.width('100%')
      }.width('100%').padding({ left: 6, right: 6, top: 4, bottom: 20 })
    }.id('home-quick-action-panel').width('100%').height(196).loop(false).autoPlay(false)
      .indicator(new DotIndicator().itemWidth(6).itemHeight(6).selectedItemWidth(6).selectedItemHeight(6)
        .color(this.colors.border).selectedColor(this.colors.secondary))
      .backgroundColor(this.colors.panel).borderRadius(18).clip(true).margin({ bottom: 8 })
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
        TextInput({ text: this.quickDraft, placeholder: this.quickComposerPlaceholder })
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
          focusRevision: this.chatFocusRevision,
          requestedAction: this.requestedChatAction, actionRevision: this.chatActionRevision,
          intakeRevision: this.intake.chatRevision, intakeText: this.requestedChatDraft,
          bottomDock: this.chatDock,
          activePage: this.tab === 0 && !this.detailVisible, attentionItems: this.attention.needsUser, onAttentionRefresh: (): void => { this.attention.refresh(); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
          onConversationChange: (id: string): void => { this.activeChatId = id; } }) }
        TabContent() { XopcSessionsView({ embedded: true, bottomInset: this.secondaryBottomRegionHeight, activePage: this.tab === 1 && !this.detailVisible,
          currentId: this.activeChatId, onOpen: (id: string): void => { this.openConversationFromList(id, false); },
          onNew: (id: string): void => { this.openConversationFromList(id, true); } }) }
        TabContent() { XopcProgressView({ bottomInset: this.secondaryBottomRegionHeight, activePage: this.tab === 2 && !this.detailVisible, onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } }) }
        TabContent() { XopcNotesTabView({ activePage: this.tab === 3 && !this.detailVisible,
          bottomInset: this.secondaryBottomRegionHeight,
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } }) }
        TabContent() { XopcPersonalView({ bottomInset: this.secondaryBottomRegionHeight, onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } }) }
      }.scrollable(false).barHeight(0).barMode(BarMode.Fixed)
        .animationDuration(0)
        .onChange((index: number): void => { this.tab = index; })
        .width('100%').layoutWeight(1)
      }.id('home-tab-viewport').width('100%').height('100%')
        .clip(true)
      if (this.tab !== 0) {
        Column() {
          Column() {
            this.quickComposer()
            if (this.quickPanelOpen) { this.quickActionPanel() }
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
