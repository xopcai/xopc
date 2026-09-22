import { XopcShareIntake, shareIntake } from '../service/shareIntake';
import { XopcIncomingShare } from '../model/share';

function kindLabel(kind: string): ResourceStr {
  if (kind === 'url') return $r('app.string.share_intake_url');
  if (kind === 'code') return $r('app.string.share_intake_code');
  if (kind === 'todo') return $r('app.string.share_intake_todo');
  if (kind === 'long-text') return $r('app.string.share_intake_long_text');
  return $r('app.string.share_intake_text');
}

@ComponentV2
export struct XopcShareIntakeDialog {
  @Event onExplore: (value: XopcIncomingShare) => Promise<boolean> = async (_value: XopcIncomingShare): Promise<boolean> => false;
  @Event onSaved: (noteId: string) => void = (_noteId: string): void => {};
  @Local intake: XopcShareIntake = shareIntake;
  @Local saving: boolean = false;
  @Local error: string = '';

  private async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true; this.error = '';
    try { const id = await this.intake.save(); if (id) this.onSaved(id); }
    catch (error) { this.error = (error as Error).message; }
    finally { this.saving = false; }
  }
  private async explore(): Promise<void> {
    const value = this.intake.pending; if (!value || this.saving) return;
    this.saving = true; this.error = '';
    try { if (await this.onExplore(value)) this.intake.dismiss(); }
    catch (error) { this.error = (error as Error).message; }
    finally { this.saving = false; }
  }

  build() {
    if (this.intake.pending) {
      Stack({ alignContent: Alignment.Bottom }) {
        Column().width('100%').height('100%').backgroundColor('#66000000').onClick((): void => {})
        Column({ space: 14 }) {
          Row({ space: 10 }) {
            Row() { SymbolGlyph($r('sys.symbol.square_and_arrow_down')).fontSize(21).fontColor([$r('app.color.accent')]) }
              .width(38).height(38).justifyContent(FlexAlign.Center).borderRadius(12).backgroundColor($r('app.color.accent_soft'))
            Column({ space: 3 }) {
              Text($r('app.string.share_intake_title')).fontSize(19).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground'))
              Text($r('app.string.share_intake_subtitle')).fontSize(13).fontColor($r('app.color.secondary'))
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          }.width('100%')
          Row({ space: 8 }) {
            Text($r('app.string.share_intake_source')).fontSize(12).fontColor($r('app.color.secondary')).padding({ left: 10, right: 10, top: 5, bottom: 5 })
              .borderRadius(12).backgroundColor($r('app.color.input'))
            Text(kindLabel(this.intake.pending.kind)).fontSize(12).fontColor($r('app.color.secondary')).padding({ left: 10, right: 10, top: 5, bottom: 5 })
              .borderRadius(12).backgroundColor($r('app.color.input'))
            if (this.intake.pending.sensitive) {
              Text($r('app.string.share_intake_sensitive')).fontSize(12).fontColor($r('app.color.accent')).padding({ left: 10, right: 10, top: 5, bottom: 5 })
                .borderRadius(12).backgroundColor($r('app.color.accent_soft'))
            }
          }.width('100%')
          Column({ space: 7 }) {
            Text($r('app.string.share_intake_preview')).fontSize(12).fontColor($r('app.color.secondary')).width('100%')
            Text(this.intake.pending.preview).fontSize(14).lineHeight(21).fontColor($r('app.color.foreground')).maxLines(7)
              .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          }.width('100%').alignItems(HorizontalAlign.Start).padding(14).borderRadius(14).backgroundColor($r('app.color.input'))
          if (this.error) { Text(this.error).fontSize(12).fontColor($r('app.color.danger')).width('100%') }
          Button($r('app.string.share_intake_save')).width('100%').height(50).enabled(!this.saving)
            .backgroundColor($r('app.color.grouped')).fontColor($r('app.color.foreground')).onClick((): void => { this.save(); })
          Button($r('app.string.share_intake_explore')).width('100%').height(50).enabled(!this.saving)
            .backgroundColor($r('app.color.accent')).fontColor(Color.White).onClick((): void => { this.explore(); })
          Button($r('app.string.dismiss')).width('100%').height(42).enabled(!this.saving).backgroundColor(Color.Transparent)
            .fontColor($r('app.color.secondary')).onClick((): void => { this.intake.dismiss(); })
        }.width('100%').padding({ left: 20, right: 20, top: 22, bottom: 14 }).borderRadius({ topLeft: 24, topRight: 24 })
          .backgroundColor($r('app.color.panel'))
      }.width('100%').height('100%').zIndex(100)
    }
  }
}
