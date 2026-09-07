/* Evaluate in the foreground Android development app with agent-device CDP.
 * Uses the real native module, requires microphone permission, and never uploads audio.
 * Inspect globalThis.__voiceNativeProbe for results; every run releases its audio session.
 */
(() => {
  if (globalThis.__voiceNativeProbe?.stage === 'running') throw new Error('Probe already running');
  const entry = Array.from(__r.getModules()).find(([, module]) =>
    module.verboseName?.endsWith('/features/voice/native-audio-session.ts'));
  if (!entry) throw new Error('Native audio session not present in the development bundle');
  const { NativeAudioSession } = __r(entry[0]);
  const audio = new NativeAudioSession();
  const result = globalThis.__voiceNativeProbe = { stage: 'running', cases: [], capturedFrames: 0, capturedBytes: 0 };
  const played = new Map();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const tone = bytes => {
    const pcm = new Uint8Array(bytes);
    const view = new DataView(pcm.buffer);
    for (let sample = 0; sample < bytes / 2; sample++) {
      view.setInt16(sample * 2, Math.round(Math.sin(sample * 2 * Math.PI * 440 / 24000) * 2000), true);
    }
    return pcm;
  };
  const expectPlayed = async (id, bytes, startedAt) => {
    const deadline = Date.now() + 5000;
    while ((played.get(id) ?? 0) < bytes && Date.now() < deadline) await sleep(40);
    const actual = played.get(id) ?? 0;
    result.cases.push({ id, expectedBytes: bytes, playedBytes: actual, elapsedMs: Date.now() - startedAt });
    if (actual !== bytes) throw new Error(`${id}: expected ${bytes} played bytes, got ${actual}`);
  };
  const play = async (id, bytes) => {
    const startedAt = Date.now();
    await audio.enqueue(id, tone(bytes));
    await expectPlayed(id, bytes, startedAt);
  };
  void (async () => {
    try {
      await audio.start(false, { title: 'Voice diagnostic', end: 'End' }, {
        pcm: bytes => { result.capturedFrames++; result.capturedBytes += bytes.length; },
        played: (id, bytes) => played.set(id, bytes),
        interrupted: reason => { result.interruption = reason; },
      });
      audio.capture(true);
      await sleep(500);
      audio.capture(false);
      if (!result.capturedFrames) throw new Error('No native microphone frames');
      await play('short-reply', 24000);
      await play('ten-milliseconds', 480);
      await play('full-window', 96000);
      await play('stream-gap', 4800);
      await sleep(500);
      const resumedAt = Date.now();
      await audio.enqueue('stream-gap', tone(4800));
      await expectPlayed('stream-gap', 9600, resumedAt);
      await audio.enqueue('interrupted-reply', tone(96000));
      await sleep(100);
      await audio.flush();
      await play('after-interruption', 24000);
      if (result.interruption) throw new Error(`Audio interrupted: ${result.interruption}`);
      result.stage = 'passed';
    } catch (error) {
      result.stage = 'failed';
      result.error = String(error);
    } finally {
      try {
        await audio.stop();
        result.stopped = true;
      } catch (error) {
        result.stage = 'failed';
        result.error = String(error);
      }
    }
  })();
  return 'Native voice probe started; inspect globalThis.__voiceNativeProbe';
})()
