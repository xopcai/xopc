import { XopcChatView } from './ChatView';
import { XopcWorkspaceView } from './WorkspaceView';
import { XopcFilesView } from './FilesView';
import { XopcSettingsView } from './SettingsView';
import { pushNotifications } from '../service/pushNotifications';
import { notificationNavigation } from '../service/notificationNavigation';
import { XopcNotificationRoute } from '../common/notificationRoute';

@ComponentV2
export struct XopcHomeView {
  @Local tab: number = 0;
  @Local more: number = 0;
  @Local chatTarget: string = '';
  @Local taskTarget: string = '';
  @Local automationTarget: string = '';
  @Event onDisconnected: () => void = (): void => {};
  aboutToAppear(): void {
    pushNotifications.restore();
    notificationNavigation.onTarget = (route: XopcNotificationRoute): void => {
      if (route.target.conversationId) { this.chatTarget = route.target.conversationId; this.tab = 0; }
      else if (route.target.taskId) { this.taskTarget = route.target.taskId; this.tab = 1; }
      else if (route.target.automationId) { this.automationTarget = route.target.automationId; this.more = 1; this.tab = 4; }
    };
    notificationNavigation.consume();
  }
  aboutToDisappear(): void { notificationNavigation.onTarget = undefined; }

  @Builder
  tabButton(index: number, label: ResourceStr) {
    Button(label).type(ButtonType.Normal).layoutWeight(1).height(48).fontSize(13)
      .backgroundColor($r('app.color.surface'))
      .fontColor(this.tab === index ? $r('app.color.accent') : $r('app.color.secondary'))
      .onClick((): void => { this.tab = index; })
  }

  build() {
    Column() {
      Column() {
        if (this.tab === 0) { XopcChatView({ initialId: this.chatTarget }) }
        else if (this.tab === 1) { XopcWorkspaceView({ section: 'tasks', heading: $r('app.string.tasks'), initialId: this.taskTarget }) }
        else if (this.tab === 2) { XopcWorkspaceView({ section: 'notes', heading: $r('app.string.notes') }) }
        else if (this.tab === 3) { XopcFilesView() }
        else {
          Row({ space: 8 }) {
            Button($r('app.string.projects')).onClick((): void => { this.more = 0; })
            Button($r('app.string.automations')).onClick((): void => { this.more = 1; })
            Button($r('app.string.settings')).onClick((): void => { this.more = 2; })
          }.padding(8)
          Column() {
            if (this.more === 0) { XopcWorkspaceView({ section: 'projects', heading: $r('app.string.projects') }) }
            else if (this.more === 1) { XopcWorkspaceView({ section: 'automations', heading: $r('app.string.automations'), initialId: this.automationTarget }) }
            else { XopcSettingsView({ onDisconnected: (): void => { this.onDisconnected(); } }) }
          }.layoutWeight(1).width('100%')
        }
      }.layoutWeight(1).width('100%')
      Row() {
        this.tabButton(0, $r('app.string.chat'))
        this.tabButton(1, $r('app.string.tasks'))
        this.tabButton(2, $r('app.string.notes'))
        this.tabButton(3, $r('app.string.files'))
        this.tabButton(4, $r('app.string.more'))
      }.width('100%')
    }.width('100%').height('100%').backgroundColor($r('app.color.surface'))
  }
}
