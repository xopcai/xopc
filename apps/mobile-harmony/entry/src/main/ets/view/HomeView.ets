import { XopcChatView } from './ChatView';
import { XopcSessionsView } from './SessionsView';
import { XopcWorkspaceView } from './WorkspaceView';
import { XopcFilesView } from './FilesView';
import { XopcSettingsView } from './SettingsView';
import { XopcProgressView, XopcLibraryView } from './HomeHubs';
import { XopcPersonalView } from './PersonalView';
import { XopcWorkflowView } from './WorkflowView';
import { XopcAutomationRunView } from './AutomationRunView';
import { XopcMobileRoute } from '../model/home';
import { pushNotifications } from '../service/pushNotifications';
import { notificationNavigation } from '../service/notificationNavigation';
import { XopcNotificationRoute } from '../common/notificationRoute';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { XopcProgressViewModel } from '../viewmodel/homeViewModel';
import { accessibility } from '@kit.AccessibilityKit';

@ComponentV2
export struct XopcHomeView {
  @Local tab: number = 0;
  @Local detailVisible: boolean = false;
  @Local layout: XopcLayoutState = layoutState;
  @Local attention: XopcProgressViewModel = new XopcProgressViewModel();
  @Local visibleChatId: string = '';
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
      if (route.target.conversationId) this.navigate({ page: 'chat', itemId: route.target.conversationId });
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
    if (route.page === 'chat' && !route.itemId) { this.pathStack.clear(); this.tab = 0; return; }
    if (route.page === 'progress') { this.pathStack.clear(); this.tab = 1; return; }
    this.pathStack.pushPath({ name: route.page, param: route });
  }

  @Builder
  destination(page: string, param: Object) {
    if (page === 'chat') {
      NavDestination() {
        XopcChatView({ initialId: (param as XopcMobileRoute).itemId, activePage: this.visibleChatId === (param as XopcMobileRoute).itemId,
          attentionItems: this.attention.needsUser, onAttentionRefresh: (): void => { this.attention.refresh(); }, onExit: (): void => { this.pathStack.pop(); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
      }.hideTitleBar(true).backgroundColor($r('app.color.surface'))
        .onShown((): void => { this.visibleChatId = (param as XopcMobileRoute).itemId; })
        .onHidden((): void => { if (this.visibleChatId === (param as XopcMobileRoute).itemId) this.visibleChatId = ''; })
        .onBackPressed((): boolean => { return layoutState.dismissChatOverlay?.() ?? false; })
    } else if (page === 'sessions') {
      XopcSessionsView({ onExit: (): void => { this.pathStack.pop(); },
        onOpen: (id: string): void => { this.navigate({ page: 'chat', itemId: id }); } })
    } else if (page === 'tasks' || page === 'projects' || page === 'notes' || page === 'automations' || page === 'inbox') {
      XopcWorkspaceView({ section: page === 'inbox' ? 'notes' : page === 'tasks' ? 'tasks' : page === 'projects' ? 'projects' : page === 'automations' ? 'automations' : 'notes',
        heading: page === 'inbox' ? $r('app.string.inbox') : page === 'tasks' ? $r('app.string.tasks') : page === 'projects' ? $r('app.string.projects') : page === 'automations' ? $r('app.string.automations') : $r('app.string.notes'),
        initialId: page === 'inbox' ? '' : (param as XopcMobileRoute).itemId,
        judgmentId: page === 'inbox' ? (param as XopcMobileRoute).itemId : '',
        noteStatus: page === 'inbox' ? 'inbox' : '', onExit: (): void => { this.pathStack.pop(); } })
    } else if (page === 'files' || page === 'session-files') {
      XopcFilesView({ initialId: page === 'files' ? (param as XopcMobileRoute).itemId : '',
        conversationId: page === 'session-files' ? (param as XopcMobileRoute).itemId : '', onExit: (): void => { this.pathStack.pop(); } })
    } else if (page === 'workflows') {
      XopcWorkflowView({ initialId: (param as XopcMobileRoute).itemId })
    } else if (page === 'automation-run') {
      XopcAutomationRunView({ runId: (param as XopcMobileRoute).itemId,
        onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } })
    } else {
      NavDestination() {
        if (page === 'settings') {
          XopcSettingsView({ initialSection: (param as XopcMobileRoute).itemId, useNavigation: true,
            onExit: (): void => { this.pathStack.pop(); },
            onOpenSection: (section: string): void => { this.navigate({ page: 'settings', itemId: section }); },
            onDisconnected: (): void => { this.onDisconnected(); } })
        }
        else { Text($r('app.string.unsupported_route')).fontColor($r('app.color.secondary')).padding(20) }
      }.hideTitleBar(page === 'settings').title($r('app.string.back')).backgroundColor($r('app.color.surface'))
    }
  }

  @Builder
  tabItem(index: number, label: ResourceStr, icon: Resource) {
    Button({ type: ButtonType.Normal }) {
    Column({ space: 3 }) {
      Stack({ alignContent: Alignment.TopEnd }) {
        Row() {
          SymbolGlyph(icon).fontSize(22).fontColor([this.tab === index ? $r('app.color.accent') : $r('app.color.secondary')])
        }.width(42).height(28).justifyContent(FlexAlign.Center).borderRadius(16)
          .backgroundColor(this.tab === index ? $r('app.color.grouped') : Color.Transparent)
        if (index === 1 && this.attention.needsUser.length) {
          Text(this.attention.needsUser.length > 99 ? '99+' : this.attention.needsUser.length.toString()).fontSize(10)
            .fontColor($r('app.color.accent')).backgroundColor($r('app.color.accent_soft')).borderRadius(8)
            .constraintSize({ minWidth: 16, minHeight: 16 }).textAlign(TextAlign.Center).position({ x: 15, y: -5 })
        }
      }
      Text(label).fontSize(11).fontWeight(FontWeight.Medium)
        .fontColor(this.tab === index ? $r('app.color.accent') : $r('app.color.secondary'))
    }.width('100%').height(44).justifyContent(FlexAlign.Center)
      .backgroundColor(Color.Transparent).borderRadius(26)
    }.id('main-tab-' + index).layoutWeight(1).height(44).padding(0).borderRadius(26).backgroundColor(Color.Transparent)
      .accessibilitySelected(this.tab === index)
      .onClick((): void => { this.tab = index; })
  }

  build() {
    Navigation(this.pathStack) {
      Column() {
      Tabs({ barPosition: BarPosition.End, index: this.tab }) {
        TabContent() { XopcChatView({ activePage: this.tab === 0 && !this.detailVisible, attentionItems: this.attention.needsUser, onAttentionRefresh: (): void => { this.attention.refresh(); },
          onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); },
          onOpenConversation: (id: string): void => { this.navigate({ page: 'chat', itemId: id }); } }) }
        TabContent() { XopcProgressView({ activePage: this.tab === 1 && !this.detailVisible, onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } }) }
        TabContent() { XopcLibraryView({ activePage: this.tab === 2 && !this.detailVisible, onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } }) }
        TabContent() { XopcPersonalView({ onNavigate: (route: XopcMobileRoute): void => { this.navigate(route); } }) }
      }.scrollable(false).barHeight(0).barMode(BarMode.Fixed).animationDuration(0)
        .onChange((index: number): void => { this.tab = index; })
        .width('100%').layoutWeight(1)
      if (this.layout.isMainDockVisible(this.tab)) {
        Stack({ alignContent: Alignment.Start }) {
        Row() {
          this.tabItem(0, $r('app.string.chat'), $r('sys.symbol.message'))
          this.tabItem(1, $r('app.string.progress'), $r('sys.symbol.checkmark_circle'))
          this.tabItem(2, $r('app.string.library'), $r('sys.symbol.square_stack_3d'))
          this.tabItem(3, $r('app.string.personal'), $r('sys.symbol.person'))
        }.width('100%').height(52).padding(4)
        }.id('main-tab-dock').width('92%').height(52).borderRadius(30).backgroundColor($r('app.color.panel'))
          .border({ width: 0.5, color: $r('app.color.border_subtle') }).margin({ bottom: 8 })
      }
      }.width('100%').height('100%')
    }.hideTitleBar(true).mode(NavigationMode.Stack).navDestination(this.destination)
      .onNavBarStateChange((shown: boolean): void => { this.detailVisible = !shown; })
      .width('100%').height('100%').backgroundColor($r('app.color.surface'))
  }
}
