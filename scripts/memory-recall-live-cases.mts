import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { stripRuntimeContextFromUserMessage } from '../src/session/user-message-display.js';
import { recallCitationIds } from '../src/agent/context/recall-grounding.js';
import { writeKnowledgeItem } from '../src/knowledge-memory/index.js';
import { buildExecutionContext } from '../src/agent/context/execution-context.js';

/** Shared corpus; seeds and answers both go through real authenticated model turns. */
export async function runRecallAcceptance(harness: {
  turn: (...args: any[]) => Promise<any>; session: (...args: any[]) => string;
  api: (...args: any[]) => Promise<any>; service: any; db: any; directory: string;
  agentId: string; workspace: string; passed: (entry: any) => void; report: any; tag: string;
}) {
  const { turn, session, service, db, directory, agentId, passed, report, tag } = harness;
  const corpus = JSON.parse(readFileSync(new URL('../evals/memory/recall-cases.json', import.meta.url), 'utf8'));
  const format = (text: string) => text.replaceAll('{tag}', tag);
  const comparable = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '');
  const root = join(directory, 'recall-project'); mkdirSync(root, { recursive: true });
  const project = service.projects.create({ name: '星桥', workspaceRoot: root, executionMode: 'local_checkout' });
  const newChat = () => session(undefined, { projectId: project.id, cwd: root });
  const sources: Record<string, { conversationId: string; text: string }> = {};
  for (const source of corpus.sources) {
    const id = newChat();
    const entry = await turn(`seed-${source.id}`, format(source.text), id);
    assert.ok(entry.tools.some(tool => tool.name === 'personal_memory' && tool.details?.status === 'saved'), `${source.id}: real seed was not committed`);
    sources[source.id] = { conversationId: id, text: format(source.text) }; passed(entry);
  }
  for (let index = 0; index < 25; index++) writeKnowledgeItem({
    kind: 'note', scope: { type: 'project', id: project.id }, canonicalKey: `recall-noise-${index}`,
    content: `午餐菜单色卡编号${index}，今日可选青豆或南瓜。`, originClass: 'owner', confidence: 1, importance: 0.8,
  });
  report.recallNoiseFixtures = { count: 25, method: 'existing domain repository; synthetic unrelated knowledge only' };
  report.recallEvaluation = { corpusVersion: corpus.version, cases: [], baseline: 'existing local execution context without on-demand recall', sources };
  let followUpChat: string | undefined;
  for (const testCase of corpus.cases) {
    const id = testCase.id === 'follow-up' ? followUpChat! : newChat();
    if (testCase.id === 'revision-why') followUpChat = id;
    const baseline = buildExecutionContext({ query: format(testCase.question), agentId, workspaceId: root, conversationId: id, projectId: project.id });
    const beforeCalls = Number(db.prepare("SELECT COUNT(*) AS n FROM ai_usage_events WHERE operation = 'memory.recall_query'").get().n);
    const entry = await turn(testCase.id, format(testCase.question), id);
    const audit = db.prepare('SELECT run_id,metrics_json FROM execution_context_runs WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1').get(id);
    const metrics = audit ? JSON.parse(audit.metrics_json) : {};
    const items = audit ? db.prepare('SELECT object_id,reasons_json,included FROM execution_context_items WHERE run_id = ?').all(audit.run_id) : [];
    const history = items.filter(item => item.included && String(item.object_id).startsWith('history:'));
    const includedSources = history.map(item => {
      const [, conversationId, entryId] = item.object_id.split(':');
      const source = db.prepare('SELECT content FROM transcript_fts WHERE conversation_id = ? AND entry_id = ?').get(conversationId, entryId);
      assert.ok(source, 'Cited source no longer exists');
      return { conversationId, entryId, text: stripRuntimeContextFromUserMessage(source.content) };
    });
    const caseMetrics = { id: testCase.id, group: testCase.group, metrics, includedSources,
      baselineReferenceTermCoverage: testCase.answerIncludes.filter(term => [...baseline.knowledge.map(item => item.content), ...baseline.assertions.map(item => item.assertion.statement)].some(value => value.includes(format(term)))).length,
      referenceTermCount: testCase.answerIncludes.length,
      expectedSourceCount: testCase.expectedSources.length,
      deepExpectedCoverage: testCase.expectedSources.filter(source => includedSources.some(item => item.conversationId === sources[source].conversationId && item.text === sources[source].text)).length,
      modelCalls: Number(db.prepare("SELECT COUNT(*) AS n FROM ai_usage_events WHERE operation = 'memory.recall_query'").get().n) - beforeCalls,
      answer: entry.reply, passed: false };
    report.recallEvaluation.cases.push(caseMetrics);
    assert.equal(caseMetrics.modelCalls, 1, `${testCase.id}: expected one bounded query rewrite`);
    assert.equal(metrics.recallFailed, 0, `${testCase.id}: recall degraded`);
    assert.equal(caseMetrics.deepExpectedCoverage, testCase.expectedSources.length, `${testCase.id}: source evidence missed`);
    for (const answer of testCase.answerIncludes) assert.ok(comparable(entry.reply).includes(comparable(format(answer))), `${testCase.id}: missing answer ${format(answer)}`);
    for (const answer of testCase.answerExcludes) assert.ok(!comparable(entry.reply).includes(comparable(format(answer))), `${testCase.id}: unsupported answer ${format(answer)}`);
    if (testCase.expectedSources.length) {
      const citations = recallCitationIds(entry.reply);
      if (testCase.group !== 'paraphrase') assert.ok(citations.length, `${testCase.id}: no historical citation`);
      for (const id of citations) {
        assert.ok(history.some(item => JSON.parse(item.reasons_json).includes(`citation:${id}`)), `${testCase.id}: fabricated citation`);
      }
    } else assert.match(entry.reply, /没有|不足|不清楚|不知道|未找到|未查到|无法/u, 'Missing evidence should be disclosed');
    caseMetrics.passed = true; passed(entry);
  }
  const normal = newChat();
  const before = Number(db.prepare("SELECT COUNT(*) AS n FROM ai_usage_events WHERE operation = 'memory.recall_query'").get().n);
  const greeting = await turn('ordinary-turn-no-recall', '你好，请只回复：你好。', normal);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM ai_usage_events WHERE operation = 'memory.recall_query'").get().n), before); passed(greeting);
  const external = session();
  const excluded = await turn('other-project-history-exclusion', '上次星桥项目最初采用哪条发布分支，后来为什么换了？只使用当前范围允许的信息。', external);
  for (const marker of [`release-${tag}`, `stable-${tag}`, `轮值-${tag}`]) assert.ok(!excluded.reply.includes(marker), 'Scope boundary leaked');
  const lastAudit = db.prepare('SELECT metrics_json FROM execution_context_runs WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1').get(external);
  assert.equal(JSON.parse(lastAudit.metrics_json).includedRecallEvidence, 0); passed(excluded);
  report.recallEvaluation.summary = {
    cases: report.recallEvaluation.cases.length, passed: report.recallEvaluation.cases.filter(item => item.passed).length,
    expectedSources: report.recallEvaluation.cases.reduce((sum, item) => sum + item.expectedSourceCount, 0),
    retrievedSources: report.recallEvaluation.cases.reduce((sum, item) => sum + item.deepExpectedCoverage, 0),
  };
}
