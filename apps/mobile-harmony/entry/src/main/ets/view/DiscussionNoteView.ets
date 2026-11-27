import { XopcSegmentedTabs } from './SegmentedTabs';
import { userErrorMessage } from '../common/userError';
import { RecordingOutcomeCard } from './RecordingOutcomeCard';
import { XopcReviewEntry } from '../model/discussionCapture';
import { common } from '@kit.AbilityKit';
import { XopcDiscussionAnnotation, XopcEvidenceSegment, XopcPlaybackRange, XopcResolvedAnnotation } from '../model/discussionCapture';
import { xopcSheetOptions } from '../common/dialogActions';
import { xopcClickEffect } from '../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { xopcFormatCaptureTime } from '../common/discussionAudio';
import { XopcDiscussionActionItem, XopcDiscussionFact, XopcDiscussionTranscriptSegment } from '../model/discussionCapture';
import { XopcDiscussionNoteViewModel, discussionStillProcessing } from '../viewmodel/discussionNoteViewModel';
import {
  XopcEmptyHint,
  XopcHubRow,
  XopcPageSearchButton,
  XopcPageSearchField,
  XopcPaginationFooter,
  XopcSheetHeader,
} from './MobileComponents';
import { xopcMoreIcon } from '../common/designTokens';

/** Readable recording status, summary and transcript for a voice note. */
@ComponentV2
export struct XopcDiscussionNoteView {
  @Param noteId: string = '';
  @Event onNoteUpdated: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local model: XopcDiscussionNoteViewModel = new XopcDiscussionNoteViewModel();
  @Local editingAnnotation?: XopcDiscussionAnnotation;
  @Local annotationText: string = '';
  @Local annotationKind: string = 'highlight';
  @Local toolsMode: boolean = false;
  @Local searchOpen: boolean = false;
  @Local chaptersOpen: boolean = false;
  @Local coverageOpen: boolean = false;
  @Local transcriptExpanded: boolean = true;
  @Local visibleSegments: number = 20;

  aboutToAppear(): void { this.model.setContext(this.getUIContext().getHostContext() as common.Context); this.model.start(this.noteId, (): void => { this.onNoteUpdated(); }); }
  aboutToDisappear(): void { this.model.stop(); }

  @Monitor('noteId')
  onNoteIdChanged(): void {
    this.editingAnnotation = undefined; this.annotationText = ''; this.evidenceOpen = false; this.toolsMode = false; this.searchOpen = false; this.chaptersOpen = false;
    this.coverageOpen = false;
    this.transcriptExpanded = true;
    this.visibleSegments = 20;
    this.model.start(this.noteId, (): void => { this.onNoteUpdated(); });
  }

  private async saveAnnotationEdit(): Promise<void> {
    const current = this.editingAnnotation; if (!current) return;
    const remote = this.model.annotations.find((row: XopcResolvedAnnotation): boolean => row.annotation.id === current.id);
    const annotation: XopcDiscussionAnnotation = { id: current.id, kind: this.annotationKind, text: this.annotationText, anchor: current.anchor,
      revision: remote?.annotation.revision ?? current.revision, deleted: current.deleted, createdAt: current.createdAt, updatedAt: Date.now() };
    if (await this.model.saveAnnotation(annotation)) this.editingAnnotation = undefined;
  }

  private showOutcomeBanner(): boolean {
    const detail = this.model.detail;
    if (!detail) return false;
    if (detail.discussion.status === 'completed' && !detail.recordingJob && !this.model.retrying) return false;
    return detail.discussion.status !== 'recording' || !!detail.recordingJob;
  }

  private annotationBadgeFill(kind: string): Resource {
    if (kind === 'question') return this.colors.warningFill;
    if (kind === 'note') return this.colors.input;
    return this.colors.accentSoft;
  }

  private annotationBadgeTint(kind: string): Resource {
    if (kind === 'question') return this.colors.warningForeground;
    if (kind === 'note') return this.colors.secondary;
    return this.colors.accent;
  }

  @Builder
  subtlePillAction(label: ResourceStr, symbol: Resource, tone: 'accent' | 'neutral' | 'danger', onPress: () => void, enabled: boolean = true) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 5 }) {
        SymbolGlyph(symbol).fontSize(13)
          .fontColor([tone === 'accent' ? this.colors.accent : tone === 'danger' ? this.colors.danger : this.colors.secondary])
        Text(label).fontSize(12).fontWeight(FontWeight.Medium).maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .fontColor(tone === 'accent' ? this.colors.accent : tone === 'danger' ? this.colors.danger : this.colors.foreground)
      }.justifyContent(FlexAlign.Center)
    }.height(32).padding({ left: 10, right: 10 }).borderRadius(16)
      .backgroundColor(tone === 'accent' ? this.colors.accentSoft : tone === 'danger' ? this.colors.dangerSoft : this.colors.input)
      .enabled(enabled).clickEffect(xopcClickEffect()).onClick(onPress)
  }

  @Builder
  factSection(label: ResourceStr, items: XopcDiscussionFact[]) {
    if (items.some((item: XopcDiscussionFact): boolean => !item.ignored)) {
      Column({ space: 10 }) {
        Text(label).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary).width('100%')
        ForEach(items.filter((item: XopcDiscussionFact): boolean => !item.ignored), (item: XopcDiscussionFact) => {
          Row({ space: 8 }) {
            Text('•').fontSize(15).lineHeight(23).fontColor(this.colors.tertiary)
            Column({ space: 6 }) {
              Text(item.text).fontSize(15).lineHeight(23).fontColor(this.colors.foreground).width('100%')
              if (item.evidenceSegmentIds?.length) {
                Button({ type: ButtonType.Normal }) {
                  Row({ space: 4 }) {
                    SymbolGlyph($r('sys.symbol.doc_plaintext')).fontSize(12).fontColor([this.colors.accent])
                    Text($r('app.string.discussion_source')).fontSize(12).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
                  }
                }.height(28).padding({ left: 8, right: 10 }).borderRadius(14).backgroundColor(this.colors.accentSoft)
                  .clickEffect(xopcClickEffect())
                  .onClick((): void => { void this.model.cite(item.evidenceSegmentIds ?? [], item.evidenceRevision); })
              }
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          }.width('100%').alignItems(VerticalAlign.Top)
        }, (item: XopcDiscussionFact): string => item.id)
      }.width('100%').alignItems(HorizontalAlign.Start)
    }
  }

  @Builder
  transcriptRow(segment: XopcDiscussionTranscriptSegment) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 4 }) {
            SymbolGlyph($r('sys.symbol.play_fill')).fontSize(10).fontColor([this.colors.accent])
            Text(xopcFormatCaptureTime(segment.startedAtMs)).fontSize(12).fontFamily('monospace')
              .fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
          }
        }.height(28).padding({ left: 8, right: 10 }).borderRadius(14).backgroundColor(this.colors.accentSoft)
          .clickEffect(xopcClickEffect())
          .onClick((): void => { void this.model.cite([segment.sequence], this.model.detail?.transcript.revision, true); })
        if (segment.speakerLabel) {
          Text(segment.speakerLabel).fontSize(12).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        } else {
          Blank().layoutWeight(1)
        }
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.bookmark')).fontSize(15).fontColor([this.colors.secondary])
        }.width(34).height(34).padding(0).backgroundColor(this.colors.input)
          .accessibilityText($r('app.string.capture_marker')).clickEffect(xopcClickEffect())
          .onClick((): void => { void this.model.markSegment(segment); })
      }.width('100%').alignItems(VerticalAlign.Center)
      Text(segment.displayText ?? segment.rawText ?? $r('app.string.discussion_transcript_pending'))
        .fontSize(15).lineHeight(24).fontColor(this.colors.foreground).width('100%')
    }.width('100%').padding(14).borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
      .alignItems(HorizontalAlign.Start)
  }

  @Local evidenceOpen: boolean = false;
  @Monitor('model.evidence')
  onEvidenceChanged(): void {
    if (this.model.evidence) { this.toolsMode = false; this.evidenceOpen = true; }
    else if (!this.toolsMode) this.evidenceOpen = false;
  }

  @Builder
  evidenceSheet() {
    Column() {
      if (this.toolsMode) {
        XopcSheetHeader({ heading: $r('app.string.note_ui_tools'), onClose: (): void => { this.evidenceOpen = false; } })
        Scroll() { this.noteTools() }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
      } else if (this.model.evidence) {
        XopcSheetHeader({ heading: $r('app.string.discussion_source'), onClose: (): void => { this.model.evidence = undefined; this.evidenceOpen = false; } })
        Scroll() {
          Column({ space: 12 }) {
            if (this.model.previewEntry?.provisional) {
              Text($r('app.string.discussion_partial_content')).fontSize(12).lineHeight(18).fontColor(this.colors.secondary).width('100%')
            }
            if (this.model.evidence.stale) {
              Text($r('app.string.discussion_source_changed')).fontSize(12).lineHeight(18).fontColor(this.colors.warningForeground)
                .width('100%').padding(10).borderRadius(this.colors.corner(10)).backgroundColor(this.colors.warningFill)
            }
            if (!this.model.evidence.audioAvailable || !this.model.evidence.timingVerified) {
              Text($r('app.string.discussion_audio_unavailable')).fontSize(12).lineHeight(18).fontColor(this.colors.secondary).width('100%')
            }
            ForEach(this.model.evidence.segments, (segment: XopcEvidenceSegment) => {
              Column({ space: 8 }) {
                Text(xopcFormatCaptureTime(segment.startedAtMs) + '–' + xopcFormatCaptureTime(segment.endedAtMs))
                  .fontSize(12).fontFamily('monospace').fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
                Text(segment.text).fontSize(15).lineHeight(24).fontColor(this.colors.foreground).width('100%')
                Row({ space: 8 }) {
                  if (segment.playback.length) {
                    this.subtlePillAction($r('app.string.discussion_play_source'), $r('sys.symbol.play_fill'), 'accent', (): void => {
                      void this.model.play(segment.playback[0]);
                    })
                  }
                  if (!this.model.evidence?.stale && (!this.model.previewEntry?.provisional || this.model.previewEntry.kind === 'chapter')) {
                    this.subtlePillAction($r('app.string.discussion_locate_transcript'), $r('sys.symbol.doc_plaintext'), 'neutral', (): void => {
                      this.model.locateReviewSegment(segment.sequence);
                    })
                  }
                }.width('100%')
              }.width('100%').padding(14).borderRadius(this.colors.corner(14)).backgroundColor(this.colors.input)
                .alignItems(HorizontalAlign.Start)
            }, (segment: XopcEvidenceSegment): string => segment.sequence.toString())
          }.width('100%').padding({ left: 20, right: 20, top: 4, bottom: 24 }).alignItems(HorizontalAlign.Start)
        }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
      }
    }.width('100%').height('100%').backgroundColor(this.colors.panel)
  }

  @Builder
  noteTools() {
    Column({ space: 10 }) {
      XopcHubRow({
        heading: $r('app.string.note_ui_organize'),
        symbol: $r('sys.symbol.star'),
        compact: true,
        onOpen: (): void => {
          if (!this.model.retrying && !!this.model.detail?.discussion.canonicalTranscript &&
            (this.model.detail?.discussion.status === 'completed' || this.model.detail?.discussion.status === 'needs_attention')) {
            void this.model.retryOutcome('analyze');
            this.evidenceOpen = false;
          }
        },
      })
      if (this.model.detail?.discussion.audioAttachmentId && !this.model.detail.discussion.audioDeletedAt &&
        (this.model.detail.discussion.status === 'completed' || this.model.detail.discussion.status === 'needs_attention')) {
        XopcHubRow({
          heading: $r('app.string.discussion_regenerate_audio'),
          summary: $r('app.string.discussion_regenerate_retained'),
          symbol: $r('sys.symbol.arrow_clockwise'),
          compact: true,
          onOpen: (): void => {
            if (!this.model.retrying) {
              void this.model.retry(true);
              this.evidenceOpen = false;
            }
          },
        })
      }
      if (this.model.review) {
        Column({ space: 8 }) {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 8 }) {
              Text($r('app.string.note_ui_coverage')).fontSize(14).fontWeight(FontWeight.Medium)
                .fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.Start)
              SymbolGlyph(this.coverageOpen ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
                .fontSize(12).fontColor([this.colors.secondary])
            }.width('100%')
          }.width('100%').height(40).padding({ left: 12, right: 12 }).backgroundColor(Color.Transparent)
            .onClick((): void => { this.coverageOpen = !this.coverageOpen; })
          if (this.coverageOpen) {
            Column({ space: 6 }) {
              Text(this.model.review.coverage.audioAvailable ? $r('app.string.discussion_audio_saved_review')
                : $r('app.string.discussion_audio_unavailable')).fontSize(12).fontColor(this.colors.secondary)
              Text($r('app.string.discussion_processed_coverage', xopcFormatCaptureTime(this.model.review.coverage.processedMs),
                xopcFormatCaptureTime(this.model.review.coverage.durationMs), xopcFormatCaptureTime(this.model.review.coverage.continuousThroughMs)))
                .fontSize(12).fontColor(this.colors.secondary)
              Text(this.model.review.coverage.complete ? $r('app.string.discussion_run_complete')
                : $r('app.string.discussion_partial_content')).fontSize(12).fontColor(this.colors.secondary)
            }.width('100%').padding({ left: 12, right: 12, bottom: 12 }).alignItems(HorizontalAlign.Start)
          }
        }.width('100%').borderRadius(this.colors.corner(14)).backgroundColor(this.colors.input)
      }
    }.width('100%').padding({ left: 20, right: 20, top: 4, bottom: 24 }).alignItems(HorizontalAlign.Start)
  }

  @Builder
  reviewRow(entry: XopcReviewEntry) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Column({ space: 3 }) {
          Text(entry.title || (entry.startedAtMs !== undefined ? xopcFormatCaptureTime(entry.startedAtMs) : entry.kind))
            .fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          if (entry.startedAtMs !== undefined) {
            Text(xopcFormatCaptureTime(entry.startedAtMs) + (entry.endedAtMs !== undefined ? '–' + xopcFormatCaptureTime(entry.endedAtMs) : ''))
              .fontSize(12).fontFamily('monospace').fontColor(this.colors.tertiary)
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        if (entry.playback.length) {
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.play_fill')).fontSize(14).fontColor([this.colors.accent])
          }.width(36).height(36).padding(0).backgroundColor(this.colors.accentSoft)
            .accessibilityText($r('app.string.discussion_play_context')).clickEffect(xopcClickEffect())
            .onClick((): void => { void this.model.play(entry.playback[0]); })
        }
      }.width('100%').alignItems(VerticalAlign.Center)
      if (entry.text) {
        Text(entry.text).fontSize(14).lineHeight(22).fontColor(this.colors.secondary).width('100%')
      }
      if (entry.kind === 'chapter' && ((entry.highlightCount ?? 0) > 0 || (entry.actionCount ?? 0) > 0)) {
        Text($r('app.string.discussion_chapter_counts', entry.highlightCount ?? 0, entry.actionCount ?? 0))
          .fontSize(12).fontColor(this.colors.tertiary)
      }
      if (entry.stale) {
        Text($r('app.string.discussion_source_changed')).fontSize(12).fontColor(this.colors.warningForeground)
      }
    }.width('100%').padding(14).borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
      .alignItems(HorizontalAlign.Start).clickEffect(xopcClickEffect())
      .onClick((): void => { this.model.openReviewEntry(entry); })
  }

  @Builder
  reviewContent() {
    Column({ space: 10 }) {
      if (this.model.review) {
        if (this.model.reviewQuery.trim()) {
          Row({ space: 8 }) {
            Text($r('app.string.discussion_search_count', this.model.review.total))
              .fontSize(13).fontColor(this.colors.secondary).layoutWeight(1)
            this.subtlePillAction($r('app.string.discussion_refresh_search'), $r('sys.symbol.arrow_clockwise'), 'neutral',
              (): void => { void this.model.refreshReview(); }, !this.model.reviewLoading)
          }.width('100%').alignItems(VerticalAlign.Center)
          ForEach(this.model.review.hits, (hit: XopcReviewEntry) => { this.reviewRow(hit) }, (hit: XopcReviewEntry): string => hit.id)
        } else if (this.model.tab === 'summary') {
          if (this.model.review.chapters.length) {
            Column({ space: 10 }) {
              Button({ type: ButtonType.Normal }) {
                Row({ space: 8 }) {
                  SymbolGlyph($r('sys.symbol.list_bullet')).fontSize(15).fontColor([this.colors.secondary])
                  Text($r('app.string.discussion_chapters')).fontSize(15).fontWeight(FontWeight.Medium)
                    .fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.Start)
                  Text(this.model.review.chapters.length.toString()).fontSize(12).fontColor(this.colors.tertiary)
                  SymbolGlyph(this.chaptersOpen ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
                    .fontSize(12).fontColor([this.colors.secondary])
                }.width('100%')
              }.width('100%').height(46).padding({ left: 14, right: 14 })
                .borderRadius(this.colors.corner(14)).backgroundColor(this.colors.panel).clickEffect(xopcClickEffect())
                .onClick((): void => { this.chaptersOpen = !this.chaptersOpen; })
              if (this.chaptersOpen) {
                ForEach(this.model.review.chapters, (chapter: XopcReviewEntry) => { this.reviewRow(chapter) },
                  (chapter: XopcReviewEntry): string => chapter.id)
              }
            }.width('100%')
          }
          if (this.model.review.hits.length) {
            ForEach(this.model.review.hits, (partial: XopcReviewEntry) => { this.reviewRow(partial) },
              (partial: XopcReviewEntry): string => partial.id)
          }
        }
        if (this.model.review.hasMore && !this.model.reviewError && (this.model.reviewQuery.trim() || this.model.tab === 'summary')) {
          XopcPaginationFooter({ loadingPage: this.model.reviewLoading,
            onLoad: (): void => { void this.model.refreshReview(true); } })
        }
      }
      if (this.model.reviewError) {
        Row({ space: 8 }) {
          Text(this.model.reviewError).fontSize(12).fontColor(this.colors.danger).layoutWeight(1)
          this.subtlePillAction($r('app.string.retry'), $r('sys.symbol.arrow_clockwise'), 'accent',
            (): void => { void this.model.refreshReview(); })
        }.width('100%').padding(12).borderRadius(this.colors.corner(12)).backgroundColor(this.colors.panel)
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  annotationKindPill(kind: string, label: Resource) {
    Button({ type: ButtonType.Normal }) {
      Text(label).fontSize(13).fontWeight(this.annotationKind === kind ? FontWeight.Medium : FontWeight.Normal)
        .fontColor(this.annotationKind === kind ? this.colors.accent : this.colors.secondary).maxLines(1)
    }.layoutWeight(1).height(36).borderRadius(18)
      .backgroundColor(this.annotationKind === kind ? this.colors.accentSoft : this.colors.input)
      .clickEffect(xopcClickEffect())
      .onClick((): void => { this.annotationKind = kind; })
  }

  @Builder
  annotationCard(annotation: XopcDiscussionAnnotation) {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text(annotation.kind === 'question' ? $r('app.string.discussion_mark_question')
          : annotation.kind === 'note' ? $r('app.string.discussion_mark_context') : $r('app.string.capture_marker'))
          .fontSize(12).fontWeight(FontWeight.Medium).fontColor(this.annotationBadgeTint(annotation.kind))
          .padding({ left: 9, right: 9, top: 4, bottom: 4 }).borderRadius(999)
          .backgroundColor(this.annotationBadgeFill(annotation.kind))
        Text(new Date(annotation.anchor.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
          .fontSize(12).fontFamily('monospace').fontColor(this.colors.tertiary)
        if (this.model.annotationPending(annotation.id)) {
          Text($r('app.string.discussion_mark_pending')).fontSize(11).fontColor(this.colors.warningForeground)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        } else {
          Blank().layoutWeight(1)
        }
        if (this.model.annotationRanges(annotation.id).length) {
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.play_fill')).fontSize(13).fontColor([this.colors.accent])
          }.width(34).height(34).padding(0).backgroundColor(this.colors.accentSoft)
            .accessibilityText($r('app.string.discussion_play_source')).clickEffect(xopcClickEffect())
            .onClick((): void => { void this.model.play(this.model.annotationRanges(annotation.id)[0]); })
        }
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.pencil_line')).fontSize(14).fontColor([this.colors.secondary])
        }.width(34).height(34).padding(0).backgroundColor(this.colors.input)
          .accessibilityText($r('app.string.discussion_mark_edit')).clickEffect(xopcClickEffect())
          .onClick((): void => {
            this.editingAnnotation = annotation;
            this.annotationText = annotation.text;
            this.annotationKind = annotation.kind;
          })
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.trash')).fontSize(14).fontColor([this.colors.danger])
        }.width(34).height(34).padding(0).backgroundColor(this.colors.dangerSoft)
          .accessibilityText($r('app.string.delete')).clickEffect(xopcClickEffect())
          .onClick((): void => { void this.model.removeAnnotation(annotation); })
      }.width('100%').alignItems(VerticalAlign.Center)
      if (annotation.text) {
        Text(annotation.text).fontSize(15).lineHeight(23).fontColor(this.colors.foreground).width('100%')
      }
      Row({ space: 8 }) {
        this.subtlePillAction($r('app.string.discussion_source'), $r('sys.symbol.doc_plaintext'), 'neutral',
          (): void => { void this.model.locateAnnotation(annotation.id); })
        if (this.model.annotationConflict(annotation.id)) {
          this.subtlePillAction($r('app.string.discussion_use_server'), $r('sys.symbol.arrow_clockwise'), 'accent',
            (): void => { void this.model.useServerAnnotation(annotation.id); })
        }
      }.width('100%')
    }.width('100%').padding(14).borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
      .alignItems(HorizontalAlign.Start)
  }

  build() {
    Column({ space: 14 }) {
      if (this.model.loading && !this.model.detail) {
        Row({ space: 9 }) {
          LoadingProgress().width(18).height(18).color(this.colors.accent)
          Text($r('app.string.discussion_loading')).fontSize(14).fontColor(this.colors.secondary)
        }.width('100%').padding({ top: 4, bottom: 4 })
      } else if (this.model.detail) {
        if (this.showOutcomeBanner()) {
          RecordingOutcomeCard({ input: this.model.outcome(), noteContext: true, busy: this.model.retrying,
            onRetry: (mode: string): void => { void this.model.retryOutcome(mode); } })
        }
        if (this.model.resumePositionMs > 0 && !this.model.detail.discussion.audioDeletedAt) {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 8 }) {
              SymbolGlyph($r('sys.symbol.play_fill')).fontSize(13).fontColor([this.colors.accent])
              Text($r('app.string.discussion_resume_position', xopcFormatCaptureTime(this.model.resumePositionMs)))
                .fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
            }
          }.height(36).padding({ left: 12, right: 14 }).borderRadius(18).backgroundColor(this.colors.accentSoft)
            .clickEffect(xopcClickEffect()).onClick((): void => { void this.model.resumePlayback(); })
        }
        Column({ space: 10 }) {
          Row({ space: 8 }) {
            XopcSegmentedTabs({ options: [
              { key: 'summary', label: $r('app.string.note_ui_overview'), testId: 'discussion-tab-summary' },
              { key: 'transcript', label: $r('app.string.note_ui_transcript'), testId: 'discussion-tab-transcript' },
              { key: 'marks', label: $r('app.string.note_ui_marks'), testId: 'discussion-tab-marks' }
            ], selectedKey: this.model.tab, swipeToSelect: true,
              onSelect: (key: string): void => { this.model.tab = key; if (key === 'marks') void this.model.refreshAnnotations(); } })
              .layoutWeight(1)
            XopcPageSearchButton({ searchId: 'discussion-search-toggle', open: this.searchOpen,
              label: $r('app.string.discussion_search_note'), onToggle: (): void => {
                this.searchOpen = !this.searchOpen;
                if (!this.searchOpen) {
                  this.getUIContext().getFocusController().clearFocus();
                  this.model.setReviewQuery('');
                }
              } })
            Button({ type: ButtonType.Circle }) {
              SymbolGlyph(xopcMoreIcon()).fontSize(18).fontColor([this.colors.secondary])
            }.id('discussion-note-tools').width(44).height(44).padding(0)
              .backgroundColor(this.colors.light ? this.colors.panel : Color.Transparent)
              .clickEffect(xopcClickEffect())
              .accessibilityText($r('app.string.note_ui_tools'))
              .onClick((): void => { this.toolsMode = true; this.evidenceOpen = true; })
          }.width('100%').alignItems(VerticalAlign.Center)
          if (this.searchOpen) {
            XopcPageSearchField({ searchId: 'discussion-search', text: this.model.reviewQuery,
              placeholder: $r('app.string.discussion_search_note'),
              onChange: (text: string): void => { this.model.setReviewQuery(text.slice(0, 200)); },
              onSubmit: (): void => { this.getUIContext().getFocusController().clearFocus(); } })
          }
        }.width('100%')

        if (this.model.reviewQuery.trim()) this.reviewContent()

        if (!this.model.reviewQuery.trim() && this.model.tab === 'summary' && this.model.detail.organization?.organization) {
          Column({ space: 18 }) {
            Column({ space: 10 }) {
              Row({ space: 8 }) {
                Text($r('app.string.discussion_summary')).fontSize(15).fontWeight(FontWeight.Bold)
                  .fontColor(this.colors.foreground).layoutWeight(1)
                if (this.model.detail.organization.organization.summaryEvidenceSegmentIds?.length) {
                  this.subtlePillAction($r('app.string.discussion_source'), $r('sys.symbol.doc_plaintext'), 'accent', (): void => {
                    void this.model.cite(this.model.detail?.organization?.organization?.summaryEvidenceSegmentIds?.slice(0, 100) ?? []);
                  })
                }
              }.width('100%').alignItems(VerticalAlign.Center)
              Text(this.model.detail.organization.organization.summary).fontSize(15).lineHeight(24)
                .fontColor(this.colors.foreground).width('100%')
            }.width('100%').alignItems(HorizontalAlign.Start)

            if (this.model.detail.organization.organization.keyPointEvidence?.length) {
              this.factSection($r('app.string.discussion_key_points'), this.model.detail.organization.organization.keyPointEvidence ?? [])
            } else if (this.model.detail.organization.organization.keyPoints.length) {
              Column({ space: 8 }) {
                Text($r('app.string.discussion_key_points')).fontSize(13).fontWeight(FontWeight.Medium)
                  .fontColor(this.colors.secondary).width('100%')
                ForEach(this.model.detail.organization.organization.keyPoints, (point: string) => {
                  Row({ space: 8 }) {
                    Text('•').fontSize(15).lineHeight(23).fontColor(this.colors.tertiary)
                    Text(point).fontSize(15).lineHeight(23).fontColor(this.colors.foreground).layoutWeight(1)
                  }.width('100%').alignItems(VerticalAlign.Top)
                }, (point: string): string => point)
              }.width('100%').alignItems(HorizontalAlign.Start)
            }
            this.factSection($r('app.string.discussion_decisions'), this.model.detail.organization.organization.decisions)
            this.factSection($r('app.string.discussion_risks'), this.model.detail.organization.organization.risks)
            this.factSection($r('app.string.discussion_questions'), this.model.detail.organization.organization.openQuestions)
            if (this.model.detail.organization.organization.actionItems.some((item: XopcDiscussionActionItem): boolean => !item.ignored)) {
              Column({ space: 10 }) {
                Text($r('app.string.discussion_actions')).fontSize(13).fontWeight(FontWeight.Medium)
                  .fontColor(this.colors.secondary).width('100%')
                ForEach(this.model.detail.organization.organization.actionItems.filter((item: XopcDiscussionActionItem): boolean => !item.ignored),
                  (item: XopcDiscussionActionItem) => {
                    Row({ space: 8 }) {
                      Text('•').fontSize(15).lineHeight(23).fontColor(this.colors.accent)
                      Column({ space: 6 }) {
                        Text(item.title).fontSize(15).lineHeight(23).fontColor(this.colors.foreground).width('100%')
                        if (item.evidenceSegmentIds?.length) {
                          Button({ type: ButtonType.Normal }) {
                            Row({ space: 4 }) {
                              SymbolGlyph($r('sys.symbol.doc_plaintext')).fontSize(12).fontColor([this.colors.accent])
                              Text($r('app.string.discussion_source')).fontSize(12).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
                            }
                          }.height(28).padding({ left: 8, right: 10 }).borderRadius(14).backgroundColor(this.colors.accentSoft)
                            .clickEffect(xopcClickEffect())
                            .onClick((): void => { void this.model.cite(item.evidenceSegmentIds ?? [], item.evidenceRevision); })
                        }
                      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                    }.width('100%').alignItems(VerticalAlign.Top)
                  }, (item: XopcDiscussionActionItem): string => item.id)
              }.width('100%').alignItems(HorizontalAlign.Start)
            }
          }.width('100%').padding(18).borderRadius(this.colors.corner(18)).backgroundColor(this.colors.panel)
            .alignItems(HorizontalAlign.Start)
        }
        if (!this.model.reviewQuery.trim() && this.model.tab === 'summary' && !this.model.detail.organization?.organization && this.model.detail.transcript.text) {
          Column({ space: 10 }) {
            Text($r('app.string.note_ui_excerpt')).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary)
            Text(this.model.detail.transcript.text.slice(0, 400)).fontSize(15).lineHeight(24).fontColor(this.colors.foreground).width('100%')
            this.subtlePillAction($r('app.string.note_ui_read_transcript'), $r('sys.symbol.doc_text'), 'accent',
              (): void => { this.model.tab = 'transcript'; })
          }.width('100%').padding(16).borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
            .alignItems(HorizontalAlign.Start)
        }
        if (!this.model.reviewQuery.trim() && this.model.tab === 'transcript' && (this.model.detail.transcript.segments.length || this.model.detail.transcript.text)) {
          Column({ space: 10 }) {
            if (this.model.selectedSegment >= 0) {
              this.subtlePillAction($r('app.string.discussion_show_all_transcript'), $r('sys.symbol.list_bullet'), 'accent',
                (): void => { this.model.selectedSegment = -1; })
            }
            if (this.model.detail.transcript.segments.length) {
              ForEach(this.model.transcriptRows().slice(0, this.visibleSegments),
                (segment: XopcDiscussionTranscriptSegment) => { this.transcriptRow(segment) },
                (segment: XopcDiscussionTranscriptSegment): string => segment.sequence.toString())
              if (this.model.transcriptRows().length > this.visibleSegments) {
                XopcPaginationFooter({ onLoad: (): void => { this.visibleSegments += 20; } })
              }
            } else {
              Column() {
                Text(this.model.detail.transcript.text).fontSize(15).lineHeight(24)
                  .fontColor(this.colors.foreground).width('100%')
              }.width('100%').padding(16).borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
            }
          }.width('100%').alignItems(HorizontalAlign.Start)
        } else if (!this.model.reviewQuery.trim() && this.model.tab === 'transcript' && !discussionStillProcessing(this.model.detail)) {
          XopcEmptyHint({ message: $r('app.string.discussion_no_speech') })
        }
      }

      if (this.model.detail && !this.model.reviewQuery.trim() && this.model.tab === 'marks') {
        Column({ space: 10 }) {
          if (this.editingAnnotation) {
            Column({ space: 12 }) {
              Row({ space: 8 }) {
                this.annotationKindPill('highlight', $r('app.string.capture_marker'))
                this.annotationKindPill('question', $r('app.string.discussion_mark_question'))
                this.annotationKindPill('note', $r('app.string.discussion_mark_context'))
              }.width('100%')
              TextArea({ text: this.annotationText, placeholder: $r('app.string.discussion_mark_context') })
                .maxLength(4000).height(104).backgroundColor(this.colors.input)
                .borderRadius(this.colors.corner(12)).fontColor(this.colors.foreground)
                .onChange((text: string): void => { this.annotationText = text; })
              Row({ space: 8 }) {
                Button($r('app.string.cancel'), { type: ButtonType.Normal })
                  .layoutWeight(1).height(42).fontSize(14).fontWeight(FontWeight.Medium)
                  .fontColor(this.colors.foreground).backgroundColor(this.colors.input)
                  .borderRadius(this.colors.corner(12)).clickEffect(xopcClickEffect())
                  .onClick((): void => { this.editingAnnotation = undefined; })
                Button($r('app.string.save'), { type: ButtonType.Normal })
                  .layoutWeight(1).height(42).fontSize(14).fontWeight(FontWeight.Medium)
                  .fontColor(this.colors.onAccent).backgroundColor(this.colors.accent)
                  .borderRadius(this.colors.corner(12)).clickEffect(xopcClickEffect())
                  .onClick((): void => { void this.saveAnnotationEdit(); })
              }.width('100%')
            }.width('100%').padding(14).borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
          }
          if (this.model.visibleAnnotations().length) {
            ForEach(this.model.visibleAnnotations(), (annotation: XopcDiscussionAnnotation) => {
              this.annotationCard(annotation)
            }, (annotation: XopcDiscussionAnnotation): string => annotation.id)
          } else {
            XopcEmptyHint({ message: $r('app.string.note_recording_no_marks') })
          }
          if (this.model.annotationError) {
            Row({ space: 8 }) {
              Text(userErrorMessage(this.model.annotationError, 'save')).fontSize(12).fontColor(this.colors.danger).layoutWeight(1)
              this.subtlePillAction($r('app.string.retry'), $r('sys.symbol.arrow_clockwise'), 'accent',
                (): void => { void this.model.refreshAnnotations(); })
            }.width('100%').padding(12).borderRadius(this.colors.corner(12)).backgroundColor(this.colors.panel)
          }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }

      if (!this.model.reviewQuery.trim() && this.model.tab === 'summary') this.reviewContent()
      if (this.model.annotationError && this.model.tab !== 'marks') {
        Text(userErrorMessage(this.model.annotationError, 'save')).fontSize(13).fontColor(this.colors.danger)
      }
      if (this.model.error) {
        Row({ space: 8 }) {
          Text(userErrorMessage(this.model.error, 'save')).fontSize(13).fontColor(this.colors.danger).layoutWeight(1)
          this.subtlePillAction($r('app.string.retry'), $r('sys.symbol.arrow_clockwise'), 'accent',
            (): void => { void this.model.refresh(); })
        }.width('100%').padding(12).borderRadius(this.colors.corner(12)).backgroundColor(this.colors.panel)
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
      .bindSheet($$this.evidenceOpen, this.evidenceSheet, xopcSheetOptions('medium', {
        showClose: false,
        onDisappear: (): void => { this.model.evidence = undefined; },
      }))
  }
}
