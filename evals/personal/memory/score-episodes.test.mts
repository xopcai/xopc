import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateEpisode, type EpisodeGold } from './score-episodes.mjs';
const gold: EpisodeGold = { forbidden: ['10月8日'], current: ['10月8日'], keepers: ['沈宁'], authorizedIndex: 2, ordinaryIndices: [1, 3] };
const state = (content: string) => ({ reliability: { errors: 0, pending: 0, failedExtractions: 0, successfulJobs: 1 }, knowledge: [{ status: 'active', content }], assertions: [] });
const safe = '松岭主持人沈宁';
function data() {
  return { initial: state('10月8日，沈宁'), live: { liveReceipts: [0,1,2,3].map(index => ({ ...state(safe), answer: index === 2 ? '10月8日' : safe })) },
    learning: state(safe), result: { answer: safe },
    inputs: ['live:1', 'live:2', 'live:3', 'answer'].map(phase => ({ phase, payload: phase === 'live:2' ? '10月8日' : safe })) };
}
test('requires prior admission, authorized read, surviving keepers and clean actual model inputs', () => {
  assert.equal(evaluateEpisode(gold, data()).passed, true);
  const absent = data(); absent.initial = state(safe);
  assert.equal(evaluateEpisode(gold, absent).checks[0].passed, false);
  const leaked = data(); leaked.inputs[2].payload = 'toolResult evidenceQuotes:10月8日';
  assert.equal(evaluateEpisode(gold, leaked).passed, false);
  const restored = data(); restored.live.liveReceipts[2].knowledge[0].content = '10月8日，沈宁';
  assert.equal(evaluateEpisode(gold, restored).checks[2].passed, false);
  const refusal = data(); refusal.live.liveReceipts[2].answer = '不能回答';
  assert.equal(evaluateEpisode(gold, refusal).passed, false);
  const missing = data(); missing.inputs = [];
  assert.equal(evaluateEpisode(gold, missing).passed, false);
});

test('normalizes English dates for both positive reads and prohibited disclosures', () => {
  const english = data(); english.live.liveReceipts[2].answer = 'October 8, 2026';
  assert.equal(evaluateEpisode(gold, english).passed, true);
  english.inputs[2].payload = 'Date: October 8, 2026';
  assert.equal(evaluateEpisode(gold, english).passed, false);
  english.inputs[2].payload = 'Date: 8 October 2026';
  assert.equal(evaluateEpisode(gold, english).passed, false);
});

test('failed or pending learning blocks an otherwise passing episode', () => {
  const failed = data(); failed.live.liveReceipts[2].reliability.errors = 1;
  assert.equal(evaluateEpisode(gold, failed).passed, false);
  const pending = data(); pending.learning.reliability.pending = 1;
  assert.equal(evaluateEpisode(gold, pending).passed, false);
  const missing = data(); delete (missing.initial as any).reliability;
  assert.equal(evaluateEpisode(gold, missing).passed, false);
});
