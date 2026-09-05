import { describe, expect, it, vi } from 'vitest';

import type { StreamingSttEvent, StreamingSttSession } from '../../../media-understanding/types.js';
import { createAgentVoiceEngine } from '../agentEngine.js';

function setup() {
  let onEvent!: (event: StreamingSttEvent) => void;
  let resolve!: (session: StreamingSttSession) => void;
  const opened = new Promise<StreamingSttSession>((done) => { resolve = done; });
  const send = vi.fn();
  const session: StreamingSttSession = { appendAudio: vi.fn(), abort: vi.fn(), commit: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const engine = createAgentVoiceEngine({
    claim: {
      sessionId: 'test', request: { purpose: 'dictation' }, config: {}, inputMode: 'server_vad', silenceDurationMs: 700,
      stt: { model: 'test', route: { provider: 'test' }, plugin: { openAudioStream: (request: { onEvent: typeof onEvent }) => { onEvent = request.onEvent; return opened; } } },
    } as never,
    runtime: {} as never,
    signal: new AbortController().signal,
    send, sendAudio: vi.fn(), onClose: vi.fn(async () => {}),
  });
  return { engine, session, send, resolve, emit: (event: StreamingSttEvent) => onEvent(event) };
}

describe('Agent voice engine lifecycle', () => {
  it('releases an upstream session that resolves after close', async () => {
    const test = setup();
    const starting = test.engine.start();
    test.engine.close();
    test.resolve(test.session);
    await expect(starting).rejects.toThrow('closed');
    expect(test.session.abort).toHaveBeenCalledOnce();
  });

  it('ignores duplicate final utterances, including higher revisions', async () => {
    const test = setup();
    const starting = test.engine.start();
    test.resolve(test.session);
    await starting;
    test.emit({ type: 'transcript_final', utteranceId: 'u1', revision: 1, text: 'Hello' });
    test.emit({ type: 'transcript_final', utteranceId: 'u1', revision: 2, text: 'Hello.' });
    expect(test.send.mock.calls.filter(([type]) => type === 'input.transcript.final')).toHaveLength(1);
    test.engine.close();
    test.emit({ type: 'transcript_final', utteranceId: 'u2', revision: 1, text: 'Late' });
    expect(test.send.mock.calls.filter(([type]) => type === 'input.transcript.final')).toHaveLength(1);
  });

  it('rejects audio before ready and after close', async () => {
    const test = setup();
    expect(() => test.engine.appendAudio(new Uint8Array(2))).toThrow('not ready');
    const starting = test.engine.start(); test.resolve(test.session); await starting;
    test.engine.appendAudio(new Uint8Array(2));
    test.engine.close();
    expect(() => test.engine.appendAudio(new Uint8Array(2))).toThrow('not ready');
    expect(test.session.appendAudio).toHaveBeenCalledOnce();
  });
});
