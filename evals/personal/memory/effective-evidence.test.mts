import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveAnswerEvidence } from './effective-evidence.mjs';
test('diagnostics use effective system and tool payloads, excluding pre-projection selections', () => {
  const rows = [{ phase: 'learning', payload: { messages: [{ role: 'system', content: '<user-context>raw forbidden value</user-context>' }] } },
    { phase: 'answer', payload: { messages: [{ role: 'system', content: '<user-context>other event date retained</user-context>' }, { role: 'tool', content: 'price withheld' }] } }];
  const result = effectiveAnswerEvidence(rows);
  assert.equal(result.selectedText, 'other event date retained');assert.equal(result.toolText, 'price withheld');
  assert.equal(result.answerRequests,1);assert.ok(!JSON.stringify(result).includes('raw forbidden'));
  const responses = effectiveAnswerEvidence([{phase:'answer',payload:{instructions:'<user-context>owner</user-context>',input:[{type:'function_call_output',output:'safe excerpt'}]}}]);
  assert.equal(responses.selectedText,'owner');assert.equal(responses.toolText,'safe excerpt');
});
