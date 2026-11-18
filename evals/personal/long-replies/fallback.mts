import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

import type { TurnOutcome } from '@xopcai/gateway-contract';

import { cases } from './cases.mts';
import { openEvaluationRuntime } from './model.mts';

const out = process.argv[2];
if (!out) throw new Error('Usage: node --import tsx evals/personal/long-replies/fallback.mts OUTPUT_DIR');
const liveNormal = process.argv.includes('--live-normal');
const runtime = await openEvaluationRuntime();
const { AgentCatalogRepository } = await import('../../../src/agent-catalog/repository.js');
const { readMediaBuffer, saveMediaBuffer } = await import('../../../src/media/store.js');
const { tryParseMediaUri } = await import('../../../src/media/uri.js');
const { personalAgentId } = await import('../../../src/personal-agent/repository.js');
const { PersonalReplyComposer } = await import('../../../src/personal-agent/reply-composer.js');
const { createConversation } = await import('../../../src/storage/sqlite/conversation-repository.js');
const { getSqliteDatabase } = await import('../../../src/storage/sqlite/transaction.js');
const { TaskApplicationService } = await import('../../../src/tasks/task-application-service.js');
const { TaskConversationRepository } = await import('../../../src/tasks/task-conversation-repository.js');
const { TaskResultDeliveryService } = await import('../../../src/tasks/task-result-delivery-service.js');
const { TaskRunCoordinator } = await import('../../../src/tasks/task-run-coordinator.js');

const exact = cases.find(item => item.id === 'X03')!;
const report = [
  '结论：暂不能全量。继续保持 10% 灰度，等移动回归通过且观察满 24 小时。',
  '## Findings',
  ...['D04', 'D08', 'D06'].map(id => cases.find(item => item.id === id)!.source),
  '跨端日志、页面反馈及测试环境的原始材料分别存档。移动回归安排在下一个值班窗口，预计在测试完成以前保持当前灰度比例。',
].join('\n\n');
const appendixMarker = '跨端日志、页面反馈及测试环境的原始材料分别存档。';
const workerAgentId = 'long-replies-eval-worker';
const personal = personalAgentId('local-owner');
type Scenario = { name: string; mode: 'busy' | 'failure' | 'normal' | 'exact'; artifact: boolean; body: string; unrelated?: boolean };

try {
  const catalog = new AgentCatalogRepository();
  catalog.ensureInitialized();
  for (const id of [personal, workerAgentId]) {
    const primary = liveNormal && id === personal ? 'xopc-cloud/openai-codex/gpt-6.1-sol' : 'test/model';
    catalog.create({ id, enabled: true, models: { chat: { primary, fallbacks: [] } } }, { ready: true });
  }
  const rows = [];
  const scenarios: Scenario[] = [
    { name: 'busy_without_attachment', mode: 'busy', artifact: false, body: report },
    { name: 'busy_with_attachment', mode: 'busy', artifact: true, body: report },
    { name: 'busy_with_unrelated_attachment', mode: 'busy', artifact: true, body: report, unrelated: true },
    { name: 'failure_without_attachment', mode: 'failure', artifact: false, body: report },
    { name: 'failure_with_attachment', mode: 'failure', artifact: true, body: report },
    { name: 'normal_without_attachment', mode: 'normal', artifact: false, body: report },
    { name: 'explicit_verbatim', mode: 'exact', artifact: false, body: exact.source + '\n\n附录：\n\n' + report },
  ];
  for (const scenario of scenarios) {
    const request = scenario.mode === 'exact' ? exact.request : '能否今天全量？告诉我结论。';
    const origin = createConversation({ agentId: personal, customData: { personalAgent: true } }, runtime.workspace);
    const worker = createConversation({ agentId: workerAgentId }, runtime.workspace);
    const result = new TaskApplicationService().create({
      idempotencyKey: origin.key, title: scenario.name, locale: 'zh', priority: 'normal', originConversationId: origin.key,
      contract: { objective: request, expectedOutputs: ['结论'], acceptanceCriteria: [],
        constraints: [], assumptions: [], approvalRequired: [], risks: [], acceptancePolicy: 'manual', outputDestinations: [] },
      dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: workerAgentId } },
    });
    if (!result.ok || !result.runId) throw new Error('Task creation failed: ' + scenario.name);
    const runId = result.runId;
    const taskId = result.model.task.id;
    new TaskConversationRepository().activateExecutionSession({ taskId, conversationId: worker.key, agentId: workerAgentId, runId });
    const coordinator = TaskRunCoordinator.start({ runId, fallbackObjective: request, context: {
      runId, conversationId: worker.key, agentId: workerAgentId, taskId, channel: 'webchat', origin: 'task', triggerKind: 'user',
    } });
    assert(coordinator);
    const outcome: TurnOutcome = {
      version: 1, outcomeId: runId, runId, turnId: runId, status: scenario.mode === 'exact' ? 'succeeded' : 'partial',
      summary: '模拟交付', deliverables: [], evidence: [], createdAt: new Date().toISOString(),
    };
    if (scenario.artifact) {
      const media = await saveMediaBuffer(Buffer.from(scenario.unrelated ? 'This is only a supporting file.' : scenario.body), {
        bucket: 'outbound', contentType: 'text/markdown',
      });
      outcome.deliverables.push({ artifactId: media.id, title: '验证报告.md', kind: 'document',
        availability: 'available', location: 'artifact_store', uri: media.uri, capabilities: ['download'], mimeType: 'text/markdown' });
    }
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: '模拟交付', assistantText: scenario.body });
    const notify = () => {};
    await new TaskResultDeliveryService().drain(notify);
    const db = getSqliteDatabase();
    const packetRow = db.prepare('SELECT reply_payload_json FROM task_result_deliveries WHERE task_run_id = ?')
      .get(runId) as { reply_payload_json: string } | undefined;
    assert(packetRow?.reply_payload_json, 'No outbox packet: ' + scenario.name);
    const packet = JSON.parse(packetRow.reply_payload_json);
    const artifactAvailable = packet.delivery.outcome.deliverables.some((item: { availability: string }) => item.availability === 'available');
    assert.equal(artifactAvailable, scenario.artifact);
    let composeCalls = 0;
    const useLiveModel = liveNormal && scenario.mode === 'normal';
    const composer = useLiveModel ? new PersonalReplyComposer() : new PersonalReplyComposer(async packet => {
      composeCalls += 1;
      if (scenario.mode === 'exact') return '确认稿如下。';
      if (scenario.mode === 'normal') {
        if (process.argv.includes('--expect-compact')) assert(packet.fullReportAttached);
        return '今天暂不能全量，先保持 10% 灰度。';
      }
      throw new Error('Synthetic generation failure');
    });
    if (scenario.mode === 'busy') {
      db.prepare('UPDATE task_result_deliveries SET created_at = ? WHERE task_run_id = ?').run(Date.now() - 6000, runId);
    }
    await composer.drain(notify, () => scenario.mode !== 'busy');
    const delivered = db.prepare('SELECT reply_status, reply_text, reply_message_entry_id FROM task_result_deliveries WHERE task_run_id = ?')
      .get(runId) as { reply_status: string; reply_text: string; reply_message_entry_id: string } | undefined;
    assert(delivered);
    assert.equal(delivered.reply_status, 'delivered');
    if (!useLiveModel) assert.equal(composeCalls, scenario.mode === 'busy' ? 0 : 1);
    const text = delivered.reply_text;
    const exactPreserved = scenario.mode === 'exact' ? text === '确认稿如下。\n\n' + scenario.body : null;
    if (scenario.mode === 'exact') assert(exactPreserved);
    const message = db.prepare('SELECT payload_json FROM transcript_entries WHERE entry_id = ?').get(delivered.reply_message_entry_id);
    const attachments = JSON.parse(String(message?.payload_json)).details.outcome.deliverables as TurnOutcome['deliverables'];
    const fullUri = attachments[0]?.uri ?? (scenario.artifact && !scenario.unrelated ? packet.delivery.outcome.deliverables[0]?.uri : undefined);
    const fullMedia = fullUri && tryParseMediaUri(fullUri);
    const fullReportReadable = fullMedia
      ? (await readMediaBuffer(fullMedia.id, fullMedia.bucket)).buffer.toString('utf8') === scenario.body : false;
    if (process.argv.includes('--expect-compact') && scenario.mode !== 'exact') {
      assert(text.length < (useLiveModel ? 320 : 150) && !text.includes(appendixMarker), 'Long report entered the chat in ' + scenario.name);
      assert(fullReportReadable, 'No complete attachment in ' + scenario.name);
      assert.equal(attachments.length, scenario.artifact && !scenario.unrelated ? 0 : 1);
    }
    if (useLiveModel) {
      assert(/10\s*%/u.test(text) && /24\s*小时/u.test(text) && /移动/u.test(text), 'Live reply missed rollout limits');
      assert(!text.includes('完整结果与限制见附件。'), 'Live composition used the deterministic fallback');
      assert(/10\s*%|全量/u.test(text.split('\n\n')[0]!), 'Lead only gave a generic status');
    }
    rows.push({ scenario: scenario.name, sourceChars: [...scenario.body].length, replyChars: [...text].length,
      artifactAvailable, replyFileCount: attachments.length, fullReportReadable, optionalAppendixInline: text.includes(appendixMarker), exactPreserved,
      composeCalls: useLiveModel ? null : composeCalls, liveModel: useLiveModel ? 'GPT-6.1 Sol' : null, text });
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, liveNormal ? 'delivery-live.json' : 'fallback.json'), JSON.stringify(rows, null, 2) + '\n');
  console.table(rows.map(({ text: _text, ...row }) => row));
} finally {
  runtime.close();
}
