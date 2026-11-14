import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcHubRow } from './MobileComponents';

@ComponentV2
export struct XopcAutomationIdeas {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param projectScoped: boolean = false;
  @Event onChoose: (prompt: string) => void = (_prompt: string): void => {};

  @Builder
  idea(id: string, title: Resource, summary: Resource, prompt: Resource, symbol: Resource) {
    XopcHubRow({ heading: title, summary, symbol, compact: true,
      onOpen: (): void => {
        const text = this.getUIContext().getHostContext()?.resourceManager.getStringSync(prompt.id);
        if (text) this.onChoose(text);
      } }).id('automation-idea-' + id)
  }

  build() {
    Column({ space: 8 }) {
      Text($r('app.string.automation_ideas_title')).fontSize(13).fontWeight(FontWeight.Medium)
        .fontColor(this.colors.secondary).width('100%').padding({ left: 8, right: 8 })
      this.idea('morning', $r('app.string.automation_idea_morning'), $r('app.string.automation_idea_morning_summary'),
        $r('app.string.automation_idea_morning_prompt'), $r('sys.symbol.sun_max'))
      this.idea('weekly', $r('app.string.automation_idea_weekly'), $r('app.string.automation_idea_weekly_summary'),
        $r('app.string.automation_idea_weekly_prompt'), $r('sys.symbol.doc_text'))
      this.idea('project', $r('app.string.automation_idea_project'), $r('app.string.automation_idea_project_summary'),
        this.projectScoped ? $r('app.string.automation_idea_current_project_prompt') : $r('app.string.automation_idea_project_prompt'),
        $r('sys.symbol.folder'))
      this.idea('reminder', $r('app.string.automation_idea_reminder'), $r('app.string.automation_idea_reminder_summary'),
        $r('app.string.automation_idea_reminder_prompt'), $r('sys.symbol.bell'))
    }.id('automation-ideas').width('100%').alignItems(HorizontalAlign.Start)
  }
}
