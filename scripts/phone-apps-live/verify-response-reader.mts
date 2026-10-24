import assert from 'node:assert/strict';

import { readResponseMetadata } from './response-reader.js';
import { classifyModelActionEnvelope } from './protocol-envelope-diagnostics.js';

const payload = { choices: [{ message: { content: '<think>private thoughts</think><answer>do(action="Back")</answer>' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } };
const original = Response.json(payload);
const normal = await readResponseMetadata(original);
assert.equal(normal.metadata?.finalFormat, 'think-literal');
assert.equal(normal.metadata?.usage.totalTokens, 120);
assert(!JSON.stringify(normal).includes('private thoughts'));
assert.deepEqual(await original.json(), payload);

const largeText = JSON.stringify({ choices: [{ message: { content: 'private'.repeat(1000) } }] });
const large = new Response(largeText);
let timer: ReturnType<typeof setTimeout>;
const capped = await Promise.race([readResponseMetadata(large, 64), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Tee reader deadlocked')), 1000); })]);
clearTimeout(timer!);
assert.equal(capped.readIssue, 'too_large');
assert.equal(capped.metadata, undefined);
assert.equal(await large.text(), largeText);

const malformed = new Response('private invalid JSON');
const invalid = await readResponseMetadata(malformed);
assert.equal(invalid.readIssue, 'invalid_json');
assert(!JSON.stringify(invalid).includes('private'));
assert.equal(await malformed.text(), 'private invalid JSON');
const withEnvelope = await readResponseMetadata(Response.json(payload), undefined, raw => ({ ...classifyModelActionEnvelope(raw, candidate => candidate === 'do(action="Back")'), wholeResponseParseable: true }));
assert.equal(withEnvelope.protocolEnvelope?.lastBalancedLiteralCallParseable, true);
assert(!JSON.stringify(withEnvelope).includes('private thoughts'));
console.log(JSON.stringify({ passed: true, checks: 4, scope: 'synthetic HTTP response reader only; no model or device calls' }));
