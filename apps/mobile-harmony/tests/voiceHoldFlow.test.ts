import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { resolveVoiceRecordingDestination } from '../entry/src/main/ets/common/voiceRecordingGesture.ets';

// Execute the view's event handlers without mounting ArkUI's declarative builders.
const source = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const methods = source.slice(source.indexOf('  private voiceTouchPoint('), source.indexOf('  private voiceDuration('));
const compiled = ts.transpileModule(`class VoiceHandlers { ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const Handler = new Function('resolveVoiceRecordingDestination', 'TouchType', `${compiled}; return VoiceHandlers;`)(
  resolveVoiceRecordingDestination, { Down: 'down', Move: 'move', Up: 'up', Cancel: 'cancel' },
);

function setup() {
  const handler = new Handler();
  const voice = { state: 'recording', busy: false, error: '',
    start: vi.fn(), stop: vi.fn(async () => { voice.state = 'ready'; }),
    cancel: vi.fn(async () => { voice.state = 'idle'; }),
  };
  Object.assign(handler, {
    voice, voiceHeld: true, voiceFinishing: false, voiceDestination: 'send', voiceRetryDestination: 'send',
    voicePointerId: 1, voiceHoldGeneration: 0, voiceStartX: 200, voiceStartY: 500,
    visible: true, disposed: false, chat: { selectedId: 'chat', sending: false, runId: '' },
    reader: { stop: vi.fn(async () => {}) }, getUIContext: () => ({ getHostContext: () => ({}) }),
    sendVoice: vi.fn(async () => { voice.state = 'idle'; }),
    transcribe: vi.fn(async () => { voice.state = 'idle'; }),
  });
  return handler;
}

describe('voice hold release flow', () => {
  it.each(['send', 'text', 'cancel'])('releases directly to %s without a confirmation panel', async (destination) => {
    const handler = setup(); handler.voiceDestination = destination;
    await handler.finishVoiceHold();
    expect(handler.voice.stop).toHaveBeenCalledTimes(destination === 'cancel' ? 0 : 1);
    expect(handler.voice.cancel).toHaveBeenCalledTimes(destination === 'cancel' ? 1 : 0);
    expect(handler.sendVoice).toHaveBeenCalledTimes(destination === 'send' ? 1 : 0);
    expect(handler.transcribe).toHaveBeenCalledTimes(destination === 'text' ? 1 : 0);
    expect(handler.voiceHeld).toBe(false);
    expect(handler.voiceFinishing).toBe(false);
  });

  it('cancels instead of sending when the OS interrupts the touch or permission is pending', async () => {
    for (const preparing of [true, false]) {
      const handler = setup();
      if (preparing) handler.voice.state = 'preparing';
      await handler.finishVoiceHold(!preparing);
      expect(handler.voice.cancel).toHaveBeenCalledOnce();
      expect(handler.sendVoice).not.toHaveBeenCalled();
    }
  });

  it('ignores another finger lifting while the recording finger remains down', () => {
    const handler = setup();
    handler.handleVoiceTouch({ type: 'up', changedTouches: [{ id: 2, windowX: 10, windowY: 10 }] });
    expect(handler.voiceHeld).toBe(true);
    expect(handler.voice.stop).not.toHaveBeenCalled();
  });

  it('does not deliver twice on duplicate release events', async () => {
    const handler = setup();
    await Promise.all([handler.finishVoiceHold(), handler.finishVoiceHold()]);
    expect(handler.sendVoice).toHaveBeenCalledOnce();
  });

  it('keeps the chosen action for retry and discards unusably short recordings', async () => {
    const handler = setup(); handler.voiceDestination = 'text';
    handler.transcribe.mockImplementation(async () => {});
    await handler.finishVoiceHold();
    expect(handler.voiceRetryDestination).toBe('text');
    await handler.deliverVoiceRecording();
    expect(handler.transcribe).toHaveBeenCalledTimes(2);
    expect(handler.sendVoice).not.toHaveBeenCalled();
    handler.voice.error = 'RECORDING_TOO_SHORT';
    await handler.deliverVoiceRecording();
    expect(handler.voice.cancel).toHaveBeenCalledOnce();
  });

  it('does not start the microphone after the finger released while playback was stopping', async () => {
    const handler = setup(); handler.voiceHeld = false; handler.voice.state = 'idle';
    let stopped!: () => void;
    handler.reader.stop.mockImplementation(() => new Promise<void>((resolve) => { stopped = resolve; }));
    const pending = handler.beginVoiceHold({ id: 1, windowX: 200, windowY: 500 });
    await handler.finishVoiceHold(); stopped(); await pending;
    expect(handler.voice.start).not.toHaveBeenCalled();
  });
});
