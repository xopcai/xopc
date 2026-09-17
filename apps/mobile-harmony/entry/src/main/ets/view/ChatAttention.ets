import { XopcHomeAction, XopcHomeItem } from '../model/home';

@ComponentV2
export struct XopcChatAttentionRow {
  @Param item: XopcHomeItem = { id: '', kind: '', title: '', summary: '', secondaryActions: [] };
  @Param pending: boolean = false;
  @Event onAction: (action: XopcHomeAction) => void = (_action: XopcHomeAction): void => {};
  @Local expanded: boolean = false;
  @Computed get actions(): XopcHomeAction[] {
    const actions = this.item.primaryAction ? [this.item.primaryAction].concat(this.item.secondaryActions) : this.item.secondaryActions;
    return actions.filter((action: XopcHomeAction): boolean => action.type !== 'open' && action.type !== 'review_judgment');
  }
  @Computed get reviewRequired(): boolean { return this.actions.some((action: XopcHomeAction): boolean => action.type === 'connector_decision'); }
  build() {
    Column({ space: 8 }) {
      Button({ type: ButtonType.Normal }) {
        Column({ space: 6 }) {
          Text(this.item.title).fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground')).width('100%')
          Text(this.item.summary).fontSize(14).fontColor($r('app.color.secondary')).width('100%')
          if (this.item.recommendation && this.item.recommendation !== this.item.summary) {
            Text(this.item.recommendation).fontSize(13).fontColor($r('app.color.secondary')).width('100%')
          }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }.width('100%').constraintSize({ minHeight: 64 }).padding(12).backgroundColor(Color.Transparent)
        .onClick((): void => {
          if (this.reviewRequired) this.expanded = !this.expanded;
          else if (this.item.openAction) this.onAction(this.item.openAction);
          else if (this.item.primaryAction?.type === 'open' || this.item.primaryAction?.type === 'review_judgment') this.onAction(this.item.primaryAction);
        })
      if (this.reviewRequired && !this.expanded) {
        Button($r('app.string.chat_review_details')).height(44).fontColor($r('app.color.accent')).backgroundColor(Color.Transparent)
          .onClick((): void => { this.expanded = true; })
      }
      if (this.expanded && this.item.reviewDetail && this.item.reviewDetail !== this.item.summary) {
        Text(this.item.reviewDetail).width('100%').padding(12).fontSize(14).fontColor($r('app.color.foreground')).copyOption(CopyOptions.InApp)
      }
      if (!this.reviewRequired || this.expanded) {
        ForEach(this.actions, (action: XopcHomeAction) => {
          Button(action.label).width('100%').constraintSize({ minHeight: 44 }).backgroundColor($r('app.color.accent_soft'))
            .fontColor($r('app.color.accent')).enabled(!this.pending).onClick((): void => { this.onAction(action); })
        }, (action: XopcHomeAction): string => JSON.stringify(action))
      }
      Divider().color($r('app.color.secondary')).opacity(0.2)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
