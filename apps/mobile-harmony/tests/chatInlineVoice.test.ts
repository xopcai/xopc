import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync(new URL('../entry/src/main/ets/view/ChatMessageContent.ets', import.meta.url), 'utf8');
const media = readFileSync(new URL('../entry/src/main/ets/view/ChatMediaView.ets', import.meta.url), 'utf8');

describe('inline user voice messages', () => {
  it('routes user audio through the compact voice bubble', () => {
    expect(content).toContain("if (this.row.role === 'user')");
    expect(content).toContain('inlineVoice: true');
  });

  it('plays inline without exposing attachment actions or opening the preview sheet', () => {
    const start = media.indexOf("if (this.inlineVoice && this.previewKind() === 'audio')");
    const end = media.indexOf('} else if (this.compact)', start);
    const voiceBubble = media.slice(start, end);

    expect(voiceBubble).toContain(".id('chat-inline-voice-' + this.file.id)");
    expect(voiceBubble).toContain("this.toggleInlineAudio()");
    expect(voiceBubble).toContain("sys.symbol.stop_circle_fill");
    expect(voiceBubble).toContain("sys.symbol.speaker_wave_2");
    expect(voiceBubble).toContain("sys.symbol.waveform");
    expect(voiceBubble).toContain("padding({ left: 10, right: 10 }).justifyContent(FlexAlign.Start)");
    expect(voiceBubble.indexOf("sys.symbol.speaker_wave_2")).toBeLessThan(voiceBubble.indexOf("sys.symbol.waveform"));
    expect(voiceBubble.indexOf("sys.symbol.waveform")).toBeLessThan(voiceBubble.indexOf("Math.max(1, Math.ceil(this.inlineAudioDuration()))"));
    expect(voiceBubble).not.toContain('this.file.name');
    expect(voiceBubble).not.toContain('chat_preview');
    expect(voiceBubble).not.toContain('download');
    expect(voiceBubble).not.toContain('this.expanded = true');
    expect(media).toContain('if (!this.inlineVoice && !this.compact && !this.noteInlineImage)');
  });
});
