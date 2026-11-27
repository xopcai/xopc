import { RecordingOutcomeCard } from './RecordingOutcomeCard';
import { recordingOutcomePhrase } from '../common/recordingOutcomeResources';
import { XopcRecordingOutcomeInput } from '../common/recordingOutcome';
import { XopcDiscussionNoteViewModel } from '../viewmodel/discussionNoteViewModel';
import { common } from '@kit.AbilityKit';
import { xopcToast } from '../common/dialogActions';
import { xopcClickEffect, xopcRevealTransition } from '../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { xopcFormatCaptureTime } from '../common/discussionAudio';
import { discussionCapture, XopcDiscussionCapture } from '../service/discussionCapture';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { XopcDiscussionRecordingPanel, XopcRecordingPanelAvailability, recordingPanelAvailability } from '../viewmodel/discussionRecordingPanel';

@ComponentV2
struct XopcRecordingControl {
  @Require @Param label: Resource;
  @Require @Param symbol: Resource;
  @Require @Param controlId: string;
  @Param available: boolean = true;
  @Param primary: boolean = false;
  @Param danger: boolean = false;
  @Param iconOnly: boolean = false;
  @Event onPress: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;

  private fill(): Resource {
    if (this.danger) return this.colors.danger;
    if (this.primary) return this.colors.accent;
    return this.colors.input;
  }

  private tint(): Resource {
    if (this.danger || this.primary) return this.colors.onAccent;
    return this.colors.foreground;
  }

  build() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 6 }) {
        SymbolGlyph(this.symbol).fontSize(this.iconOnly ? 17 : 15)
          .fontColor([this.tint()])
        if (!this.iconOnly) {
          Text(this.label).fontSize(14).fontWeight(FontWeight.Medium).maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .fontColor(this.tint())
        }
      }.justifyContent(FlexAlign.Center)
    }.id(this.controlId).width(this.iconOnly ? 44 : undefined).layoutWeight(this.iconOnly ? 0 : 1)
      .height(46).padding({ left: 10, right: 10 }).borderRadius(23).clipShape(this.colors.cornerClip(23))
      .enabled(this.available).opacity(this.available ? 1 : 0.42).backgroundColor(this.fill())
      .clickEffect(xopcClickEffect()).accessibilityText(this.label).onClick((): void => { this.onPress(); })
  }
}

@ComponentV2
export struct XopcDiscussionRecordingPanelView {
  @Require @Param panel: XopcDiscussionRecordingPanel;
  @Param viewportWidth: number = 0;
  @Param viewportHeight: number = 0;
  @Param bottomChromeInset: number = 0;
  @Param docked: boolean = false;
  @Event onOpenNote: (id: string) => void = (_id: string): void => {};
  @Event onRecovery: () => void = (): void => {};
  @Local outcomeModel: XopcDiscussionNoteViewModel = new XopcDiscussionNoteViewModel();
  @Local capture: XopcDiscussionCapture = discussionCapture;
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local sheetDragOffset: number = 0;

  @Computed get controls(): XopcRecordingPanelAvailability { return recordingPanelAvailability(this.capture); }
  @Computed get canDismissOutcome(): boolean { return this.capture.localSaveComplete || this.capture.syncStatus === 'available'; }
  @Computed get panelHeight(): number {
    return this.docked && this.ended() ? Math.min(320, this.panel.cardHeight) : this.panel.cardHeight;
  }

  aboutToAppear(): void { this.resizePanel(); this.updateNotice(); this.followOutcome(); }
  aboutToDisappear(): void { this.outcomeModel.stop(); }
  @Monitor('capture.phase', 'capture.noteId')
  followOutcome(): void {
    if (this.capture.noteId && this.ended()) this.outcomeModel.start(this.capture.noteId);
    else { this.outcomeModel.stop(); this.outcomeModel.detail = undefined; }
  }
  private ended(): boolean { return this.capture.phase === 'completed' || this.capture.phase === 'stopping' || this.capture.phase === 'organizing' || this.capture.phase === 'error'; }
  private outcome(): XopcRecordingOutcomeInput {
    const value = this.outcomeModel.outcome(this.capture.localSaveComplete ? 'complete' : this.capture.phase === 'stopping' ? 'saving' : this.capture.savedDurationMs > 0 ? 'partial' : 'failed', this.capture.syncStatus);
    if (!value.audioDeleted && this.capture.syncStatus === 'available') value.audioAvailable = true;
    if (value.audioDeleted) value.localSave = 'unknown';
    return value;
  }
  private retryOutcome(mode: string): void {
    if (mode === 'recover') { this.panel.setCompact(true); this.onRecovery(); }
    else if (mode === 'sync') void this.finishRecording();
    else void this.outcomeModel.retryOutcome(mode);
  }
  @Monitor('viewportWidth', 'viewportHeight', 'docked', 'bottomChromeInset')
  resizePanel(): void {
    this.sheetDragOffset = 0;
    this.panel.resize(this.viewportWidth, this.viewportHeight, this.bottomChromeInset);
  }
  @Monitor('capture.captureInterrupted', 'capture.shutdownIncomplete', 'capture.error', 'capture.markerError', 'capture.backgroundAvailable', 'capture.phase', 'capture.interruptionCount')
  updateNotice(): void {
    this.panel.setNotice(this.capture.interruptionCount > 0 || !!this.capture.markerError || !!this.capture.error || this.capture.captureInterrupted || this.capture.shutdownIncomplete ||
      (this.capture.phase === 'recording' && !this.capture.backgroundAvailable));
  }
  private stateLabel(): Resource {
    if (this.capture.captureStatus === 'waiting') return $r('app.string.capture_p0_waiting');
    if (this.capture.captureStatus === 'interrupted') return $r('app.string.capture_interrupted');
    if (this.capture.captureStatus === 'paused') return $r('app.string.capture_paused');
    if (this.capture.captureStatus === 'stopping') return $r('app.string.capture_p0_stopping');
    if (this.capture.captureStatus === 'stopped') return $r('app.string.capture_p0_stopped');
    return $r('app.string.capture_live');
  }
  private saveLabel(): Resource {
    if (this.capture.localSaveComplete) return $r('app.string.capture_p0_local_complete');
    if (this.capture.savedDurationMs > 0) return $r('app.string.capture_local_saved', xopcFormatCaptureTime(this.capture.savedDurationMs));
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
    try { await this.panel.finish(this.capture); }
    catch (_error) { xopcToast(this.getUIContext(), $r('app.string.capture_panel_action_failed')); }
  }
  private dismissOutcome(): void {
    this.panel.dismissed = true;
    this.capture.reset();
  }
  private openOutcomeNote(): void {
    const id = this.capture.noteId;
    if (this.canDismissOutcome && !this.capture.markerError) this.dismissOutcome();
    this.onOpenNote(id);
  }

  @Builder
  captureActions(iconOnly: boolean) {
    XopcRecordingControl({
      label: $r('app.string.capture_marker'), symbol: $r('sys.symbol.bookmark'), controlId: 'capture-float-mark',
      iconOnly: iconOnly, available: !this.panel.finishing && this.controls.mark,
      onPress: (): void => { void this.panel.mark(this.capture); }
    })
    XopcRecordingControl({
      label: this.capture.phase === 'paused' ? $r('app.string.resume') : $r('app.string.pause'),
      symbol: this.capture.phase === 'paused' ? $r('sys.symbol.play_fill') : $r('sys.symbol.pause_fill'),
      controlId: 'capture-float-pause', iconOnly: iconOnly, available: !this.panel.finishing && this.controls.pause,
      onPress: (): void => { this.panel.pause(this.capture); }
    })
    XopcRecordingControl({
      label: $r('app.string.capture_finish'), symbol: $r('sys.symbol.stop_circle_fill'), controlId: 'capture-float-finish',
      iconOnly: iconOnly, primary: true, danger: this.capture.phase === 'recording',
      available: !this.panel.finishing && this.controls.finish,
      onPress: (): void => { void this.finishRecording(); }
    })
  }

  @Builder
  sheetHandle() {
    Button({ type: ButtonType.Normal }) {
      Row() {}.width(36).height(4).borderRadius(2).backgroundColor(this.colors.tertiary)
    }.id('capture-sheet-handle').width(80).height(28).padding(0).alignSelf(ItemAlign.Center)
      .backgroundColor(Color.Transparent).accessibilityText($r('app.string.capture_panel_minimize'))
      .onClick((): void => { this.panel.setCompact(true); })
      .gesture(PanGesture({ fingers: 1, direction: PanDirection.Down, distance: 6 })
        .onActionUpdate((event: GestureEvent): void => { this.sheetDragOffset = Math.max(0, event.offsetY); })
        .onActionEnd((event: GestureEvent): void => {
          this.sheetDragOffset = 0;
          if (event.offsetY >= 44) this.panel.setCompact(true);
        })
        .onActionCancel((): void => { this.sheetDragOffset = 0; }))
  }

  @Builder
  header() {
    Row({ space: 6 }) {
      if (!this.docked) {
        Button({ type: ButtonType.Normal }) {
          Column({ space: 3 }) {
            ForEach([0, 1, 2], (index: number) => {
              Row({ space: 3 }) {
                Row() {}.width(3).height(3).borderRadius(2).backgroundColor(this.colors.secondary)
                Row() {}.width(3).height(3).borderRadius(2).backgroundColor(this.colors.secondary)
              }
            }, (index: number): string => index.toString())
          }
        }
          .id('capture-float-move').width(40).height(40).padding(0).borderRadius(20).backgroundColor(Color.Transparent)
          .accessibilityText($r('app.string.capture_panel_move')).onClick((): void => { this.panel.togglePositions(); })
          .gesture(PanGesture({ fingers: 1, direction: PanDirection.All, distance: 6 })
            .onActionStart((_event: GestureEvent): void => { this.panel.dragStart(); })
            .onActionUpdate((event: GestureEvent): void => { this.panel.dragTo(event.offsetX, event.offsetY); })
            .onActionEnd((_event: GestureEvent): void => { this.panel.dragEnd(); })
            .onActionCancel((): void => { this.panel.dragCancel(); }))
      }
      if (this.ended()) {
        this.outcomeHeader()
      } else {
        Column({ space: 2 }) {
          if (this.panel.small) {
            Text(xopcFormatCaptureTime(this.capture.elapsedMs)).fontSize(17).fontFamily('monospace')
              .fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).maxLines(1)
            Text(this.stateLabel()).fontSize(11).fontColor(this.colors.secondary).maxLines(1)
          } else {
            Row({ space: 7 }) {
              Row() {}.width(8).height(8).borderRadius(4)
                .backgroundColor(this.capture.captureStatus === 'recording' ? this.colors.danger : this.colors.secondary)
              Text(this.stateLabel()).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).maxLines(1)
            }
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        if (this.panel.small && !this.panel.narrow) { this.captureActions(true) }
      }
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph(this.panel.small ? $r('sys.symbol.chevron_up') : this.docked ? $r('sys.symbol.chevron_down') : $r('sys.symbol.minus'))
          .fontSize(15).fontColor([this.colors.secondary])
      }.id('capture-float-size').width(36).height(36).padding(0).backgroundColor(this.colors.input)
        .clickEffect(xopcClickEffect())
        .accessibilityText(this.panel.small ? $r('app.string.capture_panel_expand') : $r('app.string.capture_panel_minimize'))
        .onClick((): void => { this.panel.setCompact(!this.panel.small); })
    }.width('100%').height(52).padding({ left: this.docked ? 20 : 10, right: 14 })
  }

  @Builder
  outcomeHeader() {
    Row({ space: 10 }) {
      Row() {
        SymbolGlyph(this.canDismissOutcome ? $r('sys.symbol.checkmark_circle_fill') : $r('sys.symbol.stop_circle_fill'))
          .fontSize(20).fontColor([this.canDismissOutcome ? this.colors.success : this.colors.secondary])
      }.width(38).height(38).justifyContent(FlexAlign.Center).borderRadius(19)
        .backgroundColor(this.canDismissOutcome ? this.colors.successSoft : this.colors.input)
      Column({ space: 2 }) {
        Text(this.canDismissOutcome ? $r('app.string.capture_panel_saved') : $r('app.string.capture_p0_stopped'))
          .fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.capture.savedDurationMs > 0) {
          Text(xopcFormatCaptureTime(this.capture.savedDurationMs)).fontSize(12).fontFamily('monospace').fontColor(this.colors.secondary)
        }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }.layoutWeight(1).padding({ left: this.docked ? 0 : 4, right: 4 })
  }

  @Builder
  positionChoices() {
    if (this.panel.positionMenu) {
      Column({ space: 6 }) {
        Row({ space: 6 }) {
          Button($r('app.string.capture_panel_top_left'), { type: ButtonType.Normal })
            .layoutWeight(1).height(40).fontSize(13).fontColor(this.colors.foreground).backgroundColor(this.colors.input)
            .borderRadius(this.colors.corner(12)).onClick((): void => { this.panel.corner(false, false); })
          Button($r('app.string.capture_panel_top_right'), { type: ButtonType.Normal })
            .layoutWeight(1).height(40).fontSize(13).fontColor(this.colors.foreground).backgroundColor(this.colors.input)
            .borderRadius(this.colors.corner(12)).onClick((): void => { this.panel.corner(true, false); })
        }.width('100%')
        Row({ space: 6 }) {
          Button($r('app.string.capture_panel_bottom_left'), { type: ButtonType.Normal })
            .layoutWeight(1).height(40).fontSize(13).fontColor(this.colors.foreground).backgroundColor(this.colors.input)
            .borderRadius(this.colors.corner(12)).onClick((): void => { this.panel.corner(false, true); })
          Button($r('app.string.capture_panel_bottom_right'), { type: ButtonType.Normal })
            .layoutWeight(1).height(40).fontSize(13).fontColor(this.colors.foreground).backgroundColor(this.colors.input)
            .borderRadius(this.colors.corner(12)).onClick((): void => { this.panel.corner(true, true); })
        }.width('100%')
      }.width('100%').padding({ left: 14, right: 14, bottom: 10 })
    }
  }

  @Builder
  notices() {
    if (this.capture.shutdownIncomplete || this.capture.error === 'CAPTURE_STORAGE_FAILED') {
      Text($r('app.string.capture_storage_failed')).fontSize(12).lineHeight(18).fontColor(this.colors.danger).width('100%')
    } else if (this.capture.captureInterrupted) {
      Text($r('app.string.capture_interrupted')).fontSize(12).lineHeight(18).fontColor(this.colors.danger).width('100%')
    } else if (this.capture.syncStatus === 'failed' || this.capture.error === 'CAPTURE_UPLOAD_PENDING') {
      Text($r('app.string.capture_panel_sync_failed')).fontSize(12).lineHeight(18).fontColor(this.colors.secondary).width('100%')
    } else if (this.capture.phase === 'recording' && !this.capture.backgroundAvailable) {
      Text($r('app.string.capture_foreground_only')).fontSize(12).lineHeight(18).fontColor(this.colors.danger).width('100%')
    } else if (this.capture.error) {
      Text($r('app.string.capture_panel_action_failed')).fontSize(12).lineHeight(18).fontColor(this.colors.danger).width('100%')
    }
    if (this.capture.interruptionCount > 0) {
      Text($r('app.string.capture_has_interruptions')).fontSize(12).lineHeight(18).fontColor(this.colors.secondary).width('100%')
    }
    if (this.capture.markerError) {
      Text($r('app.string.discussion_marker_failed')).fontSize(12).lineHeight(18).fontColor(this.colors.danger).width('100%')
    }
  }

  @Builder
  expandedBody() {
    Column({ space: 14 }) {
      Row({ space: 12 }) {
        Text(xopcFormatCaptureTime(this.capture.elapsedMs)).fontSize(38).fontFamily('monospace')
          .fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).layoutWeight(1)
          .maxLines(1).minFontSize(22).maxFontSize(38)
        if (this.capture.captureStatus === 'recording') {
          Row({ space: 4 }) {
            ForEach([0, 1, 2, 3, 4], (index: number) => {
              Row() {}.width(3.5).height(index === 2 ? 30 : index % 2 ? 22 : 16).borderRadius(2)
                .backgroundColor(this.colors.danger)
                .scale({ x: 1, y: 0.24 + Math.max(0, Math.min(1, this.capture.level)) * 0.76 })
            }, (index: number): string => index.toString())
          }.height(32).alignItems(VerticalAlign.Center)
        }
      }.width('100%').height(52).alignItems(VerticalAlign.Center)

      this.notices()

      if (this.capture.markers.length) {
        Row({ space: 6 }) {
          SymbolGlyph($r('sys.symbol.bookmark')).fontSize(12).fontColor([this.colors.accent])
          Text($r('app.string.discussion_marker_saved', xopcFormatCaptureTime(this.capture.markers[this.capture.markers.length - 1])))
            .fontSize(12).fontColor(this.colors.accent).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        }.width('100%').padding({ left: 10, right: 10, top: 6, bottom: 6 })
          .borderRadius(this.colors.corner(10)).backgroundColor(this.colors.accentSoft)
      }

      Column({ space: 8 }) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 8 }) {
            SymbolGlyph($r('sys.symbol.doc_plaintext')).fontSize(14).fontColor([this.colors.secondary])
            Text($r('app.string.capture_panel_transcript')).fontSize(13).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.Start)
            SymbolGlyph(this.panel.transcriptOpen ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
              .fontSize(12).fontColor([this.colors.secondary])
          }.width('100%')
        }.id('capture-float-transcript').width('100%').height(40).padding({ left: 12, right: 12 })
          .backgroundColor(Color.Transparent).onClick((): void => { this.panel.transcriptOpen = !this.panel.transcriptOpen; })

        if (this.panel.transcriptOpen) {
          Text(this.capture.visibleTranscript || $r('app.string.capture_panel_text_pending'))
            .fontSize(14).lineHeight(22)
            .fontColor(this.capture.visibleTranscript ? this.colors.foreground : this.colors.secondary)
            .width('100%').padding({ left: 12, right: 12, bottom: 12 })
        }
      }.width('100%').borderRadius(this.colors.corner(14)).backgroundColor(this.colors.input)

      if (this.capture.captureStatus === 'recording' && this.capture.transcriptPending && !this.capture.realtimeActive) {
        Text($r('app.string.capture_p0_delayed')).fontSize(12).fontColor(this.colors.secondary).width('100%')
      }

      Button({ type: ButtonType.Normal }) {
        Row({ space: 6 }) {
          Text(this.saveLabel()).fontSize(12).fontColor(this.colors.tertiary).layoutWeight(1).textAlign(TextAlign.Start)
          SymbolGlyph(this.panel.detailsOpen ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
            .fontSize(11).fontColor([this.colors.tertiary])
        }.width('100%')
      }.id('capture-float-save').width('100%').constraintSize({ minHeight: 32 }).padding(0)
        .backgroundColor(Color.Transparent).accessibilityText($r('app.string.capture_panel_details'))
        .onClick((): void => { this.panel.detailsOpen = !this.panel.detailsOpen; })

      if (this.panel.detailsOpen) {
        Column({ space: 6 }) {
          Text($r('app.string.capture_panel_backup')).fontSize(12).fontColor(this.colors.secondary).width('100%')
          Text(this.syncLabel()).fontSize(13).fontColor(this.colors.foreground).width('100%')
          Text($r('app.string.capture_panel_notes')).fontSize(12).fontColor(this.colors.secondary).width('100%')
          Text(this.analysisLabel()).fontSize(13).fontColor(this.colors.foreground).width('100%')
          if (this.capture.shutdownIncomplete) {
            Text($r('app.string.capture_p0_stop_incomplete')).fontSize(12).fontColor(this.colors.danger)
          }
        }.width('100%').alignItems(HorizontalAlign.Start).padding(12).borderRadius(this.colors.corner(12)).backgroundColor(this.colors.input)
      }
    }.width('100%').padding({ left: 20, right: 20, top: 4, bottom: 12 }).alignItems(HorizontalAlign.Start)
  }

  @Builder
  outcomeBody() {
    Column({ space: 10 }) {
      RecordingOutcomeCard({ input: this.outcome(), compact: this.panel.small,
        busy: this.panel.finishing || this.capture.recoveryBusy || this.outcomeModel.retrying,
        onRetry: (mode: string): void => { this.retryOutcome(mode); } })
      if (this.capture.markerError) {
        Text(recordingOutcomePhrase('annotation_failed')).fontSize(12).fontColor(this.colors.secondary)
        Button(recordingOutcomePhrase('retry_annotation'), { type: ButtonType.Normal })
          .height(42).padding({ left: 16, right: 16 }).fontSize(14).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft)
          .borderRadius(this.colors.corner(12)).enabled(!this.capture.recoveryBusy).clickEffect(xopcClickEffect())
          .onClick((): void => { void this.capture.retryAnnotations(); })
      }
      if (this.capture.phase === 'error' && !this.capture.localSaveComplete) {
        Button($r('app.string.capture_continue'), { type: ButtonType.Normal })
          .height(42).padding({ left: 16, right: 16 }).fontSize(14).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft)
          .borderRadius(this.colors.corner(12)).enabled(!this.capture.recoveryBusy && !this.panel.finishing).clickEffect(xopcClickEffect())
          .onClick((): void => { void this.capture.continueCurrent(this.getUIContext().getHostContext() as common.UIAbilityContext); })
      }
      if (this.capture.phase === 'error' && this.capture.savedDurationMs > 0) {
        Button(recordingOutcomePhrase('export'), { type: ButtonType.Normal })
          .height(42).padding({ left: 16, right: 16 }).fontSize(14).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.foreground).backgroundColor(this.colors.input)
          .borderRadius(this.colors.corner(12)).enabled(!this.capture.recoveryBusy).clickEffect(xopcClickEffect())
          .onClick((): void => { void this.capture.exportCurrent(this.getUIContext().getHostContext() as common.UIAbilityContext); })
      }
      if (this.outcomeModel.error) Text($r('app.string.capture_panel_action_failed')).fontSize(12).fontColor(this.colors.danger)
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 20, right: 20, top: 8, bottom: 8 })
  }

  @Builder
  outcomeActions() {
    if (this.canDismissOutcome || this.capture.noteId) {
      Row({ space: 10 }) {
        if (this.canDismissOutcome) {
          Button(recordingOutcomePhrase('close'), { type: ButtonType.Normal })
            .id('capture-outcome-later').layoutWeight(1).height(46).fontSize(15).fontWeight(FontWeight.Medium)
            .borderRadius(23).fontColor(this.colors.foreground).backgroundColor(this.colors.input)
            .clickEffect(xopcClickEffect()).onClick((): void => { this.dismissOutcome(); })
        }
        if (this.capture.noteId) {
          Button(recordingOutcomePhrase('open'), { type: ButtonType.Normal })
            .id('capture-outcome-open').layoutWeight(1).height(46).fontSize(15).fontWeight(FontWeight.Medium)
            .borderRadius(23).fontColor(this.colors.onAccent).backgroundColor(this.colors.accent)
            .clickEffect(xopcClickEffect()).onClick((): void => { this.openOutcomeNote(); })
        }
      }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 16 })
    }
  }

  @Builder
  activeFooter() {
    Column({ space: 6 }) {
      Row({ space: 8 }) {
        this.captureActions(false)
      }.width('100%')
      if (this.capture.noteId) {
        Row() {
          Text($r('app.string.capture_panel_limit')).fontSize(11).fontColor(this.colors.tertiary).layoutWeight(1)
          Button($r('app.string.capture_panel_open_note'), { type: ButtonType.Normal })
            .height(30).padding({ left: 10, right: 10 }).fontSize(12).fontWeight(FontWeight.Medium)
            .backgroundColor(Color.Transparent).fontColor(this.colors.accent)
            .onClick((): void => { this.onOpenNote(this.capture.noteId); })
        }.width('100%').alignItems(VerticalAlign.Center)
      }
    }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 14 })
  }

  build() {
    Column() {
      if (this.docked) this.sheetHandle()
      this.header()
      if (this.panel.positionMenu) {
        Scroll() { this.positionChoices() }.layoutWeight(1).width('100%').align(Alignment.Top).scrollBar(BarState.Off)
      } else {
        if (this.panel.small && this.panel.narrow && !this.ended()) {
          Row({ space: 8 }) {
            this.captureActions(true)
          }.width('100%').justifyContent(FlexAlign.End).padding({ left: 14, right: 14, bottom: 6 })
        }
        Scroll() {
          if (this.ended()) {
            if (this.panel.small) {
              Column() {
                this.outcomeBody()
                this.outcomeActions()
              }.width('100%')
            } else {
              this.outcomeBody()
            }
          } else if (this.panel.small) {
            Column({ space: 5 }) {
              Text(this.saveLabel()).fontSize(12).fontColor(this.colors.secondary).maxLines(2).width('100%')
              this.notices()
              if (this.capture.markers.length && !this.panel.notice) {
                Text($r('app.string.discussion_marker_saved', xopcFormatCaptureTime(this.capture.markers[this.capture.markers.length - 1])))
                  .fontSize(12).fontColor(this.colors.accent).maxLines(1)
              }
            }.width('100%').padding({ left: 14, right: 14, bottom: 10 }).alignItems(HorizontalAlign.Start)
          } else {
            this.expandedBody()
          }
        }.layoutWeight(1).width('100%').align(Alignment.Top).edgeEffect(EdgeEffect.None).scrollBar(BarState.Off)
        if (!this.panel.small) {
          if (this.ended()) { this.outcomeActions() }
          else { this.activeFooter() }
        }
      }
    }.id('discussion-recording-float').width(this.panel.cardWidth).height(this.panelHeight)
      .alignItems(HorizontalAlign.Start).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(24))
      .shadow(ShadowStyle.OUTER_DEFAULT_SM).clip(true)
      .position({
        x: this.docked ? (this.viewportWidth - this.panel.cardWidth) / 2 : this.panel.panelX,
        y: this.docked ? this.viewportHeight - this.panelHeight - 8 - this.bottomChromeInset : this.panel.panelY
      }).translate({ y: this.docked ? this.sheetDragOffset : 0 })
      .transition(this.docked
        ? xopcRevealTransition(TransitionEdge.BOTTOM, this.layout.reduceMotion)
        : TransitionEffect.OPACITY.animation({ duration: 0 }))
      .zIndex(50)
  }
}
