import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { readFileSync } from 'node:fs';

import { listContextExtractionOutputs } from '../src/storage/sqlite/context-extraction-repository.js';
import { buildExecutionContext } from '../src/agent/context/execution-context.js';
import { implicitMemoryClaimCorrection } from '../src/agent/context/memory-claim-grounding.js';

export async function runLearningAcceptance(harness: {
  turn: (...args: any[]) => Promise<any>; session: (...args: any[]) => string;
  api: (...args: any[]) => Promise<any>; db: any; agentId: string; workspace: string;
  passed: (entry: any) => void; saveReport?: () => void; report: any; tag: string;
}) {
  const { turn, session, api, db, agentId, workspace, passed, report, tag } = harness;
  const corpus = JSON.parse(readFileSync(new URL('../evals/memory/learning-cases.json', import.meta.url), 'utf8'));
  const requested = process.env.XOPC_MEMORY_LEARNING_CASES?.split(',').filter(Boolean);
  const cases = requested ? corpus.cases.filter(testCase => requested.includes(testCase.id)) : corpus.cases;
  assert.ok(cases.length && (!requested || cases.length === requested.length), 'Unknown learning case selection');
  const format = (text: string) => text.replaceAll('{tag}', tag);
  report.learningEvaluation = { corpusVersion: corpus.version, selectedCases: cases.map(testCase => testCase.id), cases: [] };
  async function learn(conversationId: string) {
    const queued = await api('/api/memory-learning/rebuild', { conversationId });
    assert.ok(queued.jobId, 'Learning job not queued');
    const until = Date.now() + 180000;
    let job;
    while (Date.now() < until) {
      job = (await api(`/api/memory-learning/jobs/${queued.jobId}`)).job;
      if (['succeeded', 'failed', 'canceled'].includes(job.state)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(job.state, 'succeeded', JSON.stringify(job));
    return job;
  }
  report.learningModelReplies = [];
  const diagnostics = channel('xopc.memory.interpretation');
  const observe = (message: unknown) => {
    const value = message as { conversationId: string; raw: string };
    report.learningModelReplies.push({ conversationId: value.conversationId, recordedAt: Date.now(), raw: value.raw.slice(0, 24000) });
    harness.saveReport?.();
  };
  diagnostics.subscribe(observe);
  try {
  for (const testCase of cases) {
    const id = session();
    for (const [index, prompt] of testCase.turns.entries()) {
      const seed = await turn(`${testCase.id}-source-${index + 1}`, format(prompt), id);
      assert.ok(!seed.tools.some(tool => tool.name === 'personal_memory' && tool.details?.status === 'saved'), 'This acceptance must exercise background learning, not explicit writes');
      assert.equal(implicitMemoryClaimCorrection(format(prompt), seed.reply, []), undefined, 'Implicit learning acknowledgement fabricated a save receipt');
      passed(seed);
    }
    const before = db.prepare('SELECT assertion_id FROM user_assertions').all().map(row => row.assertion_id);
    const job = await learn(id);
    const assertions = db.prepare(`SELECT a.assertion_id,a.kind,a.authority,a.status,a.statement,a.valid_to,a.volatility,
      s.scope_type,s.scope_id FROM user_assertions a JOIN user_assertion_slots s USING(slot_id)
      WHERE a.status IN ('active','candidate','needs_review','conflicted')`).all();
    const knowledge = db.prepare("SELECT knowledge_id,content,status,kind FROM knowledge_items WHERE status IN ('active','candidate','needs_review')").all();
    const rules = db.prepare(`SELECT r.rule_id,r.status,v.statement FROM collaboration_rules r
      JOIN collaboration_rule_revisions v ON v.revision_id=r.current_revision_id WHERE r.status != 'archived'`).all();
    const linkedIds = new Set(db.prepare(`SELECT DISTINCT l.assertion_id FROM user_assertion_evidence l
      JOIN context_evidence e ON e.evidence_id=l.evidence_id WHERE e.conversation_id=?`).all(id).map(row => row.assertion_id));
    const supportedAssertions = assertions.filter(row => linkedIds.has(row.assertion_id));
    const allText = JSON.stringify({ assertions, knowledge, rules });
    const entry = { name: `${testCase.id}-learning`, conversationId: id, job, assertions: supportedAssertions, newAssertionIds: assertions.filter(row => !before.includes(row.assertion_id)).map(row => row.assertion_id),
      extractionOutputs: [] as unknown[], replayJob: undefined as any, expected: testCase.expected.map(format), forbidden: testCase.forbidden.map(format), expectedSemanticTerms: testCase.semanticTerms ?? [], passed: false };
    report.cases.push(entry); report.learningEvaluation.cases.push(entry);
    for (const value of entry.expected) {
      const allowedKinds = testCase.expectedKinds ?? ['preference'];
      const assertion = supportedAssertions.find(row => allowedKinds.includes(row.kind) && testCase.semanticTerms.every(group =>
        group.some(term => row.statement.normalize('NFKC').toLocaleLowerCase().includes(term.toLocaleLowerCase())))
        && (!testCase.sequencePattern || new RegExp(testCase.sequencePattern, 'iu').test(row.statement)));
      assert.ok(assertion, `${testCase.id}: source-linked stable preference missing (${JSON.stringify(testCase.semanticTerms)})`);
      entry.expectedSemanticTerms = testCase.semanticTerms;
      assert.ok(['active', 'candidate'].includes(assertion.status), `${testCase.id}: preference unavailable`);
      assert.ok(allowedKinds.includes(assertion.kind));
      if (testCase.expectedAuthority === 'observational') assert.ok(['user_observed', 'system_inferred'].includes(assertion.authority), 'Repeated local choices were promoted to an explicit declaration');
      const context = buildExecutionContext({ query: value, agentId, workspaceId: workspace, conversationId: session() });
      assert.ok(context.assertions.some(item => item.assertion.id === assertion.assertion_id), `${testCase.id}: learned preference not usable`);
    }
    for (const value of entry.forbidden) assert.ok(!allText.includes(value), `${testCase.id}: disallowed fact persisted: ${value}`);
    if (testCase.group === 'negative') {
      const work = db.prepare(`SELECT k.knowledge_id,k.status FROM knowledge_items k JOIN knowledge_evidence_links l ON l.knowledge_id=k.knowledge_id
        JOIN context_evidence e ON e.evidence_id=l.evidence_id WHERE e.conversation_id=? AND k.status IN ('active','candidate','needs_review')`).all(id);
      assert.equal(work.length, 0, `${testCase.id}: source was stored through the work-memory channel`);
      for (const assertion of supportedAssertions) assert.ok(assertion.kind === 'current_state' && Number.isFinite(assertion.valid_to)
        && assertion.valid_to <= Date.now() + 8 * 86400000, `${testCase.id}: non-durable source became a lasting user assertion`);
    }
    if (testCase.id === 'temporary-state') {
      assert.ok(assertions.some(row => /结论|conclusion/iu.test(row.statement) && /证据|依据|evidence/iu.test(row.statement) && row.authority === 'user_explicit' && row.status === 'active'), 'Temporary request overwrote the stable preference');
    }
    if (testCase.id === 'assistant-guess') {
      assert.ok(!entry.assertions.some(row => ['identity', 'capability', 'preference'].includes(row.kind)), 'Guess or acknowledgement became a user fact');
    }
    entry.extractionOutputs = db.prepare('SELECT extraction_run_id FROM context_extraction_runs WHERE source_ref LIKE ?')
      .all(`learning:${job.id}:%`).flatMap(row => listContextExtractionOutputs(row.extraction_run_id));
    const countBeforeReplay = Number(db.prepare('SELECT COUNT(*) AS n FROM user_assertions').get().n);
    entry.replayJob = await learn(id);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM user_assertions').get().n), countBeforeReplay, 'Replay created duplicate assertions');
    passed(entry);
  }
  if (cases.some(testCase => testCase.id === 'ongoing-preference')) {
  const probe = await turn('learned-preferences-fresh-chat', '我平时偏好的说明格式是什么？只按已学到的稳定偏好回答，并区分临时要求与第三方引用。', session());
  assert.ok(/结论|conclusion/iu.test(probe.reply) && /证据|依据|evidence/iu.test(probe.reply), 'Fresh chat did not recall the learned stable preference'); passed(probe);
  }
  report.learningEvaluation.summary = { cases: cases.length,
    passed: report.learningEvaluation.cases.filter(entry => entry.passed).length };
  } finally {
    diagnostics.unsubscribe(observe);
  }
}
