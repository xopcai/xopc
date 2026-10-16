import { userErrorMessage } from '../common/userError';
import { RecordingOutcomeCard } from './RecordingOutcomeCard';
import { XopcReviewEntry } from '../model/discussionCapture';
import { common } from '@kit.AbilityKit';
import { XopcDiscussionAnnotation, XopcEvidenceSegment, XopcPlaybackRange, XopcResolvedAnnotation } from '../model/discussionCapture';
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
  @Local editingAnnotation?: XopcDiscussionAnnotation;
  @Local annotationText: string = '';
  @Local annotationKind: string = 'highlight';
  @Local toolsMode: boolean = false;
  @Local searchOpen: boolean = false;
  @Local coverageOpen: boolean = false;
  @Local chaptersOpen: boolean = false;
  @Local transcriptExpanded: boolean = true;
  @Local visibleSegments: number = 20;

  aboutToAppear(): void { this.model.setContext(this.getUIContext().getHostContext() as common.Context); this.model.start(this.noteId, (): void => { this.onNoteUpdated(); }); }
  aboutToDisappear(): void { this.model.stop(); }

  @Monitor('noteId')
  onNoteIdChanged(): void {
    this.editingAnnotation = undefined; this.annotationText = ''; this.evidenceOpen = false; this.toolsMode = false; this.searchOpen = false; this.coverageOpen = false; this.chaptersOpen = false;
    this.transcriptExpanded = true;
    this.visibleSegments = 20;
    this.model.start(this.noteId, (): void => { this.onNoteUpdated(); });
  }

  private async saveAnnotationEdit(): Promise<void> {
    const current = this.editingAnnotation; if (!current) return;
    const remote = this.model.annotations.find((row: XopcResolvedAnnotation): boolean => row.annotation.id === current.id);
    const annotation: XopcDiscussionAnnotation = { id: current.id,kind: this.annotationKind,text: this.annotationText,anchor: current.anchor,
      revision: remote?.annotation.revision ?? current.revision,deleted: current.deleted,createdAt: current.createdAt,updatedAt: Date.now() };
    if (await this.model.saveAnnotation(annotation)) this.editingAnnotation = undefined;
  }

  @Builder
  factSection(label: ResourceStr, items: XopcDiscussionFact[]) {
    if (items.some((item: XopcDiscussionFact): boolean => !item.ignored)) {
      Column({ space: 9 }) {
        Text(label).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
        ForEach(items.filter((item: XopcDiscussionFact): boolean => !item.ignored), (item: XopcDiscussionFact) => {
          Text('• ' + item.text).fontSize(15).lineHeight(23).fontColor(this.colors.foreground).width('100%')
          if (item.evidenceSegmentIds?.length) {
            Button($r('app.string.discussion_source')).onClick((): void => { void this.model.cite(item.evidenceSegmentIds ?? [],item.evidenceRevision); })
          }
        }, (item: XopcDiscussionFact): string => item.id)
      }.width('100%').alignItems(HorizontalAlign.Start)
    }
  }

  @Builder
  transcriptRow(segment: XopcDiscussionTranscriptSegment) {
    Column({ space: 5 }) {
      Row({ space: 8 }) {
        Button(xopcFormatCaptureTime(segment.startedAtMs)).fontSize(12).fontColor(this.colors.accent)
          .onClick((): void => { void this.model.cite([segment.sequence],this.model.detail?.transcript.revision,true); })
        Button($r('app.string.capture_marker')).onClick((): void => { void this.model.markSegment(segment); })
        if (segment.speakerLabel) Text(segment.speakerLabel).fontSize(12).fontColor(this.colors.secondary)
      }.width('100%')
      Text(segment.displayText ?? segment.rawText ?? $r('app.string.discussion_transcript_pending'))
        .fontSize(15).lineHeight(23).fontColor(this.colors.foreground).width('100%')
    }.width('100%').padding(12).borderRadius(12).backgroundColor(this.colors.input)
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
    Scroll() {
    if (this.toolsMode) { this.noteTools() }
    else if (this.model.evidence) {
        Column({ space: 12 }) {
          Text($r('app.string.discussion_source')).fontSize(17).fontColor(this.colors.foreground)
          Text('v' + this.model.evidence.transcriptRevision).fontSize(17).fontColor(this.colors.foreground)
          if (this.model.previewEntry?.provisional) Text($r('app.string.discussion_partial_content')).fontSize(12).fontColor(this.colors.secondary)
          Text($r('app.string.discussion_segment_timing')).fontSize(12).fontColor(this.colors.secondary)
          if (this.model.evidence.stale) Text($r('app.string.discussion_source_changed')).fontSize(12).fontColor(this.colors.secondary)
          if (!this.model.evidence.audioAvailable || !this.model.evidence.timingVerified) Text($r('app.string.discussion_audio_unavailable')).fontSize(12).fontColor(this.colors.secondary)
          ForEach(this.model.evidence.segments, (segment: XopcEvidenceSegment) => {
            Text(xopcFormatCaptureTime(segment.startedAtMs) + '–' + xopcFormatCaptureTime(segment.endedAtMs)).fontSize(12).fontColor(this.colors.accent)
            Text(segment.text).fontSize(15).lineHeight(24).fontColor(this.colors.foreground)
            if (!this.model.evidence?.stale && (!this.model.previewEntry?.provisional || this.model.previewEntry.kind === 'chapter')) Button($r('app.string.discussion_locate_transcript')).onClick((): void => { this.model.locateReviewSegment(segment.sequence); })
            ForEach(segment.playback, (range: XopcPlaybackRange) => {
              Button($r('app.string.discussion_play_source')).onClick((): void => { void this.model.play(range); })
            }, (range: XopcPlaybackRange): string => range.startedAtMs.toString())
          }, (segment: XopcEvidenceSegment): string => segment.sequence.toString())
          Button($r('app.string.close')).onClick((): void => { this.model.evidence = undefined; })
        }.width('100%').padding(16).borderRadius(12).backgroundColor(this.colors.input).alignItems(HorizontalAlign.Start)
      }
    }.width('100%').height('100%')
  }

  @Builder
  noteTools() {
    Column({ space: 12 }) {
      Text($r('app.string.note_ui_tools')).fontSize(20).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
      Button($r('app.string.note_ui_organize')).width('100%').height(48).fontSize(15).enabled(!this.model.retrying && !!this.model.detail?.discussion.canonicalTranscript && (this.model.detail?.discussion.status === 'completed' || this.model.detail?.discussion.status === 'needs_attention'))
        .onClick((): void => { void this.model.retryOutcome('analyze'); this.evidenceOpen = false; })
      if (this.model.detail?.discussion.audioAttachmentId && !this.model.detail.discussion.audioDeletedAt && (this.model.detail.discussion.status === 'completed' || this.model.detail.discussion.status === 'needs_attention')) Button($r('app.string.discussion_regenerate_audio')).width('100%').height(48).fontSize(15).enabled(!this.model.retrying)
        .onClick((): void => { void this.model.retry(true); this.evidenceOpen = false; })
      Text($r('app.string.discussion_regenerate_retained')).fontSize(13).lineHeight(21).fontColor(this.colors.secondary).width('100%')
    }.width('100%').padding(20).alignItems(HorizontalAlign.Start)
  }
  @Builder
  contentTab(tabKey: string,label: Resource) {
    Button(label).layoutWeight(1).height(44).fontSize(14).fontColor(this.model.tab === tabKey ? this.colors.foreground : this.colors.secondary)
      .backgroundColor(this.model.tab === tabKey ? this.colors.panel : Color.Transparent).borderRadius(10)
      .onClick((): void => { this.model.tab = tabKey; if (tabKey === 'marks') void this.model.refreshAnnotations(); })
  }
  @Builder
  reviewRow(entry: XopcReviewEntry) {
    Column({ space: 7 }) {
      Button(entry.title || (entry.startedAtMs !== undefined ? xopcFormatCaptureTime(entry.startedAtMs) : entry.kind))
        .fontSize(14).fontColor(this.colors.accent).onClick((): void => { this.model.openReviewEntry(entry); })
      Text(entry.text).fontSize(14).lineHeight(22).fontColor(this.colors.foreground).width('100%')
      if (entry.startedAtMs !== undefined) Text(xopcFormatCaptureTime(entry.startedAtMs) + (entry.endedAtMs !== undefined ? '–' + xopcFormatCaptureTime(entry.endedAtMs) : '')).fontSize(12).fontColor(this.colors.secondary)
      if (entry.provisional) Text($r('app.string.discussion_partial_content')).fontSize(12).fontColor(this.colors.secondary)
      if (entry.stale) Text($r('app.string.discussion_source_changed')).fontSize(12).fontColor(this.colors.secondary)
      if (entry.kind === 'chapter') Text($r('app.string.discussion_chapter_counts',entry.highlightCount ?? 0,entry.actionCount ?? 0)).fontSize(12).fontColor(this.colors.secondary)
      ForEach(entry.playback.slice(0,3),(range: XopcPlaybackRange) => {
        Button($r('app.string.discussion_play_context')).onClick((): void => { void this.model.play(range); })
      },(range: XopcPlaybackRange): string => range.startedAtMs.toString())
      Button($r('app.string.discussion_locate_transcript')).onClick((): void => { this.model.openReviewEntry(entry); })
    }.width('100%').padding(12).borderRadius(12).backgroundColor(this.colors.input).alignItems(HorizontalAlign.Start)
  }

  @Builder
  reviewContent() {
    Column({ space: 12 }) {
        if (this.model.review) {
          Button($r('app.string.note_ui_coverage')).height(44).fontSize(13).fontColor(this.colors.secondary).backgroundColor(Color.Transparent)
            .onClick((): void => { this.coverageOpen = !this.coverageOpen; })
          if (this.coverageOpen) {
          Text(this.model.review.coverage.audioAvailable ? $r('app.string.discussion_audio_saved_review') : $r('app.string.discussion_audio_unavailable')).fontSize(12).fontColor(this.colors.secondary)
          Text($r('app.string.discussion_processed_coverage',xopcFormatCaptureTime(this.model.review.coverage.processedMs),xopcFormatCaptureTime(this.model.review.coverage.durationMs),xopcFormatCaptureTime(this.model.review.coverage.continuousThroughMs))).fontSize(12).fontColor(this.colors.secondary)
          Text(this.model.review.coverage.complete ? $r('app.string.discussion_run_complete') : $r('app.string.discussion_partial_content')).fontSize(12).fontColor(this.colors.secondary)
          Text($r('app.string.discussion_analysis_coverage')).fontSize(12).fontColor(this.colors.secondary)
          ForEach(this.model.review.coverage.analysisRanges,(range: XopcPlaybackRange) => {
            Text(xopcFormatCaptureTime(range.startedAtMs) + '–' + xopcFormatCaptureTime(range.endedAtMs)).fontSize(12).fontColor(this.colors.secondary)
          },(range: XopcPlaybackRange): string => range.startedAtMs.toString())
          if (!this.model.review.coverage.analysisRanges.length) Text($r('app.string.discussion_chapters_pending')).fontSize(12).fontColor(this.colors.secondary)
          }
          if (this.model.reviewQuery.trim()) {
            Text($r('app.string.discussion_search_count',this.model.review.total)).fontSize(14).fontColor(this.colors.foreground)
            Button($r('app.string.discussion_refresh_search')).enabled(!this.model.reviewLoading).onClick((): void => { void this.model.refreshReview(); })
            ForEach(this.model.review.hits,(hit: XopcReviewEntry) => { this.reviewRow(hit) },(hit: XopcReviewEntry): string => hit.id)
          } else {
            if (this.model.tab === 'summary' && this.model.review.chapters.length) {
              Button($r('app.string.discussion_chapters')).height(44).fontSize(15).fontColor(this.colors.foreground).backgroundColor(this.colors.input).onClick((): void => { this.chaptersOpen = !this.chaptersOpen; })
              if (this.chaptersOpen) ForEach(this.model.review.chapters,(chapter: XopcReviewEntry) => { this.reviewRow(chapter) },(chapter: XopcReviewEntry): string => chapter.id)
            }
            ForEach(this.model.review.hits,(partial: XopcReviewEntry) => { this.reviewRow(partial) },(partial: XopcReviewEntry): string => partial.id)
          }
          if (this.model.review.hasMore) Button($r('app.string.load_more')).enabled(!this.model.reviewLoading).onClick((): void => { void this.model.refreshReview(true); })
        }
        if (this.model.reviewError) {
          Text(this.model.reviewError).fontSize(12).fontColor(this.colors.danger)
          Button($r('app.string.retry')).onClick((): void => { void this.model.refreshReview(); })
        }
    }.width('100%').alignItems(HorizontalAlign.Start)
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
          Button() { SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(19).fontColor([this.colors.secondary]) }.width(44).height(44).padding(0).backgroundColor(Color.Transparent).accessibilityText($r('app.string.discussion_search_note')).onClick((): void => { this.searchOpen = !this.searchOpen; })
          Button() { Row({ space: 3 }) { ForEach([0,1,2],(dot: number) => { Row() {}.width(3).height(3).borderRadius(2).backgroundColor(this.colors.secondary) },(dot: number): string => dot.toString()) } }.width(44).height(44).padding(0).backgroundColor(Color.Transparent).accessibilityText($r('app.string.note_ui_tools')).onClick((): void => { this.toolsMode = true; this.evidenceOpen = true; })
          if (this.model.detail.discussion.durationMs) {
            Text(xopcFormatCaptureTime(this.model.detail.discussion.durationMs as number))
              .fontSize(13).fontColor(this.colors.secondary)
          }
        }.width('100%')
        if (this.model.detail.discussion.status !== 'recording' || this.model.detail.recordingJob) {
          RecordingOutcomeCard({ input: this.model.outcome(),noteContext: true,busy: this.model.retrying,
            onRetry: (mode: string): void => { void this.model.retryOutcome(mode); } })
        }
        if (this.model.resumePositionMs > 0 && !this.model.detail.discussion.audioDeletedAt) Button($r('app.string.discussion_resume_position',xopcFormatCaptureTime(this.model.resumePositionMs))).onClick((): void => { void this.model.resumePlayback(); })
        Row({ space: 4 }) {
          this.contentTab('summary',$r('app.string.note_ui_overview'))
          this.contentTab('transcript',$r('app.string.note_ui_transcript'))
          this.contentTab('marks',$r('app.string.note_ui_marks'))
        }.width('100%').padding(4).borderRadius(14).backgroundColor(this.colors.input)
        if (this.searchOpen || this.model.reviewQuery.trim()) {
        TextInput({ text: this.model.reviewQuery,placeholder: $r('app.string.discussion_search_note') }).maxLength(200)
          .onChange((text: string): void => { this.model.setReviewQuery(text); })
          Button($r('app.string.note_ui_close_search')).height(44).onClick((): void => { this.model.setReviewQuery(''); this.searchOpen = false; })
        }
        if (this.model.reviewQuery.trim()) this.reviewContent()
        if (!this.model.reviewQuery.trim() && this.model.tab === 'summary' && this.model.detail.organization?.organization) {
          Column({ space: 15 }) {
            Text($r('app.string.discussion_summary')).fontSize(17).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.foreground).width('100%')
            Text(this.model.detail.organization.organization.summary).fontSize(16).lineHeight(25)
              .fontColor(this.colors.foreground).width('100%')
            if (this.model.detail.organization.organization.keyPointEvidence?.length) {
              this.factSection($r('app.string.discussion_key_points'),this.model.detail.organization.organization.keyPointEvidence ?? [])
            } else if (this.model.detail.organization.organization.keyPoints.length) {
              Column({ space: 8 }) {
                Text($r('app.string.discussion_key_points')).fontSize(16).fontWeight(FontWeight.Medium)
                  .fontColor(this.colors.foreground).width('100%')
                ForEach(this.model.detail.organization.organization.keyPoints, (point: string) => {
                  Text('• ' + point).fontSize(15).lineHeight(23).fontColor(this.colors.foreground).width('100%')
                }, (point: string): string => point)
              }.width('100%').alignItems(HorizontalAlign.Start)
            }
            if (this.model.detail.organization.organization.summaryEvidenceSegmentIds?.length) Button($r('app.string.discussion_source')).onClick((): void => { void this.model.cite(this.model.detail?.organization?.organization?.summaryEvidenceSegmentIds?.slice(0,100) ?? []); })
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
                    if (item.evidenceSegmentIds?.length) Button($r('app.string.discussion_source')).onClick((): void => { void this.model.cite(item.evidenceSegmentIds ?? [],item.evidenceRevision); })
                  }, (item: XopcDiscussionActionItem): string => item.id)
              }.width('100%').alignItems(HorizontalAlign.Start)
            }
          }.width('100%').padding(16).borderRadius(16).backgroundColor(this.colors.input)
            .alignItems(HorizontalAlign.Start)
        }
        if (!this.model.reviewQuery.trim() && this.model.tab === 'summary' && !this.model.detail.organization?.organization && this.model.detail.transcript.text) {
          Column({ space: 12 }) {
            Text($r('app.string.note_ui_excerpt')).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            Text(this.model.detail.transcript.text.slice(0,400)).fontSize(16).lineHeight(25).fontColor(this.colors.foreground).width('100%')
            Button($r('app.string.note_ui_read_transcript')).height(44).fontSize(14).fontColor(this.colors.accent).backgroundColor(Color.Transparent).onClick((): void => { this.model.tab = 'transcript'; })
          }.width('100%').alignItems(HorizontalAlign.Start)
        }
        if (!this.model.reviewQuery.trim() && this.model.tab === 'transcript' && (this.model.detail.transcript.segments.length || this.model.detail.transcript.text)) {
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
            if (this.model.selectedSegment >= 0) Button($r('app.string.discussion_show_all_transcript')).onClick((): void => { this.model.selectedSegment = -1; })
            if (this.transcriptExpanded) {
              if (this.model.detail.transcript.segments.length) {
                ForEach(this.model.transcriptRows().slice(0, this.visibleSegments),
                  (segment: XopcDiscussionTranscriptSegment) => { this.transcriptRow(segment) },
                  (segment: XopcDiscussionTranscriptSegment): string => segment.sequence.toString())
                if (this.model.transcriptRows().length > this.visibleSegments) {
                  Button($r('app.string.load_more')).fontSize(14).fontColor(this.colors.accent)
                    .backgroundColor(Color.Transparent).onClick((): void => { this.visibleSegments += 20; })
                }
              } else {
                Text(this.model.detail.transcript.text).fontSize(15).lineHeight(24)
                  .fontColor(this.colors.foreground).width('100%')
              }
            }
          }.width('100%').alignItems(HorizontalAlign.Start)
        } else if (!this.model.reviewQuery.trim() && this.model.tab === 'transcript' && !discussionStillProcessing(this.model.detail)) {
          Text($r('app.string.discussion_no_speech')).fontSize(14).lineHeight(21)
            .fontColor(this.colors.secondary).width('100%')
        }
      }
      if (!this.model.reviewQuery.trim() && this.model.tab === 'marks') {
        Column({ space: 12 }) {
          ForEach(this.model.visibleAnnotations(), (annotation: XopcDiscussionAnnotation) => {
            Column({ space: 6 }) {
              Text(annotation.kind === 'question' ? $r('app.string.discussion_mark_question') : annotation.kind === 'note' ? $r('app.string.discussion_mark_context') : $r('app.string.capture_marker')).fontSize(14).fontColor(this.colors.accent)
              Text(new Date(annotation.anchor.capturedAt).toLocaleString()).fontSize(12).fontColor(this.colors.secondary)
              if (annotation.text) Text(annotation.text).fontSize(15).fontColor(this.colors.foreground)
              if (this.model.annotationConflict(annotation.id)) Button($r('app.string.discussion_use_server')).onClick((): void => { void this.model.useServerAnnotation(annotation.id); })
              ForEach(this.model.annotationRanges(annotation.id),(range: XopcPlaybackRange) => {
                Button($r('app.string.discussion_play_source')).onClick((): void => { void this.model.play(range); })
              },(range: XopcPlaybackRange): string => range.startedAtMs.toString())
              Button($r('app.string.delete')).onClick((): void => { void this.model.removeAnnotation(annotation); })
              Text(this.model.annotationPending(annotation.id) ? $r('app.string.discussion_mark_pending') : $r('app.string.discussion_mark_synced')).fontSize(12).fontColor(this.colors.secondary)
              Row({ space: 8 }) {
                Button($r('app.string.discussion_source')).onClick((): void => { void this.model.locateAnnotation(annotation.id); })
                Button($r('app.string.discussion_mark_edit')).onClick((): void => { this.editingAnnotation = annotation; this.annotationText = annotation.text; this.annotationKind = annotation.kind; })
              }
            }.width('100%').padding(12).borderRadius(12).backgroundColor(this.colors.input).alignItems(HorizontalAlign.Start)
          }, (annotation: XopcDiscussionAnnotation): string => annotation.id)
          Text($r('app.string.discussion_mark_unavailable')).fontSize(12).fontColor(this.colors.secondary)
          if (this.model.annotationError) {
            Text(userErrorMessage(this.model.annotationError,'save')).fontSize(12).fontColor(this.colors.danger)
            Button($r('app.string.retry')).onClick((): void => { void this.model.refreshAnnotations(); })
          }
          if (this.editingAnnotation) {
            TextArea({ text: this.annotationText,placeholder: $r('app.string.discussion_mark_context') }).maxLength(4000).height(120)
              .onChange((text: string): void => { this.annotationText = text; })
            Row({ space: 8 }) {
              Button($r('app.string.capture_marker')).onClick((): void => { this.annotationKind = 'highlight'; })
              Button($r('app.string.discussion_mark_question')).onClick((): void => { this.annotationKind = 'question'; })
              Button($r('app.string.discussion_mark_context')).onClick((): void => { this.annotationKind = 'note'; })
            }
            Button($r('app.string.save')).onClick((): void => { void this.saveAnnotationEdit(); })
          }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }
      if (!this.model.reviewQuery.trim()) this.reviewContent()
      if (this.model.annotationError && this.model.tab !== 'marks') Text(userErrorMessage(this.model.annotationError,'save')).fontSize(13).fontColor(this.colors.danger)
      if (this.model.error) {
        Text(userErrorMessage(this.model.error,'save')).fontSize(13).fontColor(this.colors.danger).width('100%')
        Button($r('app.string.retry')).fontSize(13).fontColor(this.colors.accent)
          .backgroundColor(Color.Transparent).padding(0).height(32)
          .onClick((): void => { void this.model.refresh(); })
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
      .bindSheet($$this.evidenceOpen,this.evidenceSheet,{ height: '70%',dragBar: true,showClose: true,onDisappear: (): void => { this.model.evidence = undefined; } })
  }
}
