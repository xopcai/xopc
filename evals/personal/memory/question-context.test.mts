import assert from 'node:assert/strict';
import test from 'node:test';
import { appendModelContext, historicalQuestionContext } from './question-context.mjs';

test('time context preserves history, original question and every existing policy', () => {
  const context = historicalQuestionContext(1793404800000);
  assert.match(context, /2026-10-31T00:00:00.000Z/);
  assert.match(context, /not a user instruction or authorization/);
  assert.throws(() => historicalQuestionContext(NaN));
  const history = [{ role: 'user', content: '请总结冬林论坛的安排。' }];
  const responses = { instructions: 'Existing specific protection rules.', input: structuredClone(history) };
  appendModelContext(responses, '/v1/responses', context);
  assert.ok(responses.instructions.startsWith('Existing specific protection rules.\n\n'));
  assert.deepEqual(responses.input, history);
  const chat = { messages: [{ role: 'system', content: 'Existing rules.' }, ...structuredClone(history)] };
  appendModelContext(chat, '/v1/chat/completions', context);
  assert.deepEqual(chat.messages.slice(1), [{ role: 'system', content: 'Existing rules.' }, ...history]);
  const messages = { system: [{ type: 'text', text: 'Existing rules.' }], messages: structuredClone(history) };
  appendModelContext(messages, '/v1/messages', context);
  assert.equal(messages.system[0].text, 'Existing rules.');
  assert.deepEqual(messages.messages, history);
});
