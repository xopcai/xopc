import assert from 'node:assert/strict';
import { PhoneActionSchema, PhoneDecisionSchema } from '../../src/phone/contracts.js';
import { classifyAlternativeActionContracts } from './protocol-alternatives.js';
const validators = { action: (value: unknown) => PhoneActionSchema.safeParse(value).success,
  decision: (value: unknown) => PhoneDecisionSchema.safeParse(value).success };
const json = classifyAlternativeActionContracts('Private prose\n```json\n{"type":"typeText","text":"PRIVATE_VALUE"}\n```', validators);
assert(json.trailingJsonActionSchemaValid); assert.equal(json.lastLineRepresentation, 'fencedJson');
assert(!JSON.stringify(json).includes('PRIVATE_VALUE'));
const unknown = classifyAlternativeActionContracts('{"action":"Type","text":"SECRET","SECRET_KEY":9}', validators);
assert.equal(unknown.unknownJsonKeyCount, 1); assert(!JSON.stringify(unknown).includes('SECRET'));
const full = classifyAlternativeActionContracts('操作：do（action="Type", text="PRIVATE"）', validators);
assert(full.fullwidthDslCall); assert(!full.caseInsensitiveDslCall);
const short = classifyAlternativeActionContracts('Type(text="PRIVATE")', validators);
assert.equal(short.lastLineRepresentation, 'shorthand'); assert.equal(short.redactedLastLine, 'Type(ARG)');
const none = classifyAlternativeActionContracts('Private explanation, no action.', validators);
assert.equal(none.lastLineRepresentation, 'none'); assert.equal(none.redactedLastLine, undefined);
assert(!JSON.stringify(none).includes('Private'));
console.log(JSON.stringify({ passed: true, checks: 5, scope: 'offline shape/privacy checks only' }));
