import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('HarmonyOS voice note surface', () => {
  it('keeps the composer on Notes alongside creation actions and recording status', () => {
    const home = source('../entry/src/main/ets/view/HomeView.ets');
    const notes = source('../entry/src/main/ets/view/NotesTabView.ets');
    expect(home).toContain("this.tabItem(3, $r('app.string.notes')");
    expect(home).not.toContain(".id('note-capture-start')");
    expect(home).not.toContain('if (this.tab !== 3) {');
    expect(home).toContain('this.quickComposer()');
    expect(home).toContain('XopcDiscussionRecordingPanelView({ panel: this.recordingPanel');
    expect(home).not.toContain('this.noteCaptureBar()');
    expect(home).toContain('onStartVoice: (): void => { void this.startNoteCapture(); }');
    expect(home).toContain('await this.capture.start(context)');
    expect(notes).toContain(".id('notes-create-text')");
    expect(notes).toContain(".id('notes-create-voice')");
    expect(notes).toContain('this.creationSheetOpen = true');
    expect(notes).toContain('onDisappear: (): void => { this.finishCreationSheet(); }');
  });

  it('renders live transcript, pause, marker, finish and retry states', () => {
    const panel = source('../entry/src/main/ets/view/DiscussionRecordingPanel.ets');
    expect(panel).toContain(".id('discussion-recording-float')");
    expect(panel).toContain('this.capture.visibleTranscript');
    expect(panel).toContain('this.panel.pause(this.capture)');
    expect(panel).toContain('this.panel.mark(this.capture)');
    expect(panel).toContain('void this.finishRecording()');
    expect(panel).toContain('.onActionCancel((): void => { this.panel.dragCancel(); })');
    expect(panel).toContain('this.positionChoices()');
    const notes = source('../entry/src/main/ets/view/NotesTabView.ets');
    expect(notes).not.toContain('this.capturePane()');
  });

  it('uses realtime dictation with durable chunked transcription as fallback', () => {
    const capture = source('../entry/src/main/ets/service/discussionCapture.ets');
    const realtime = source('../entry/src/main/ets/service/discussionLiveTranscription.ets');
    expect(capture).toContain('this.live?.audio(copy)');
    expect(capture).toContain('!this.realtimeActive');
    expect(realtime).toContain("purpose: 'dictation'");
    expect(realtime).toContain("event.type !== 'input.transcript.delta'");
    expect(realtime).toContain("transport?.send('input.commit', {})");
  });

  it('uses the durable discussion capture protocol for live and full recording chunks', () => {
    const repository = source('../entry/src/main/ets/repository/discussionCaptureRepository.ets');
    expect(repository).toContain("'/recording/chunks/' + sequence");
    expect(repository).toContain("'/segments/' + sequence");
    expect(repository).toContain("'/capture/seal'");
    expect(repository).toContain("'x-audio-sha256': sha256");
  });
});
