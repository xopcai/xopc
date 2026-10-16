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
        Text($r('app.string.discussion_segment_timing')).fontSize(11).fontColor(this.colors.secondary)
        Row({ space: 8 }) {
          Text(xopcFormatCaptureTime(this.playback.sourceStartMs + this.playback.player.position * 1000) + ' / ' + xopcFormatCaptureTime(this.playback.sourceEndMs))
            .fontSize(13).fontColor(this.colors.foreground).layoutWeight(1)
          Button(this.playback.player.state === 'playing' ? $r('app.string.pause') : $r('app.string.resume'))
            .enabled(!this.playback.loading).onClick((): void => { void this.playback.player.toggle(); })
          Button($r('app.string.close')).onClick((): void => { void this.playback.stop(); })
        }.width('100%')
        if (this.playback.loading) Text($r('app.string.discussion_clip_loading')).fontSize(12).fontColor(this.colors.secondary)
        if (this.playback.error || this.playback.player.error) Text($r('app.string.discussion_audio_unavailable')).fontSize(12).fontColor(this.colors.danger)
      }.width('100%').padding(12).backgroundColor(this.colors.panel).borderRadius(14)
    }
  }
}
