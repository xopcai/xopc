import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('HarmonyOS voice note surface', () => {
  it('keeps recording one tap away in the Notes tab and exposes the active mini bar globally', () => {
    const home = source('../entry/src/main/ets/view/HomeView.ets');
    expect(home).toContain("this.tabItem(3, $r('app.string.notes')");
    expect(home).toContain(".id('note-capture-start')");
    expect(home).toContain("if (this.capture.active) { this.noteCaptureBar() }");
    expect(home).toContain('await this.capture.start(context)');
  });

  it('renders live transcript, pause, marker, finish and retry states', () => {
    const notes = source('../entry/src/main/ets/view/NotesTabView.ets');
    expect(notes).toContain(".id('notes-live-capture')");
    expect(notes).toContain('this.capture.visibleTranscript');
    expect(notes).toContain('.textAlign(TextAlign.Center)');
    expect(notes).toContain('this.capture.togglePause()');
    expect(notes).toContain('this.capture.mark()');
    expect(notes).toContain('void this.finishCapture()');
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
