import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { groupExecutionSteps, executionStepPreview, XopcExecutionGroup } from '../common/executionTimeline';
import { XopcChatRow, XopcExecutionDetail, XopcExecutionStep, XopcLiveActivityTool } from '../model/chat';

function executionTitle(category: string): ResourceStr {
  switch (category) {
    case 'search': return $r('app.string.chat_step_search');
    case 'read': return $r('app.string.chat_step_read');
    case 'command': return $r('app.string.chat_step_command');
    case 'write': return $r('app.string.chat_step_write');
    case 'edit': return $r('app.string.chat_step_edit');
    case 'fetch': return $r('app.string.chat_step_fetch');
    case 'share': return $r('app.string.chat_step_share');
    case 'speech': return $r('app.string.chat_step_speech');
    case 'publish': return $r('app.string.chat_step_publish');
    case 'plan': return $r('app.string.chat_step_plan');
    case 'skill_view': return $r('app.string.chat_step_skill_view');
    case 'tool_manual': return $r('app.string.chat_step_tool_manual');
    case 'inspect_notes': return $r('app.string.chat_step_inspect_notes');
    case 'inspect_tasks': return $r('app.string.chat_step_inspect_tasks');
    case 'inspect_projects': return $r('app.string.chat_step_inspect_projects');
    case 'inspect_automations': return $r('app.string.chat_step_inspect_automations');
    case 'inspect_work': return $r('app.string.chat_step_inspect_work');
    case 'manage_notes': return $r('app.string.chat_step_manage_notes');
    case 'manage_tasks': return $r('app.string.chat_step_manage_tasks');
    case 'manage_projects': return $r('app.string.chat_step_manage_projects');
    case 'manage_automations': return $r('app.string.chat_step_manage_automations');
    case 'manage_work': return $r('app.string.chat_step_manage_work');
    default: return $r('app.string.chat_step_other');
  }
}

@ComponentV2
export struct XopcChatExecutionDetailView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local expandedGroupId: string = '';
  @Param detail: XopcExecutionDetail = { turnId: '', steps: [] };
  @Param row: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Param loading: boolean = false;
  @Param error: string = '';
  @Event onRetry: () => void = (): void => {};

  @Computed get runningTool(): XopcLiveActivityTool | undefined {
    return (this.row.activityTools || []).find((tool: XopcLiveActivityTool): boolean => tool.status === 'running');
  }

  @Computed get groups(): XopcExecutionGroup[] { return groupExecutionSteps(this.detail.steps, !!this.row.live); }
  @Computed get toolCount(): number {
    return this.detail.steps.filter((step: XopcExecutionStep): boolean => step.kind === 'tool').length;
  }
  @Computed get completedCount(): number {
    return this.groups.filter((group: XopcExecutionGroup): boolean => group.kind === 'tool' && group.status === 'done')
      .reduce((count: number, group: XopcExecutionGroup): number => count + group.steps.length, 0);
  }
  @Computed get hasUnresolvedSteps(): boolean {
    return this.groups.some((group: XopcExecutionGroup): boolean => group.kind === 'tool'
      && (group.status === 'stopped' || group.status === 'error'));
  }

  private stepIcon(category: string): Resource {
    if (category === 'search') return $r('sys.symbol.magnifyingglass');
    if (category === 'fetch' || category === 'share') return $r('sys.symbol.link');
    if (category === 'read' || category === 'skill_view' || category === 'tool_manual') return $r('sys.symbol.doc_text');
    if (category === 'write' || category === 'edit') return $r('sys.symbol.square_and_pencil');
    return $r('sys.symbol.ellipsis_circle');
  }

  private groupHasDetails(group: XopcExecutionGroup): boolean {
    return group.steps.length > 1 && group.steps.some((step: XopcExecutionStep): boolean =>
      !!executionStepPreview(step, this.row.toolCalls) || !!step.failure);
  }

  private groupSummaryPreview(group: XopcExecutionGroup): string {
    const first = group.steps.find((step: XopcExecutionStep): boolean =>
      !!executionStepPreview(step, this.row.toolCalls));
    return first ? executionStepPreview(first, this.row.toolCalls) : '';
  }

  @Builder
  toolGroup(group: XopcExecutionGroup) {
    Column({ space: 8 }) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 12 }) {
          Row() {
            SymbolGlyph(this.stepIcon(group.category)).fontSize(18).fontColor([this.colors.accent])
          }.width(34).height(34).borderRadius(17).justifyContent(FlexAlign.Center)
            .backgroundColor(this.colors.accentSoft)
          Column({ space: 3 }) {
            Row({ space: 7 }) {
              Text(executionTitle(group.category)).fontSize(16).fontWeight(FontWeight.Medium)
                .fontColor(this.colors.foreground)
              if (group.steps.length > 1) {
                Text($r('app.string.chat_execution_group_count', group.steps.length.toString()))
                  .fontSize(12).fontColor(this.colors.secondary)
              }
            }.width('100%')
            if (group.steps.length === 1 && executionStepPreview(group.steps[0], this.row.toolCalls)) {
              Text(executionStepPreview(group.steps[0], this.row.toolCalls)).fontSize(13).lineHeight(19)
                .fontColor(this.colors.secondary).maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%').textAlign(TextAlign.Start)
            }
            if (group.steps.length > 1 && this.expandedGroupId !== group.id && this.groupSummaryPreview(group)) {
              Text(this.groupSummaryPreview(group)).fontSize(13).lineHeight(19)
                .fontColor(this.colors.secondary).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%').textAlign(TextAlign.Start)
            }
            if (group.status === 'stopped') {
              Text($r('app.string.chat_execution_no_result')).fontSize(12).fontColor(this.colors.tertiary)
            }
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          if (group.status === 'running') {
            LoadingProgress().width(16).height(16).color(this.colors.accent)
          } else if (group.status === 'error') {
            SymbolGlyph($r('sys.symbol.exclamationmark_circle')).fontSize(18).fontColor([this.colors.danger])
          } else if (group.status === 'stopped') {
            SymbolGlyph($r('sys.symbol.circle')).fontSize(18).fontColor([this.colors.tertiary])
          } else {
            SymbolGlyph($r('sys.symbol.checkmark_circle')).fontSize(18).fontColor([this.colors.tertiary])
          }
          if (this.groupHasDetails(group)) {
            SymbolGlyph(this.expandedGroupId === group.id ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
              .fontSize(13).fontColor([this.colors.tertiary])
          }
        }.width('100%').alignItems(VerticalAlign.Center)
      }.id('chat-execution-tool-' + group.id).width('100%').padding(0)
        .backgroundColor(Color.Transparent)
        .onClick((): void => {
          if (this.groupHasDetails(group)) this.expandedGroupId = this.expandedGroupId === group.id ? '' : group.id;
        })
      if (group.steps.length === 1 && group.steps[0].failure) {
        Text(group.steps[0].failure || '').fontSize(13).lineHeight(19).fontColor(this.colors.danger)
          .width('100%').padding({ left: 46 }).copyOption(CopyOptions.InApp)
      }
      if (this.expandedGroupId === group.id && this.groupHasDetails(group)) {
        Column({ space: 10 }) {
          ForEach(group.steps, (step: XopcExecutionStep, index: number) => {
            Row({ space: 10 }) {
              Text((index + 1).toString()).fontSize(12).fontColor(this.colors.tertiary).width(18)
              Column({ space: 3 }) {
                Text(executionTitle(group.category)).fontSize(13).fontColor(this.colors.secondary)
                if (executionStepPreview(step, this.row.toolCalls)) {
                  Text(executionStepPreview(step, this.row.toolCalls)).fontSize(14).lineHeight(20)
                    .fontColor(this.colors.foreground).width('100%').copyOption(CopyOptions.InApp)
                }
                if (step.failure) {
                  Text(step.failure).fontSize(13).lineHeight(19).fontColor(this.colors.danger)
                    .width('100%').copyOption(CopyOptions.InApp)
                }
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
            }.width('100%').alignItems(VerticalAlign.Top)
          }, (step: XopcExecutionStep): string => step.id)
        }.width('100%').padding({ left: 46, top: 4, bottom: 4 })
      }
    }.width('100%').padding({ top: 12, bottom: 12 })
  }

  build() {
    Scroll() {
      Column({ space: 0 }) {
        if (this.groups.length) {
          Row({ space: 8 }) {
            if (this.row.live) {
              LoadingProgress().width(16).height(16).color(this.colors.accent)
            } else {
              SymbolGlyph($r('sys.symbol.checkmark_circle')).fontSize(17).fontColor([this.colors.accent])
            }
            Text(this.row.live ? $r('app.string.chat_running') : this.hasUnresolvedSteps
              ? $r('app.string.chat_execution_ended') : $r('app.string.chat_execution_done'))
              .fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            Text($r('app.string.chat_execution_overview', this.toolCount.toString(), this.completedCount.toString()))
              .fontSize(12).fontColor(this.colors.secondary).layoutWeight(1).textAlign(TextAlign.End)
          }.width('100%').padding({ bottom: 14 })
        }
        if (this.loading && !this.groups.length) {
          Row({ space: 10 }) {
            LoadingProgress().width(20).height(20).color(this.colors.accent)
            Text($r('app.string.chat_execution_loading')).fontSize(14).fontColor(this.colors.secondary)
          }.width('100%').padding(16)
        }
        if (this.error) {
          Column({ space: 8 }) {
            Text($r('app.string.chat_execution_unavailable')).fontSize(14).fontColor(this.colors.secondary)
            Button($r('app.string.refresh')).height(44).fontColor(this.colors.accent)
              .backgroundColor(Color.Transparent).onClick((): void => { this.onRetry(); })
          }.width('100%').padding(16).borderRadius(12).backgroundColor(this.colors.grouped)
        }
        ForEach(this.groups, (group: XopcExecutionGroup) => {
          if (group.kind === 'tool') {
            this.toolGroup(group)
          } else if (group.kind === 'progress' && group.steps[0].text) {
            Text(group.steps[0].text || '').fontSize(14).lineHeight(22).fontColor(this.colors.secondary)
              .width('100%').padding({ top: 10, bottom: 14 }).copyOption(CopyOptions.InApp)
          }
          Column().width('100%').height(1).backgroundColor(this.colors.border)
        }, (group: XopcExecutionGroup): string => group.id)
        if (this.row.live && !this.groups.some((group: XopcExecutionGroup): boolean =>
          group.kind === 'tool' && group.status === 'running')) {
          Row({ space: 10 }) {
            LoadingProgress().width(16).height(16).color(this.colors.accent)
            Text(this.runningTool ? executionTitle(this.runningTool.kind) : $r('app.string.chat_steps_working'))
              .fontSize(14).fontColor(this.colors.foreground).layoutWeight(1)
            Text($r('app.string.chat_running')).fontSize(12).fontColor(this.colors.secondary)
          }.width('100%').padding({ top: 14, bottom: 14 })
        }
        if (!this.loading && !this.error && !this.groups.length && !this.row.live) {
          Text($r('app.string.chat_execution_empty')).fontSize(14).fontColor(this.colors.secondary)
            .width('100%').padding(16)
        }
      }.width('100%').padding({ left: 16, right: 16, top: 16, bottom: 32 })
        .alignItems(HorizontalAlign.Start)
    }.id('chat-execution-detail-scroll').width('100%').layoutWeight(1).scrollBar(BarState.Auto)
      .align(Alignment.TopStart)
  }
}
