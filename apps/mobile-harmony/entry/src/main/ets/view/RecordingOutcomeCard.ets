import { XopcRecordingOutcomeInput, projectRecordingOutcome } from '../common/recordingOutcome';
import { recordingOutcomeStageCopy, recordingOutcomePhrase } from '../common/recordingOutcomeResources';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';

@ComponentV2
export struct RecordingOutcomeCard {
  @Require @Param input: XopcRecordingOutcomeInput;
  @Param noteContext: boolean = false;
  @Local detailsOpen: boolean = false;
  @Param compact: boolean = false;
  @Param busy: boolean = false;
  @Event onRetry: (mode: string) => void = (_mode: string): void => {};
  @Local colors: XopcThemeColors = appThemeColors;

  private retryLabel(): Resource {
    const state = projectRecordingOutcome(this.input);
    if (state.stage === 'analysis_failed' || state.stage === 'transcription_failed' || state.stage === 'verify_failed') return recordingOutcomePhrase('retry_' + state.stage);
    return recordingOutcomePhrase('retry_' + state.retry);
  }
  @Builder
  availability(key: string,available: boolean,stale: boolean = false) {
    Row({ space: 4 }) {
      Text(recordingOutcomePhrase(key)).fontSize(12).fontColor(this.colors.secondary)
      Text(recordingOutcomePhrase(available ? stale ? 'old_note' : 'available' : 'pending')).fontSize(12).fontColor(this.colors.secondary)
    }.margin({ right: 12,bottom: 4 })
  }
  build() {
    Column({ space: 10 }) {
      if (!this.noteContext) Text(recordingOutcomePhrase('leave_' + projectRecordingOutcome(this.input).leave)).fontSize(14).lineHeight(21).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
      Button({ type: ButtonType.Normal }) {
        Row({ space: 8 }) {
          Text(recordingOutcomeStageCopy(projectRecordingOutcome(this.input).stage).title).fontSize(14).fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.Start)
          SymbolGlyph(this.detailsOpen ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down')).fontSize(12).fontColor([this.colors.secondary])
        }.width('100%')
      }.id('recording-outcome-details').width('100%').constraintSize({ minHeight: 44 }).padding(0).backgroundColor(Color.Transparent)
        .onClick((): void => { this.detailsOpen = !this.detailsOpen; })
      if (this.detailsOpen) {
      if (this.noteContext) Text(recordingOutcomePhrase('leave_' + projectRecordingOutcome(this.input).leave)).fontSize(12).lineHeight(19).fontColor(this.colors.secondary).width('100%')
      if (!this.compact) {
        Text(recordingOutcomeStageCopy(projectRecordingOutcome(this.input).stage).body).fontSize(12).lineHeight(19).fontColor(this.colors.secondary).width('100%')
        if (projectRecordingOutcome(this.input).leave === 'local') Text(recordingOutcomePhrase('local_hint')).fontSize(12).lineHeight(19).fontColor(this.colors.secondary).width('100%')
        if (projectRecordingOutcome(this.input).leave === 'cloud' && (projectRecordingOutcome(this.input).stage === 'transcribing' || projectRecordingOutcome(this.input).stage === 'organizing' || projectRecordingOutcome(this.input).stage === 'transcription_retrying' || projectRecordingOutcome(this.input).stage === 'analysis_retrying')) Text(recordingOutcomePhrase('cloud_hint')).fontSize(12).lineHeight(19).fontColor(this.colors.secondary).width('100%')
        Flex({ wrap: FlexWrap.Wrap }) {
          this.availability('audio',projectRecordingOutcome(this.input).audio)
          this.availability('text',projectRecordingOutcome(this.input).text)
          this.availability('note',projectRecordingOutcome(this.input).note,projectRecordingOutcome(this.input).stale)
        }.width('100%')
      }
      }
      if (projectRecordingOutcome(this.input).retry !== 'none') Button(this.retryLabel()).id('recording-outcome-retry').height(44).fontSize(13).fontColor(this.colors.accent).backgroundColor(this.colors.input).enabled(!this.busy)
        .onClick((): void => { this.onRetry(projectRecordingOutcome(this.input).retry); })
    }.width('100%').alignItems(HorizontalAlign.Start).padding(this.noteContext ? 0 : 12).borderRadius(12).backgroundColor(this.noteContext ? Color.Transparent : this.colors.input)
  }
}
