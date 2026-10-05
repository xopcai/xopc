import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { xopcFormatCaptureTime } from '../common/discussionAudio';
import { XopcDiscussionActionItem, XopcDiscussionFact, XopcDiscussionTranscriptSegment } from '../model/discussionCapture';
import { XopcDiscussionNoteViewModel, discussionStillProcessing } from '../viewmodel/discussionNoteViewModel';

/** Readable recording status, summary and transcript for a voice note. */
@ComponentV2
export struct XopcDiscussionNoteView {
  @Param noteId: string = '';
  @Event onNoteUpdated: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local model: XopcDiscussionNoteViewModel = new XopcDiscussionNoteViewModel();
  @Local transcriptExpanded: boolean = true;
  @Local visibleSegments: number = 20;

  aboutToAppear(): void { this.model.start(this.noteId, (): void => { this.onNoteUpdated(); }); }
  aboutToDisappear(): void { this.model.stop(); }

  @Monitor('noteId')
  onNoteIdChanged(): void {
    this.transcriptExpanded = true;
    this.visibleSegments = 20;
    this.model.start(this.noteId, (): void => { this.onNoteUpdated(); });
  }

  @Builder
  factSection(label: ResourceStr, items: XopcDiscussionFact[]) {
    if (items.some((item: XopcDiscussionFact): boolean => !item.ignored)) {
      Column({ space: 9 }) {
        Text(label).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
        ForEach(items.filter((item: XopcDiscussionFact): boolean => !item.ignored), (item: XopcDiscussionFact) => {
          Text('• ' + item.text).fontSize(15).lineHeight(23).fontColor(this.colors.foreground).width('100%')
        }, (item: XopcDiscussionFact): string => item.id)
      }.width('100%').alignItems(HorizontalAlign.Start)
    }
  }

  @Builder
  transcriptRow(segment: XopcDiscussionTranscriptSegment) {
    Column({ space: 5 }) {
      Row({ space: 8 }) {
        Text(xopcFormatCaptureTime(segment.startedAtMs)).fontSize(12).fontColor(this.colors.accent)
        if (segment.speakerLabel) Text(segment.speakerLabel).fontSize(12).fontColor(this.colors.secondary)
      }.width('100%')
      Text(segment.displayText ?? segment.rawText ?? $r('app.string.discussion_transcript_pending'))
        .fontSize(15).lineHeight(23).fontColor(this.colors.foreground).width('100%')
    }.width('100%').padding(12).borderRadius(12).backgroundColor(this.colors.input)
      .alignItems(HorizontalAlign.Start)
  }

  build() {
    Column({ space: 16 }) {
      if (this.model.loading && !this.model.detail) {
        Row({ space: 9 }) {
          LoadingProgress().width(18).height(18).color(this.colors.accent)
          Text($r('app.string.discussion_loading')).fontSize(14).fontColor(this.colors.secondary)
        }.width('100%')
      } else if (this.model.detail) {
        Row({ space: 10 }) {
          SymbolGlyph($r('sys.symbol.waveform')).fontSize(20).fontColor([this.colors.accent])
          Text($r('app.string.discussion_recording')).fontSize(17).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).layoutWeight(1)
          if (this.model.detail.discussion.durationMs) {
            Text(xopcFormatCaptureTime(this.model.detail.discussion.durationMs as number))
              .fontSize(13).fontColor(this.colors.secondary)
          }
        }.width('100%')
        if (discussionStillProcessing(this.model.detail)) {
          Row({ space: 9 }) {
            LoadingProgress().width(16).height(16).color(this.colors.accent)
            Text($r('app.string.discussion_processing')).fontSize(14).lineHeight(21)
              .fontColor(this.colors.secondary).layoutWeight(1)
          }.width('100%').padding(14).borderRadius(12).backgroundColor(this.colors.accentSoft)
        } else if (this.model.detail.discussion.status === 'needs_attention') {
          Column({ space: 8 }) {
            Text(this.model.detail.discussion.failureStage === 'transcript_sealing'
              ? $r('app.string.discussion_transcript_failed') : $r('app.string.discussion_failed'))
              .fontSize(14).lineHeight(21).fontColor(this.colors.danger).width('100%')
            Button($r('app.string.retry')).fontSize(14).fontColor(this.colors.accent)
              .backgroundColor(Color.Transparent).padding(0).height(34)
              .enabled(!this.model.retrying).onClick((): void => { void this.model.retry(); })
          }.width('100%').padding(14).borderRadius(12).backgroundColor(this.colors.input)
            .alignItems(HorizontalAlign.Start)
        }
        if (this.model.detail.organization?.organization) {
          Column({ space: 15 }) {
            Text($r('app.string.discussion_summary')).fontSize(17).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.foreground).width('100%')
            Text(this.model.detail.organization.organization.summary).fontSize(16).lineHeight(25)
              .fontColor(this.colors.foreground).width('100%')
            if (this.model.detail.organization.organization.keyPoints.length) {
              Column({ space: 8 }) {
                Text($r('app.string.discussion_key_points')).fontSize(16).fontWeight(FontWeight.Medium)
                  .fontColor(this.colors.foreground).width('100%')
                ForEach(this.model.detail.organization.organization.keyPoints, (point: string) => {
                  Text('• ' + point).fontSize(15).lineHeight(23).fontColor(this.colors.foreground).width('100%')
                }, (point: string): string => point)
              }.width('100%').alignItems(HorizontalAlign.Start)
            }
            this.factSection($r('app.string.discussion_decisions'), this.model.detail.organization.organization.decisions)
            this.factSection($r('app.string.discussion_risks'), this.model.detail.organization.organization.risks)
            this.factSection($r('app.string.discussion_questions'), this.model.detail.organization.organization.openQuestions)
            if (this.model.detail.organization.organization.actionItems.some((item: XopcDiscussionActionItem): boolean => !item.ignored)) {
              Column({ space: 9 }) {
                Text($r('app.string.discussion_actions')).fontSize(16).fontWeight(FontWeight.Medium)
                  .fontColor(this.colors.foreground).width('100%')
                ForEach(this.model.detail.organization.organization.actionItems.filter((item: XopcDiscussionActionItem): boolean => !item.ignored),
                  (item: XopcDiscussionActionItem) => {
                    Text('• ' + item.title).fontSize(15).lineHeight(23).fontColor(this.colors.foreground).width('100%')
                  }, (item: XopcDiscussionActionItem): string => item.id)
              }.width('100%').alignItems(HorizontalAlign.Start)
            }
          }.width('100%').padding(16).borderRadius(16).backgroundColor(this.colors.input)
            .alignItems(HorizontalAlign.Start)
        }
        if (this.model.detail.transcript.segments.length || this.model.detail.transcript.text) {
          Column({ space: 10 }) {
            Button({ type: ButtonType.Normal }) {
              Row() {
                Text($r('app.string.discussion_transcript')).fontSize(17).fontWeight(FontWeight.Medium)
                  .fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.Start)
                SymbolGlyph(this.transcriptExpanded ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
                  .fontSize(16).fontColor([this.colors.secondary])
              }.width('100%')
            }.width('100%').padding(0).backgroundColor(Color.Transparent)
              .onClick((): void => { this.transcriptExpanded = !this.transcriptExpanded; })
            if (this.transcriptExpanded) {
              if (this.model.detail.transcript.segments.length) {
                ForEach(this.model.detail.transcript.segments.slice(0, this.visibleSegments),
                  (segment: XopcDiscussionTranscriptSegment) => { this.transcriptRow(segment) },
                  (segment: XopcDiscussionTranscriptSegment): string => segment.sequence.toString())
                if (this.model.detail.transcript.segments.length > this.visibleSegments) {
                  Button($r('app.string.load_more')).fontSize(14).fontColor(this.colors.accent)
                    .backgroundColor(Color.Transparent).onClick((): void => { this.visibleSegments += 20; })
                }
              } else {
                Text(this.model.detail.transcript.text).fontSize(15).lineHeight(24)
                  .fontColor(this.colors.foreground).width('100%')
              }
            }
          }.width('100%').alignItems(HorizontalAlign.Start)
        } else if (!discussionStillProcessing(this.model.detail) && !this.model.detail.organization?.organization) {
          Text($r('app.string.discussion_no_speech')).fontSize(14).lineHeight(21)
            .fontColor(this.colors.secondary).width('100%')
        }
      }
      if (this.model.error) {
        Text(this.model.error).fontSize(13).fontColor(this.colors.danger).width('100%')
        Button($r('app.string.retry')).fontSize(13).fontColor(this.colors.accent)
          .backgroundColor(Color.Transparent).padding(0).height(32)
          .onClick((): void => { void this.model.refresh(); })
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
