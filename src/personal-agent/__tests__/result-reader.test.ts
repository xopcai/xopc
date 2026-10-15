import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TurnOutcome } from '@xopcai/gateway-contract';
import { resultReferenceId, resultReferenceVersion } from '@xopcai/gateway-contract';
import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { createPersonalResultTool } from '../../agent/tools/personal-result-tool.js';
import { buildResultAgentContext } from '../../agent/source-context/result-context.js';
import { saveMediaBuffer, resolveMediaBufferPath } from '../../media/store.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { claimNextSessionInput, finishSessionInputRun, insertSessionInput } from '../../storage/sqlite/session-input-repository.js';
import { resolveTaskHandoffReferences, parseTaskHandoffReferences } from '../../tasks/task-handoff.js';
import { TaskApplicationService } from '../../tasks/task-application-service.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';
import { TaskRunCoordinator } from '../../tasks/task-run-coordinator.js';
import { buildSessionContextForLlm } from '../../session/session-context-for-llm.js';
import { loadTranscriptRowsForSession } from '../../storage/sqlite/transcript-repository.js';
import { TaskResultDeliveryService } from '../../tasks/task-result-delivery-service.js';
import { personalAgentId } from '../repository.js';
import { extractResult } from '../result-extraction.js';
import { listPersonalResults, readPersonalResult, resolvePersonalResultReference, stopPersonalResultPreparations } from '../result-reader.js';
import { drainPersonalResultReads, waitForPersonalResult } from '../result-read-continuations.js';

describe('Personal result continuity', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xopc-result-read-'));
    vi.stubEnv('XOPC_STATE_DIR', root);
    resetXopcDatabaseSingletonForTest(); seedTestDatabase(join(root, 'xopc.db')); openXopcDatabase({ path: join(root, 'xopc.db') });
  });
  afterEach(async () => {
    await stopPersonalResultPreparations();
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true });
  });

  async function result(text: string | undefined, file?: { text: string; name: string; mime: string }) {
    const main = createConversation({ agentId: personalAgentId('local-owner'), customData: { personalAgent: true } });
    const worker = createConversation({ agentId: 'worker' });
    const created = new TaskApplicationService().create({ idempotencyKey: main.key, title: 'Versioned work', priority: 'normal',
      locale: 'zh', originConversationId: main.key,
      contract: { objective: 'Produce work', expectedOutputs: [], acceptanceCriteria: [], constraints: [], approvalRequired: [],
        assumptions: [], risks: [], acceptancePolicy: 'manual', outputDestinations: [] }, dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'worker' } } });
    if (!created.ok || !created.runId) throw new Error('Expected run');
    const taskId = created.model.task.id;
    new TaskConversationRepository().activateExecutionSession({ taskId, conversationId: worker.key, agentId: 'worker', runId: created.runId });
    const coordinator = TaskRunCoordinator.start({ runId: created.runId, fallbackObjective: 'Produce work',
      context: { runId: created.runId, conversationId: worker.key, agentId: 'worker', taskId, channel: 'webchat', origin: 'task', triggerKind: 'user' } })!;
    const media = file ? await saveMediaBuffer(Buffer.from(file.text), { bucket: 'outbound', originalFilename: file.name, contentType: file.mime }) : undefined;
    const outcome: TurnOutcome = { version: 1, outcomeId: `outcome:${created.runId}`, runId: created.runId, turnId: created.runId,
      status: 'succeeded', summary: 'Summary only', evidence: [], createdAt: new Date().toISOString(), deliverables: media ? [{
        artifactId: media.id, title: file!.name, kind: 'document', location: 'artifact_store', availability: 'available',
        capabilities: ['download'], uri: media.uri, mimeType: file!.mime, sizeBytes: media.size }] : [] };
    coordinator.captureOutcome(outcome);
    coordinator.finalize({ status: 'succeeded', summary: 'Summary only', assistantText: text ?? 'Summary only' });
    const row = getSqliteDatabase().prepare('SELECT delivery_id FROM task_result_deliveries WHERE conversation_id = ?').get(main.key)!;
    return { conversationId: main.key, resultId: String(row.delivery_id), sourceId: media?.id, media, taskId };
  }
  async function ready(conversationId: string, input: Parameters<typeof readPersonalResult>[1]) {
    for (let n = 0; n < 100; n++) {
      const value = await readPersonalResult(conversationId, input);
      if (value.status !== 'preparing') return value;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Preparation did not finish');
  }

  it('retains full reports, finds facts beyond the chat excerpt, and reads all Unicode ranges without loss', async () => {
    const text = '# 一\n' + '中文😀内容\n'.repeat(4000) + '\n## 第三节\n确认代码：PINE-735；结论需要保留限制。';
    const r = await result(text);
    expect(listPersonalResults(r.conversationId).items[0]?.resultId).toBe(r.resultId);
    const directory = await ready(r.conversationId, { command: 'get', resultId: r.resultId, sourceId: 'body' });
    expect(directory.status).toBe('ready');
    expect(directory.sections).toEqual(expect.arrayContaining([expect.objectContaining({ title: '第三节' })]));
    const found = await readPersonalResult(r.conversationId, { command: 'search', resultId: r.resultId, query: '确认代码' });
    expect(JSON.stringify(found)).toContain('PINE-735');
    let cursor: string | undefined;
    let full = '';
    do {
      const page = await readPersonalResult(r.conversationId, { command: 'read', resultId: r.resultId, cursor, limit: 317,
        revision: String(directory.revision) });
      full += page.text; cursor = page.nextCursor as string | undefined;
    } while (cursor);
    expect(full).toBe(text);
    const section = await readPersonalResult(r.conversationId, { command: 'read', resultId: r.resultId, sectionId: '2' });
    expect(section.text).toContain('PINE-735');
    expect(section.complete).toBe(false); expect(section.rangeComplete).toBe(true);
  }, 15000);

  it('reads published files instead of a mutable workspace path and rejects cross-chat references, cursor reuse and changed bytes', async () => {
    const r = await result('Short explanation', { text: '# File\n' + 'data\n'.repeat(5000) + 'TAIL-EVIDENCE', name: 'report.md', mime: 'text/markdown' });
    const stranger = createConversation({ agentId: personalAgentId('local-owner'), customData: { personalAgent: true } });
    await expect(readPersonalResult(stranger.key, { command: 'read', resultId: r.resultId, sourceId: r.sourceId })).rejects.toThrow('unavailable');
    const page = await ready(r.conversationId, { command: 'read', resultId: r.resultId, sourceId: r.sourceId, limit: 100 });
    expect(page.status).toBe('ready');
    await expect(readPersonalResult(r.conversationId, { command: 'read', resultId: r.resultId, cursor: String(page.nextCursor) })).rejects.toThrow('different result');
    await expect(readPersonalResult(r.conversationId, { command: 'read', resultId: r.resultId, sourceId: r.sourceId, revision: 'wrong' })).rejects.toThrow('revision changed');
    const delivery = resolvePersonalResultReference(r.conversationId, r.resultId);
    const ref = resultReferenceId(r.resultId, r.sourceId);
    expect(buildResultAgentContext(r.conversationId, ref, resultReferenceVersion(delivery))?.text).toContain(r.sourceId);
    expect(buildResultAgentContext(stranger.key, ref)).toBeNull();
    expect(buildResultAgentContext(r.conversationId, ref, 'wrong')).toBeNull();
    writeFileSync(resolveMediaBufferPath(r.media!.id, 'outbound'), 'changed');
    expect(await readPersonalResult(r.conversationId, { command: 'read', resultId: r.resultId, sourceId: r.sourceId })).toMatchObject({ status: 'changed' });
  }, 15000);

  it('resolves a structured prior-result file title to its exact artifact version in the background', async () => {
    const r = await result('Retained result', { text: 'PINNED FILE', name: 'report.md', mime: 'text/markdown' });
    const reference = parseTaskHandoffReferences([{ kind: 'result', resultId: r.resultId, sourceId: 'report.md' }])![0];
    const created = new TaskApplicationService().create({ idempotencyKey: 'history-title', title: 'Use prior report', priority: 'normal', originConversationId: r.conversationId,
      contract: { objective: 'Read the selected report', expectedOutputs: [], acceptanceCriteria: [], constraints: [], approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'manual', outputDestinations: [] },
      dependencies: [], authorityGrants: [], context: [{ targetKind: 'source', targetId: 'selected-result', role: 'input', pinned: true,
        metadata: { kind: 'task_reference_request', ref: reference }, retrievalPolicy: {} }],
      activation: { mode: 'allocate', requirements: { version: 1, summary: 'Use the selected report' } } });
    if (!created.ok) throw new Error('Expected task');
    const resolved = await resolveTaskHandoffReferences(created.model.task.id);
    expect(resolved?.sources[0]).toMatchObject({ sourceId: resultReferenceId(r.resultId, r.sourceId), version: resultReferenceVersion(resolvePersonalResultReference(r.conversationId, r.resultId)) });
    expect(resolved?.completeness.unresolvedReferences).toEqual([]);
  });

  it('keeps escaped tool output within budget and recovers a prepared result after restart', async () => {
    const r = await result('"\\\n'.repeat(10000));
    await ready(r.conversationId, { command: 'read', resultId: r.resultId });
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(root, 'xopc.db') });
    const tool = createPersonalResultTool(() => r.conversationId);
    const value = await tool.execute('read', { command: 'read', resultId: r.resultId, limit: 4000 });
    const output = (value.content[0] as { text: string }).text;
    expect(output.length).toBeLessThanOrEqual(8000);
    expect(JSON.parse(output).nextCursor).toBeTruthy();
    getSqliteDatabase().prepare('DELETE FROM sessions WHERE conversation_id = ?').run(r.conversationId);
    await expect(readPersonalResult(r.conversationId, { command: 'read', resultId: r.resultId })).rejects.toThrow('unavailable');
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM personal_result_search').get()?.n).toBe(0);
  }, 15000);

  it('provides an explicit full-result lookup in the LLM history while keeping the projection small', async () => {
    const r = await result('first '.repeat(1000) + 'SECRET-TAIL', { text: '# result', name: 'result.md', mime: 'text/markdown' });
    await new TaskResultDeliveryService().drain(() => {});
    const history = JSON.stringify(buildSessionContextForLlm(loadTranscriptRowsForSession(r.conversationId)));
    expect(history).toContain('projection is an excerpt'); expect(history).toContain(r.resultId); expect(history).not.toContain('SECRET-TAIL');
  });

  it('extracts Office parts, slide numbers and spreadsheet formulas with honest limitations', async () => {
    const zip = new AdmZip();
    zip.addFile('word/document.xml', Buffer.from('<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二段 &amp; 735</w:t></w:r></w:p></w:body></w:document>'));
    const path = join(root, 'work.docx'); writeFileSync(path, zip.toBuffer());
    const doc = await extractResult({ file: path, title: 'work.docx' });
    expect(doc).toMatchObject({ unsupported: false, text: '第一段\n第二段 & 735', sections: [expect.objectContaining({ locator: { kind: 'paragraph', paragraph: 1 } }), expect.anything()] });
    const slides = new AdmZip();
    for (const n of [10, 2, 1]) slides.addFile(`ppt/slides/slide${n}.xml`, Buffer.from(`<a:p xmlns:a="a"><a:t>slide-${n}</a:t></a:p>`));
    const slidePath = join(root, 'work.pptx'); writeFileSync(slidePath, slides.toBuffer());
    expect(await extractResult({ file: slidePath, title: 'work.pptx' })).toMatchObject({ unsupported: false, text: 'slide-1\nslide-2\nslide-10' });
    const book = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet([['Month', 'Total'], ['Jan', 150], ['Feb', 210]]);
    sheet.B4 = { t: 'n', f: 'SUM(B2:B3)', v: 360 }; sheet['!ref'] = 'A1:B4'; XLSX.utils.book_append_sheet(book, sheet, 'Sales');
    const table = join(root, 'work.xlsx'); writeFileSync(table, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
    const extracted = await extractResult({ file: table, title: 'work.xlsx' });
    expect(JSON.stringify(extracted)).toContain('SUM(B2:B3)'); expect(JSON.stringify(extracted)).toContain('not recalculated');
  });

  it('coalesces concurrent cold artifact reads into one preparation identity', async () => {
    const r = await result('Ready', { text: '# Shared\nConcurrent source', name: 'shared.md', mime: 'text/markdown' });
    const responses = await Promise.all(Array.from({ length: 16 }, () => readPersonalResult(r.conversationId,
      { command: 'read', resultId: r.resultId, sourceId: r.sourceId })));
    expect(new Set(responses.map(row => row.preparationId)).size).toBe(1);
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM personal_result_documents').get()?.n).toBe(1);
    expect(await ready(r.conversationId, { command: 'read', resultId: r.resultId, sourceId: r.sourceId })).toMatchObject({ text: '# Shared\nConcurrent source' });
  }, 15000);

  it('resumes a cold read once through the input queue, and invalidates it after a reset', async () => {
    const r = await result('# Tail\nCOLD-735');
    const request = { command: 'read' as const, resultId: r.resultId };
    insertSessionInput({ id: 'cold-input', conversationId: r.conversationId, clientMessageId: 'cold-input',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'Read the selected result', origin: { type: 'endpoint', endpointId: 'test' } });
    claimNextSessionInput(r.conversationId, 'cold-run');
    expect(waitForPersonalResult(r.conversationId, request)).toBe(true);
    finishSessionInputRun(r.conversationId, 'cold-run', 'completed');
    await ready(r.conversationId, request);
    const submit = vi.fn(async (input: { conversationId: string; clientMessageId: string; content: string }) => {
      insertSessionInput({ id: input.clientMessageId, ...input, requestedDelivery: 'next', effectiveDelivery: 'next',
        status: 'queued', origin: { type: 'system', source: 'task_update' } });
      return true;
    });
    await drainPersonalResultReads({ isAvailable: () => false, submit });
    expect(submit).not.toHaveBeenCalled();
    await drainPersonalResultReads({ isAvailable: () => true, submit });
    await drainPersonalResultReads({ isAvailable: () => true, submit });
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![0].content).toContain('Read the selected result');
    expect(getSqliteDatabase().prepare('SELECT status FROM personal_result_read_waits').get()?.status).toBe('queued');
    getSqliteDatabase().prepare("UPDATE personal_result_read_waits SET status = 'pending', transcript_id = 'old-transcript'").run();
    await drainPersonalResultReads({ isAvailable: () => true, submit });
    expect(getSqliteDatabase().prepare('SELECT status FROM personal_result_read_waits').get()?.status).toBe('stale');
  }, 15000);

  it('extracts actual PDF page text and reports visual limitations', async () => {
    const contents = 'BT /F1 12 Tf 72 720 Td (PDF-PAGE-735) Tj ET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${contents.length} >>\nstream\n${contents}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((value, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${value}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const path = join(root, 'work.pdf'); writeFileSync(path, pdf);
    const extracted = await extractResult({ file: path, title: 'work.pdf' });
    expect(extracted).toMatchObject({ unsupported: false, text: expect.stringContaining('PDF-PAGE-735'),
      sections: [expect.objectContaining({ locator: { kind: 'page', page: 1 } })] });
    expect(JSON.stringify(extracted)).toContain('not verified');
  });
});
