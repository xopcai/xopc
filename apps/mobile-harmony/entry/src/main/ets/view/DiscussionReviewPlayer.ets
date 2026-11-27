import { xopcClickEffect } from '../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { xopcFormatCaptureTime } from '../common/discussionAudio';
import { discussionReviewPlayback, XopcDiscussionReviewPlayback } from '../service/discussionReviewPlayback';

@ComponentV2
export struct XopcDiscussionReviewPlayer {
  @Param noteId: string = '';
  @Local colors: XopcThemeColors = appThemeColors;
  @Local playback: XopcDiscussionReviewPlayback = discussionReviewPlayback;
  @Monitor('noteId')
  onNoteChanged(): void { if (this.playback.noteId !== this.noteId) void this.playback.stop(); }
  aboutToDisappear(): void { if (this.playback.noteId === this.noteId) void this.playback.stop(); }

  build() {
    if (this.playback.noteId === this.noteId) {
      Column({ space: 6 }) {
        Row({ space: 10 }) {
          Button({ type: ButtonType.Circle }) {
            if (this.playback.loading) {
              LoadingProgress().width(16).height(16).color(this.colors.accent)
            } else {
              SymbolGlyph(this.playback.player.state === 'playing' ? $r('sys.symbol.pause_fill') : $r('sys.symbol.play_fill'))
                .fontSize(16).fontColor([this.colors.accent])
            }
          }.width(38).height(38).padding(0).backgroundColor(this.colors.accentSoft)
            .enabled(!this.playback.loading).clickEffect(xopcClickEffect())
            .accessibilityText(this.playback.player.state === 'playing' ? $r('app.string.pause') : $r('app.string.resume'))
            .onClick((): void => { void this.playback.player.toggle(); })

          Column({ space: 2 }) {
            Text(xopcFormatCaptureTime(this.playback.sourceStartMs + this.playback.player.position * 1000) + ' / ' + xopcFormatCaptureTime(this.playback.sourceEndMs))
              .fontSize(14).fontFamily('monospace').fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            if (this.playback.loading) {
              Text($r('app.string.discussion_clip_loading')).fontSize(11).fontColor(this.colors.secondary)
            } else if (this.playback.error || this.playback.player.error) {
              Text($r('app.string.discussion_audio_unavailable')).fontSize(11).fontColor(this.colors.danger)
            }
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)

          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.xmark')).fontSize(14).fontColor([this.colors.secondary])
          }.width(34).height(34).padding(0).backgroundColor(this.colors.input)
            .clickEffect(xopcClickEffect()).accessibilityText($r('app.string.close'))
            .onClick((): void => { void this.playback.stop(); })
        }.width('100%').alignItems(VerticalAlign.Center)
      }.width('100%').padding({ left: 12, right: 12, top: 10, bottom: 10 })
        .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(16))
    }
  }
}
