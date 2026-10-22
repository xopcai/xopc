import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attribution, validateJudgment } from './scoring.mjs';
import { provenanceCoverage } from './metrics.mjs';

const input = { storedText: 'The database is SQLite.', selectedText: '', toolText: '', learningErrors: [] };
const good = { correct: false, reason: 'Missing evidence', unsupportedClaim: false, benchmarkConcern: null,
  storedSupport: { sufficient: true, quote: 'database is SQLite' },
  selectedSupport: { sufficient: false, quote: '' }, toolSupport: { sufficient: false, quote: '' } };
test('rejects fabricated support and invalid verdicts', () => {
  assert.equal(validateJudgment(JSON.stringify(good), input).correct, false);
  assert.throws(() => validateJudgment(JSON.stringify({ ...good, storedSupport: { sufficient: true, quote: 'Postgres' } }), input));
  assert.throws(() => validateJudgment(JSON.stringify({ ...good, correct: 'false' }), input));
});
test('does not attribute incomplete diagnostics to a retrieval failure', () => {
  assert.equal(attribution(good, input), 'retrieval_or_selection_or_tool_use');
  assert.equal(attribution(good, { ...input, gold: { abstention: true } }), 'abstention_or_entity_misattribution');
  assert.equal(attribution(good, { ...input, diagnosticsTruncated: true }), 'diagnostics_incomplete');
  assert.equal(attribution({ ...good, selectedSupport: { sufficient: true } }, input), 'evidence_available_but_answer_failed');
  assert.equal(attribution({ ...good, benchmarkConcern: 'Ambiguous reference' }, input), 'benchmark_review');
});
test('provenance excludes contradictions and distinguishes missing gold from no-answer cases', () => {
  const learning = { evidence: [{ evidence_id: 'e', message_id: 'm' }], entryRefs: { m: 'source:0' },
    assertionLinks: [{ assertion_id: 'a', evidence_id: 'e', relation: 'contradicts' }], knowledgeLinks: [] };
  assert.equal(provenanceCoverage(['source:0'], learning, [], '').storedSourceCoverage, 0);
  learning.assertionLinks[0]!.relation = 'supports';
  const metric = provenanceCoverage(['source:0'], learning, [{ included: 1, object_id: 'a' }], '');
  assert.equal(metric.injectedSourceCoverage, 1);
  assert.equal(provenanceCoverage([], learning, [], '').storedSourceCoverage, null);
});

test('validates decoded tool quotes and rejects metadata-only evidence', () => {
  const toolText = JSON.stringify({ role: 'toolResult', content: [{ type: 'text', text: '{"results": []}' }],
    details: { hidden: 'metadata-only-secret' } });
  const judgment = { ...good, toolSupport: { sufficient: true, quote: '"results": []' } };
  assert.equal(validateJudgment(JSON.stringify(judgment), { ...input, toolText }).correct, false);
  assert.equal(validateJudgment(JSON.stringify({ ...judgment, toolSupport: { sufficient: true, quote: '"results":[]' } }), { ...input, toolText }).correct, false);
  assert.throws(() => validateJudgment(JSON.stringify({ ...judgment,
    toolSupport: { sufficient: true, quote: 'metadata-only-secret' } }), { ...input, toolText }));
});
