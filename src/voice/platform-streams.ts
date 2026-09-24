import WebSocket from 'ws';
import type { StreamingSttOpenRequest, StreamingSttSession } from '../media-understanding/types.js';
import type { SpeechSynthesisStreamResult } from './tts/speech-provider-types.js';

const MAX_BUFFERED_BYTES = 512 * 1024;
type Event = { type: string; session?: { input_sample_rate?: number; output_sample_rate?: number }; item_id?: string; text?: string; delta?: string; error?: { message?: string } };

function connect(url: string, token: string, signal: AbortSignal, onEvent: (event: Event) => void, onFailure: (error: Error) => void) {
  signal.throwIfAborted();
  const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, perMessageDeflate: false, maxPayload: 1024 * 1024 });
  let ended = false;
  const close = () => {
    if (ended) return;
    ended = true;
    signal.removeEventListener('abort', abort);
    if (socket.readyState === WebSocket.OPEN) socket.close();
    else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
  };
  const fail = (error: Error) => { if (!ended) { onFailure(error); close(); } };
  const abort = () => fail(signal.reason instanceof Error ? signal.reason : new Error('Voice request aborted'));
  signal.addEventListener('abort', abort, { once: true });
  socket.on('message', (raw, binary) => {
    if (ended) return;
    try {
      if (binary) throw new Error('Unexpected platform binary event');
      const event = JSON.parse(raw.toString()) as Event;
      if (!event || typeof event.type !== 'string') throw new Error('Invalid platform voice event');
      if (event.type === 'error') throw new Error(event.error?.message ?? 'Platform voice failed');
      onEvent(event);
    } catch (error) { fail(error instanceof Error ? error : new Error('Invalid platform voice event')); }
  });
  socket.on('unexpected-response', (_request, response) => { response.resume(); fail(new Error(`Platform voice rejected connection (${response.statusCode})`)); });
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('Platform voice disconnected before completion')));
  return { socket, close, fail,
    pause: () => { if (!ended && socket.readyState === WebSocket.OPEN) socket.pause(); },
    resume: () => { if (!ended && socket.readyState === WebSocket.OPEN) socket.resume(); },
    send: (value: object | Uint8Array) => {
    if (ended || socket.readyState !== WebSocket.OPEN) throw new Error('Platform voice is not connected');
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) throw new Error('Platform voice backpressure limit exceeded');
    socket.send(value instanceof Uint8Array ? value : JSON.stringify(value));
  } };
}

export async function openPlatformStt(request: StreamingSttOpenRequest): Promise<StreamingSttSession> {
  if (!request.apiKey || !request.baseUrl) throw new Error('Platform authorization is unavailable');
  if (request.inputFormat.sampleRate !== 16000 || request.inputFormat.encoding !== 'pcm_s16le' || request.inputFormat.channels !== 1) throw new Error('Platform STT requires 16 kHz mono PCM16');
  let ready = false, finished = false, finishing = false;
  let failure: Error | undefined;
  let inputBytes = 0;
  const sentences = new Map<string, { revision: number; final: boolean }>();
  let resolveReady!: () => void, rejectReady!: (error: Error) => void, resolveFinished!: () => void;
  const readyPromise = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const finishedPromise = new Promise<void>(resolve => { resolveFinished = resolve; });
  const connection = connect(request.baseUrl, request.apiKey, request.signal, event => {
    if (event.type === 'session.updated') {
      if (event.session?.input_sample_rate !== 16000) throw new Error('Unsupported STT audio format');
      ready = true; resolveReady(); request.onEvent({ type: 'ready' });
    } else if (event.type === 'transcript.partial' || event.type === 'transcript.final') {
      if (!ready || typeof event.item_id !== 'string' || typeof event.text !== 'string') throw new Error('Invalid platform transcript');
      let sentence = sentences.get(event.item_id);
      if (sentence?.final) return;
      if (!sentence) {
        if (sentences.size >= 10000) throw new Error('Transcript limit exceeded');
        sentence = { revision: 0, final: false }; sentences.set(event.item_id, sentence);
        request.onEvent({ type: 'speech_started', utteranceId: event.item_id });
      }
      sentence.revision++;
      if (event.type === 'transcript.final') {
        sentence.final = true;
        request.onEvent({ type: 'speech_stopped', utteranceId: event.item_id });
        request.onEvent({ type: 'transcript_final', utteranceId: event.item_id, revision: sentence.revision, text: event.text });
      } else request.onEvent({ type: 'transcript_delta', utteranceId: event.item_id, revision: sentence.revision, text: event.text });
    } else if (event.type === 'session.finished') {
      finished = true;
      request.onEvent({ type: 'usage', inputAudioMs: Math.round(inputBytes / 32) });
      resolveFinished(); connection.close();
    }
  }, error => { failure = error; rejectReady(error); resolveFinished(); request.onEvent({ type: 'error', error }); });
  connection.socket.once('open', () => connection.send({ type: 'session.update', session: { ...(request.language ? { language: request.language } : {}) } }));
  const timer = setTimeout(() => connection.fail(new Error('Platform STT setup timed out')), request.timeoutMs);
  try { await readyPromise; } finally { clearTimeout(timer); }
  const commit = async () => {
    if (failure) throw failure;
    if (!finished && !finishing) { finishing = true; connection.send({ type: 'session.finish' }); }
    const timeout = setTimeout(() => connection.fail(new Error('Platform STT finalization timed out')), request.timeoutMs);
    try { await finishedPromise; if (failure) throw failure; } finally { clearTimeout(timeout); connection.close(); }
  };
  return {
    appendAudio(bytes) {
      if (!ready || finished || finishing || failure) throw new Error('Platform STT is not writable');
      if (!bytes.length || bytes.length % 2 || bytes.length > 65536) throw new Error('Invalid PCM frame');
      inputBytes += bytes.length; connection.send(bytes);
    }, commit, close: commit,
    abort() { finished = true; resolveFinished(); connection.close(); },
  };
}

export async function openPlatformTts(request: {
  baseUrl: string; apiKey: string; voice: string; text: string; instructions?: string; signal: AbortSignal; timeoutMs: number;
}): Promise<SpeechSynthesisStreamResult> {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  let ready = false, ended = false, finishSent = false;
  const readyPromise = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const stream = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    pull(value) { if ((value.desiredSize ?? 0) > 0) connection.resume(); },
    cancel() { ended = true; clearTimeout(timer); connection.close(); },
  }, { highWaterMark: MAX_BUFFERED_BYTES, size: chunk => chunk.byteLength });
  const finishAudio = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    controller.close();
  };
  const connection = connect(request.baseUrl, request.apiKey, request.signal, event => {
    if (event.type === 'session.updated' && !ready) {
      if (event.session?.output_sample_rate !== 24000) throw new Error('Unsupported TTS audio format');
      ready = true; resolveReady();
      const characters = [...request.text];
      for (let i = 0; i < characters.length; i += 1000) connection.send({ type: 'input_text_buffer.append', text: characters.slice(i, i + 1000).join('') });
      connection.send({ type: 'input_text_buffer.commit' });
    } else if ((event.type === 'response.done' || event.type === 'text.flushed') && !finishSent) {
      finishSent = true; connection.send({ type: 'session.finish' });
    } else if (event.type === 'response.audio.done') {
      if (!finishSent) { finishSent = true; connection.send({ type: 'session.finish' }); }
      finishAudio();
    } else if (event.type === 'response.audio.delta') {
      if (!ready || typeof event.delta !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.delta)) throw new Error('Invalid platform audio');
      const bytes = Buffer.from(event.delta, 'base64');
      if (!bytes.length) return;
      if (bytes.length % 2 || bytes.length > MAX_BUFFERED_BYTES) throw new Error('Invalid platform audio');
      controller.enqueue(bytes);
      if ((controller.desiredSize ?? 0) <= 0) connection.pause();
    } else if (event.type === 'session.finished') {
      finishAudio(); connection.close();
    }
  }, error => { rejectReady(error); if (!ended) { ended = true; controller.error(error); } clearTimeout(timer); });
  const timer = setTimeout(() => connection.fail(new Error('Platform TTS timed out')), request.timeoutMs);
  connection.socket.once('open', () => connection.send({ type: 'session.update', session: { voice: request.voice, ...(request.instructions ? { instructions: request.instructions } : {}) } }));
  await readyPromise;
  return { audioStream: stream, outputFormat: 'pcm', fileExtension: 'pcm', voiceCompatible: false,
    release: async () => { clearTimeout(timer); connection.close(); finishAudio(); } };
}
