import { RecordingOutcomeCard } from './RecordingOutcomeCard';
import { recordingOutcomePhrase } from '../common/recordingOutcomeResources';
import { XopcRecordingOutcomeInput } from '../common/recordingOutcome';
import { XopcDiscussionNoteViewModel } from '../viewmodel/discussionNoteViewModel';
import { common } from '@kit.AbilityKit';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { xopcFormatCaptureTime } from '../common/discussionAudio';
import { discussionCapture, XopcDiscussionCapture } from '../service/discussionCapture';
import { XopcDiscussionRecordingPanel, recordingPanelAvailability } from '../viewmodel/discussionRecordingPanel';

@ComponentV2
export struct XopcDiscussionRecordingPanelView {
  @Require @Param panel: XopcDiscussionRecordingPanel;
  @Param viewportWidth: number = 0;
  @Param viewportHeight: number = 0;
  @Event onSaved: (id: string) => void = (_id: string): void => {};
  @Event onOpenNote: (id: string) => void = (_id: string): void => {};
  @Event onRecovery: () => void = (): void => {};
  @Local outcomeModel: XopcDiscussionNoteViewModel = new XopcDiscussionNoteViewModel();
  @Local capture: XopcDiscussionCapture = discussionCapture;
  @Local colors: XopcThemeColors = appThemeColors;

  aboutToAppear(): void { this.resizePanel(); this.updateNotice(); this.followOutcome(); }
  aboutToDisappear(): void { this.outcomeModel.stop(); }
  @Monitor('capture.phase','capture.noteId')
  followOutcome(): void {
    if (this.capture.noteId && this.ended()) this.outcomeModel.start(this.capture.noteId);
    else { this.outcomeModel.stop(); this.outcomeModel.detail = undefined; }
  }
  private ended(): boolean { return this.capture.phase === 'completed' || this.capture.phase === 'stopping' || this.capture.phase === 'organizing' || this.capture.phase === 'error'; }
  private outcome(): XopcRecordingOutcomeInput {
    const value = this.outcomeModel.outcome(this.capture.localSaveComplete ? 'complete' : this.capture.phase === 'stopping' ? 'saving' : this.capture.savedDurationMs > 0 ? 'partial' : 'failed',this.capture.syncStatus);
    if (!value.audioDeleted && this.capture.syncStatus === 'available') value.audioAvailable = true;
    if (value.audioDeleted) value.localSave = 'unknown';
    return value;
  }
  private retryOutcome(mode: string): void {
    if (mode === 'recover') { this.panel.setCompact(true); this.onRecovery(); }
    else if (mode === 'sync') void this.finishRecording();
    else void this.outcomeModel.retryOutcome(mode);
  }
  @Monitor('viewportWidth','viewportHeight')
  resizePanel(): void { this.panel.resize(this.viewportWidth,this.viewportHeight); }
  @Monitor('capture.captureInterrupted','capture.shutdownIncomplete','capture.error','capture.markerError','capture.backgroundAvailable','capture.phase','capture.interruptionCount')
  updateNotice(): void {
    this.panel.setNotice(this.capture.interruptionCount > 0 || !!this.capture.markerError || !!this.capture.error || this.capture.captureInterrupted || this.capture.shutdownIncomplete ||
      (this.capture.phase === 'recording' && !this.capture.backgroundAvailable));
  }
  private stateLabel(): Resource {
    if (this.ended()) return $r('app.string.capture_p0_stopped');
    if (this.capture.captureStatus === 'waiting') return $r('app.string.capture_p0_waiting');
    if (this.capture.captureStatus === 'interrupted') return $r('app.string.capture_interrupted');
    if (this.capture.captureStatus === 'paused') return $r('app.string.capture_paused');
    if (this.capture.captureStatus === 'stopping') return $r('app.string.capture_p0_stopping');
    if (this.capture.captureStatus === 'stopped') return $r('app.string.capture_p0_stopped');
    return $r('app.string.capture_live');
  }
  private saveLabel(): Resource {
    if (this.capture.localSaveComplete) return $r('app.string.capture_p0_local_complete');
    if (this.capture.savedDurationMs > 0) return $r('app.string.capture_local_saved',xopcFormatCaptureTime(this.capture.savedDurationMs));
    if (this.capture.phase === 'error' || this.capture.phase === 'paused') return $r('app.string.capture_panel_no_saved_audio');
    return $r('app.string.capture_panel_saving');
  }
  private syncLabel(): Resource {
    if (this.capture.syncStatus === 'available') return $r('app.string.capture_p0_available');
    if (this.capture.syncStatus === 'verifying') return $r('app.string.capture_p0_verifying');
    if (this.capture.syncStatus === 'uploading') return $r('app.string.capture_p0_uploading');
    if (this.capture.syncStatus === 'failed') return $r('app.string.capture_panel_sync_failed');
    return $r('app.string.capture_panel_backup_later');
  }
  private analysisLabel(): Resource {
    if (this.capture.processingStatus === 'completed') return $r('app.string.capture_p0_ai_complete');
    if (this.capture.processingStatus === 'needs_attention') return $r('app.string.capture_p0_ai_failed');
    if (this.capture.processingStatus === 'organizing') return $r('app.string.capture_p0_ai_organizing');
    if (this.capture.processingStatus === 'sealing') return $r('app.string.capture_transcribing');
    return $r('app.string.capture_panel_notes_later');
  }
  private async finishRecording(): Promise<void> {
    try { await this.panel.finish(this.capture,(id: string): void => { this.onSaved(id); }); }
    catch (_error) { this.getUIContext().getPromptAction().showToast({ message: $r('app.string.capture_panel_action_failed') }); }
  }

  @Builder
  iconAction(label: Resource, symbol: Resource, id: string, enabled: boolean, action: () => void, primary: boolean = false) {
    Button({ type: ButtonType.Normal }) { SymbolGlyph(symbol).fontSize(18).fontColor([primary ? this.colors.panel : this.colors.foreground]) }
      .id(id).width(44).height(44).padding(0).borderRadius(12).enabled(enabled)
      .backgroundColor(primary ? this.colors.accent : this.colors.input).accessibilityText(label).onClick(action)
  }
  @Builder
  compactActions() {
    if (!this.ended()) {
    this.iconAction($r('app.string.capture_marker'),$r('sys.symbol.bookmark'),'capture-float-mark',!this.panel.finishing && recordingPanelAvailability(this.capture).mark,(): void => { void this.panel.mark(this.capture); })
    this.iconAction(this.capture.phase === 'paused' ? $r('app.string.resume') : $r('app.string.pause'),this.capture.phase === 'paused' ? $r('sys.symbol.play_fill') : $r('sys.symbol.pause_fill'),'capture-float-pause',!this.panel.finishing && recordingPanelAvailability(this.capture).pause,(): void => { this.panel.pause(this.capture); })
    this.iconAction(this.capture.phase === 'error' ? $r('app.string.retry') : $r('app.string.capture_finish'),$r('sys.symbol.stop_circle_fill'),'capture-float-finish',!this.panel.finishing && recordingPanelAvailability(this.capture).finish,(): void => { void this.finishRecording(); },true)
    }
  }
  @Builder
  header() {
    Row({ space: 4 }) {
      Button({ type: ButtonType.Normal }) {
        Column({ space: 3 }) {
          ForEach([0,1,2],(index: number) => {
            Row({ space: 3 }) {
              Row() {}.width(3).height(3).borderRadius(2).backgroundColor(this.colors.secondary)
              Row() {}.width(3).height(3).borderRadius(2).backgroundColor(this.colors.secondary)
            }
          },(index: number): string => index.toString())
        }
      }
        .id('capture-float-move').width(44).height(44).padding(0).borderRadius(12).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.capture_panel_move')).onClick((): void => { this.panel.togglePositions(); })
        .gesture(PanGesture({ fingers: 1,direction: PanDirection.All,distance: 6 })
          .onActionStart((_event: GestureEvent): void => { this.panel.dragStart(); })
          .onActionUpdate((event: GestureEvent): void => { this.panel.dragTo(event.offsetX,event.offsetY); })
          .onActionEnd((_event: GestureEvent): void => { this.panel.dragEnd(); })
          .onActionCancel((): void => { this.panel.dragCancel(); }))
      Column({ space: 2 }) {
        if (this.panel.small) {
          Text(xopcFormatCaptureTime(this.capture.elapsedMs)).fontSize(17).fontFamily('monospace').fontColor(this.colors.foreground).maxLines(1)
          Text(this.stateLabel()).fontSize(11).fontColor(this.colors.secondary).maxLines(1)
        } else {
          Row({ space: 6 }) {
            Row() {}.width(7).height(7).borderRadius(4).backgroundColor(this.capture.captureStatus === 'recording' ? this.colors.danger : this.colors.secondary)
            Text(this.stateLabel()).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).maxLines(1)
          }
          Text($r('app.string.note_voice_option')).fontSize(12).fontColor(this.colors.secondary).maxLines(1)
        }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      if (this.panel.small && !this.panel.narrow) { this.compactActions() }
      this.iconAction(this.panel.small ? $r('app.string.capture_panel_expand') : $r('app.string.capture_panel_minimize'),this.panel.small ? $r('sys.symbol.chevron_up') : $r('sys.symbol.minus'),'capture-float-size',true,(): void => { this.panel.setCompact(!this.panel.small); })
    }.width('100%').height(56).padding({ left: 8,right: 8 })
  }
  @Builder
  positionChoices() {
    if (this.panel.positionMenu) {
      Column({ space: 4 }) {
        Row({ space: 4 }) {
          Button($r('app.string.capture_panel_top_left')).layoutWeight(1).height(40).fontSize(12).onClick((): void => { this.panel.corner(false,false); })
          Button($r('app.string.capture_panel_top_right')).layoutWeight(1).height(40).fontSize(12).onClick((): void => { this.panel.corner(true,false); })
        }.width('100%')
        Row({ space: 4 }) {
          Button($r('app.string.capture_panel_bottom_left')).layoutWeight(1).height(40).fontSize(12).onClick((): void => { this.panel.corner(false,true); })
          Button($r('app.string.capture_panel_bottom_right')).layoutWeight(1).height(40).fontSize(12).onClick((): void => { this.panel.corner(true,true); })
        }.width('100%')
      }.width('100%').padding({ left: 12,right: 12,bottom: 8 })
    }
  }
  @Builder
  notices() {
    if (this.capture.shutdownIncomplete || this.capture.error === 'CAPTURE_STORAGE_FAILED') Text($r('app.string.capture_storage_failed')).fontSize(12).fontColor(this.colors.danger).width('100%')
    else if (this.capture.captureInterrupted) Text($r('app.string.capture_interrupted')).fontSize(12).fontColor(this.colors.danger).width('100%')
    else if (this.capture.syncStatus === 'failed' || this.capture.error === 'CAPTURE_UPLOAD_PENDING') Text($r('app.string.capture_panel_sync_failed')).fontSize(12).fontColor(this.colors.secondary).width('100%')
    else if (this.capture.phase === 'recording' && !this.capture.backgroundAvailable) Text($r('app.string.capture_foreground_only')).fontSize(12).fontColor(this.colors.danger).width('100%')
    else if (this.capture.error) Text($r('app.string.capture_panel_action_failed')).fontSize(12).fontColor(this.colors.danger).width('100%')
    if (this.capture.interruptionCount > 0) Text($r('app.string.capture_has_interruptions')).fontSize(12).fontColor(this.colors.secondary).width('100%')
    if (this.capture.markerError) Text($r('app.string.discussion_marker_failed')).fontSize(12).fontColor(this.colors.danger).width('100%')
  }
  @Builder
  expandedBody() {
    Column({ space: 12 }) {
      Row({ space: 12 }) {
        Text(xopcFormatCaptureTime(this.capture.elapsedMs)).fontSize(36).fontFamily('monospace').fontColor(this.colors.foreground).layoutWeight(1)
        if (this.capture.captureStatus === 'recording') {
          Row({ space: 3 }) {
            ForEach([0,1,2,3,4],(index: number) => {
              Row() {}.width(3).height(5 + Math.max(0,Math.min(1,this.capture.level)) * (index % 2 ? 14 : 22)).borderRadius(2).backgroundColor(this.colors.accent)
            },(index: number): string => index.toString())
            Text($r('app.string.capture_panel_input')).fontSize(12).fontColor(this.colors.secondary)
          }.height(28)
        }
      }.width('100%')
      Button({ type: ButtonType.Normal }) {
        Row() {
          Text(this.saveLabel()).fontSize(12).fontColor(this.colors.secondary).layoutWeight(1).textAlign(TextAlign.Start)
          SymbolGlyph(this.panel.detailsOpen ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down')).fontSize(12).fontColor([this.colors.secondary])
        }.width('100%')
      }.id('capture-float-save').width('100%').constraintSize({ minHeight: 40 }).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.capture_panel_details')).onClick((): void => { this.panel.detailsOpen = !this.panel.detailsOpen; })
      this.notices()
      if (this.panel.detailsOpen) {
        Column({ space: 6 }) {
          Text($r('app.string.capture_panel_backup')).fontSize(12).fontColor(this.colors.secondary).width('100%')
          Text(this.syncLabel()).fontSize(13).fontColor(this.colors.foreground).width('100%')
          Text($r('app.string.capture_panel_notes')).fontSize(12).fontColor(this.colors.secondary).width('100%')
          Text(this.analysisLabel()).fontSize(13).fontColor(this.colors.foreground).width('100%')
          if (this.capture.shutdownIncomplete) Text($r('app.string.capture_p0_stop_incomplete')).fontSize(12).fontColor(this.colors.danger)
        }.width('100%').alignItems(HorizontalAlign.Start).padding(12).borderRadius(12).backgroundColor(this.colors.input)
      }
      Button($r('app.string.capture_panel_transcript')).id('capture-float-transcript').width('100%').height(40).fontSize(12)
        .backgroundColor(this.colors.input).fontColor(this.colors.secondary).borderRadius(12)
        .onClick((): void => { this.panel.transcriptOpen = !this.panel.transcriptOpen; })
      if (this.panel.transcriptOpen) Text(this.capture.visibleTranscript || $r('app.string.capture_panel_text_pending')).fontSize(14).lineHeight(22).fontColor(this.colors.foreground).width('100%')
      if (this.capture.captureStatus === 'recording' && this.capture.transcriptPending && !this.capture.realtimeActive) Text($r('app.string.capture_p0_delayed')).fontSize(12).fontColor(this.colors.secondary).width('100%')
      if (this.capture.markers.length) Text($r('app.string.discussion_marker_saved',xopcFormatCaptureTime(this.capture.markers[this.capture.markers.length - 1]))).fontSize(12).fontColor(this.colors.accent).width('100%')
      if (this.capture.phase === 'error') {
        Button($r('app.string.capture_recovery_list')).height(44).fontSize(13).onClick((): void => { this.panel.setCompact(true); this.onRecovery(); })
        Row({ space: 8 }) {
          Button($r('app.string.capture_continue')).layoutWeight(1).height(44).fontSize(13).enabled(!this.capture.recoveryBusy && !this.panel.finishing)
            .onClick((): void => { void this.capture.continueCurrent(this.getUIContext().getHostContext() as common.UIAbilityContext); })
          Button($r('app.string.capture_export')).layoutWeight(1).height(44).fontSize(13).enabled(!this.capture.recoveryBusy && !this.panel.finishing)
            .onClick((): void => { void this.capture.exportCurrent(this.getUIContext().getHostContext() as common.UIAbilityContext); })
        }.width('100%')
      }
    }.width('100%').padding({ left: 16,right: 16,top: 8,bottom: 12 }).alignItems(HorizontalAlign.Start)
  }
  @Builder
  labeledAction(label: Resource,symbol: Resource,id: string,enabled: boolean,action: () => void,primary: boolean = false) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 5 }) {
        SymbolGlyph(symbol).fontSize(16).fontColor([primary ? this.colors.panel : this.colors.foreground])
        Text(label).fontSize(13).maxLines(1).fontColor(primary ? this.colors.panel : this.colors.foreground)
      }.justifyContent(FlexAlign.Center)
    }.id(id).layoutWeight(1).height(44).padding({ left: 6,right: 6 }).borderRadius(12).enabled(enabled)
      .backgroundColor(primary ? this.colors.accent : this.colors.input).accessibilityText(label).onClick(action)
  }
  build() {
    Column() {
      this.header()
      if (this.panel.positionMenu) {
        Scroll() { this.positionChoices() }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
      } else {
      if (this.panel.small && this.panel.narrow) { Row({ space: 8 }) { this.compactActions() }.width('100%').justifyContent(FlexAlign.End).padding({ left: 12,right: 12,bottom: 6 }) }
      Scroll() {
        if (this.ended()) {
          Column({ space: 8 }) {
            RecordingOutcomeCard({ input: this.outcome(),compact: this.panel.small,busy: this.panel.finishing || this.capture.recoveryBusy || this.outcomeModel.retrying,
              onRetry: (mode: string): void => { this.retryOutcome(mode); } })
            if (this.capture.markerError) {
              Text(recordingOutcomePhrase('annotation_failed')).fontSize(12).fontColor(this.colors.secondary)
              Button(recordingOutcomePhrase('retry_annotation')).height(40).enabled(!this.capture.recoveryBusy).onClick((): void => { void this.capture.retryAnnotations(); })
            }
            if (this.capture.noteId) Button(recordingOutcomePhrase('open')).height(40).onClick((): void => { this.onOpenNote(this.capture.noteId); })
            if (this.capture.phase === 'error' && !this.capture.localSaveComplete) Button($r('app.string.capture_continue')).height(40).enabled(!this.capture.recoveryBusy && !this.panel.finishing).onClick((): void => { void this.capture.continueCurrent(this.getUIContext().getHostContext() as common.UIAbilityContext); })
            if (this.capture.phase === 'error' && this.capture.savedDurationMs > 0) {
              Button(recordingOutcomePhrase('export')).height(40).enabled(!this.capture.recoveryBusy).onClick((): void => { void this.capture.exportCurrent(this.getUIContext().getHostContext() as common.UIAbilityContext); })
            }
            if (this.outcomeModel.error) Text($r('app.string.capture_panel_action_failed')).fontSize(12).fontColor(this.colors.danger)
            if (this.capture.localSaveComplete || this.capture.syncStatus === 'available') Button(recordingOutcomePhrase('close')).height(40).onClick((): void => { this.panel.dismissed = true; this.capture.reset(); })
          }.width('100%').padding(12)
        } else if (this.panel.small) {
          Column({ space: 5 }) {
            Text(this.saveLabel()).fontSize(12).fontColor(this.colors.secondary).maxLines(2).width('100%')
            this.notices()
            if (this.capture.markers.length && !this.panel.notice) Text($r('app.string.discussion_marker_saved',xopcFormatCaptureTime(this.capture.markers[this.capture.markers.length - 1]))).fontSize(12).fontColor(this.colors.accent).maxLines(1)
          }.width('100%').padding({ left: 12,right: 12,bottom: 8 }).alignItems(HorizontalAlign.Start)
        } else { this.expandedBody() }
        // Content scrolling does not participate in panel dragging.
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
      if (!this.panel.small && !this.ended()) {
        Column({ space: 5 }) {
          Row({ space: 8 }) {
            this.labeledAction($r('app.string.capture_marker'),$r('sys.symbol.bookmark'),'capture-float-mark',!this.panel.finishing && recordingPanelAvailability(this.capture).mark,(): void => { void this.panel.mark(this.capture); })
            this.labeledAction(this.capture.phase === 'paused' ? $r('app.string.resume') : $r('app.string.pause'),this.capture.phase === 'paused' ? $r('sys.symbol.play_fill') : $r('sys.symbol.pause_fill'),'capture-float-pause',!this.panel.finishing && recordingPanelAvailability(this.capture).pause,(): void => { this.panel.pause(this.capture); })
            this.labeledAction(this.capture.phase === 'error' ? $r('app.string.retry') : $r('app.string.capture_finish'),$r('sys.symbol.stop_circle_fill'),'capture-float-finish',!this.panel.finishing && recordingPanelAvailability(this.capture).finish,(): void => { void this.finishRecording(); },true)
          }.width('100%')
          Row() {
            Text($r('app.string.capture_panel_limit')).fontSize(11).fontColor(this.colors.tertiary).layoutWeight(1)
            if (this.capture.noteId) Button($r('app.string.capture_panel_open_note')).height(32).padding({ left: 8,right: 0 }).fontSize(12).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
              .onClick((): void => { this.onOpenNote(this.capture.noteId); })
          }.width('100%')
        }.width('100%').padding({ left: 12,right: 12,top: 8,bottom: 8 })
      }
      }
    }.id('discussion-recording-float').width(this.panel.cardWidth).height(this.panel.cardHeight)
      .alignItems(HorizontalAlign.Start).backgroundColor(this.colors.panel).borderRadius(20)
      .shadow(ShadowStyle.OUTER_DEFAULT_SM).clip(true).position({ x: this.panel.panelX,y: this.panel.panelY }).zIndex(50)
  }
}
