import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskResultDelivery, TurnOutcome } from '@xopcai/gateway-contract';

import { deleteMediaUris } from '../../media/session-references.js';
import { saveMediaBuffer } from '../../media/store.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, getSqliteDatabase } from '../../storage/sqlite/index.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { archiveSpaceTaskDelivery } from '../ingest.js';
import { changeSpaceItem, findSpaceTaskDelivery, getSpaceItem, listSpaceItems, purgeSpaceItem, readSpaceContent, saveSpaceReply } from '../repository.js';
import { SpaceWorker } from '../worker.js';

function pdfWithText(text: string): Buffer {
  const content = `BT /F1 12 Tf 30 60 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return String(offset).padStart(10, '0') + ' 00000 n \n';
  });
  return Buffer.from(pdf + `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`);
}

describe('Space', () => {
  let dir: string;
  let conversationId: string;
  let worker: SpaceWorker | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'xopc-space-test-'));
    vi.stubEnv('XOPC_STATE_DIR', dir);
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    conversationId = randomUUID();
    createConversation({ agentId: 'main', name: 'Growth' }, dir, conversationId);
  });

  afterEach(async () => {
    await worker?.stop();
    worker = undefined;
    closeXopcDatabase();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('archives one published file, indexes Chinese body text, and keeps it when the conversation is deleted', async () => {
    const file = await saveMediaBuffer(Buffer.from('# 复盘\n\n## 续费风险\n\n预算控制在两万元。'), {
      bucket: 'outbound', originalFilename: '复盘.md', contentType: 'text/markdown',
    });
    const inbound = await saveMediaBuffer(Buffer.from('input'), { bucket: 'inbound', originalFilename: 'input.txt' });
    const outcome: TurnOutcome = {
      version: 1, outcomeId: 'outcome', turnId: 'turn', runId: 'turn', status: 'succeeded',
      deliverables: [file, inbound].map(media => ({
        artifactId: media.id, title: media === file ? '复盘.md' : 'input.txt',
        kind: 'document', uri: media.uri, location: 'artifact_store',
        availability: 'available', sizeBytes: media.size, capabilities: ['preview', 'download'],
      })),
      evidence: [], createdAt: new Date().toISOString(),
    };
    const malformed = appendTranscriptEntry(conversationId, { type: 'custom', customType: 'turn_outcome', data: {}, timestamp: new Date().toISOString() });
    getSqliteDatabase().prepare('UPDATE transcript_entries SET payload_json = ? WHERE entry_id = ?')
      .run('{"customType":"turn_outcome",', malformed.entry_id);
    for (let index = 0; index < 2; index++) {
      appendTranscriptEntry(conversationId, { type: 'custom', customType: 'turn_outcome', data: outcome, timestamp: new Date().toISOString() });
    }
    const items = listSpaceItems({ view: 'all' }).items;
    expect(items).toHaveLength(1);
    const [item] = items;
    worker = new SpaceWorker();
    worker.start();
    await vi.waitFor(() => {
      const result = listSpaceItems({ view: 'all', q: '预算' }).items[0];
      expect(result?.hit).toMatchObject({ locator: { line: 3 }, text: expect.stringContaining('预算') });
      expect(getSqliteDatabase().prepare("SELECT complete FROM space_backfill WHERE source = 'turn'").get()).toEqual({ complete: 1 });
    }, { timeout: 10_000, interval: 100 });
    expect(listSpaceItems({ view: 'all', q: '续费风险' }).items[0]?.id).toBe(item.id);
    getSqliteDatabase().prepare('DELETE FROM sessions WHERE conversation_id = ?').run(conversationId);
    await deleteMediaUris([file.uri]);
    expect(getSpaceItem(item.id)?.origin?.available).toBe(false);
    expect(await new Response((await readSpaceContent(item.id, item.currentVersion.id))!.body).text()).toContain('预算');
    expect(changeSpaceItem(item.id, item.revision, { trash: true })).toBe('ok');
    expect(listSpaceItems({ view: 'all', q: '预算' }).items).toHaveLength(0);
    expect(changeSpaceItem(item.id, item.revision, { trash: false })).toBe('conflict');
    expect(purgeSpaceItem(item.id, item.revision + 1)).toBe('ok');
    expect(await readSpaceContent(item.id, item.currentVersion.id)).toBeNull();
  });

  it('retries failed PDF indexes with the worker loader and preserves the page locator', async () => {
    const file = await saveMediaBuffer(pdfWithText('Searchable PDF phrase'), {
      bucket: 'outbound', originalFilename: 'Report.pdf', contentType: 'application/pdf',
    });
    const outcome: TurnOutcome = {
      version: 1, outcomeId: 'pdf', turnId: 'turn', runId: 'turn', status: 'succeeded',
      deliverables: [{ artifactId: file.id, title: 'Report.pdf', kind: 'pdf', uri: file.uri,
        location: 'artifact_store', availability: 'available', sizeBytes: file.size, capabilities: ['preview', 'download'] }],
      evidence: [], createdAt: new Date().toISOString(),
    };
    appendTranscriptEntry(conversationId, { type: 'custom', customType: 'turn_outcome', data: outcome, timestamp: new Date().toISOString() });
    getSqliteDatabase().prepare("UPDATE space_versions SET index_status = 'failed'").run();
    worker = new SpaceWorker();
    worker.start();
    await vi.waitFor(() => {
      expect(listSpaceItems({ view: 'all', q: 'Searchable PDF phrase' }).items[0]?.hit?.locator).toEqual({ kind: 'page', page: 1 });
    }, { timeout: 10_000, interval: 100 });
  });

  it('saves the selected reply idempotently and keeps task versions readable', async () => {
    const reply = appendTranscriptEntry(conversationId, {
      role: 'assistant', content: [{ type: 'text', text: '# Follow-up\n\nDraft' }], timestamp: Date.now(),
    } as Parameters<typeof appendTranscriptEntry>[1]);
    const id = saveSpaceReply(conversationId, reply.entry_id);
    expect(id).toBeTruthy();
    expect(saveSpaceReply(conversationId, reply.entry_id)).toBe(id);
    expect(saveSpaceReply(randomUUID(), reply.entry_id)).toBeNull();
    const delivery: TaskResultDelivery = {
      version: 1, deliveryId: 'delivery-one', taskId: 'task', taskRunId: 'run-one', taskTitle: 'Review',
      conversationId, originTranscriptId: reply.transcript_id, assignmentEpoch: 0, resultRevision: 1, createdAt: 1,
      outcome: { version: 1, outcomeId: 'outcome', turnId: 'turn', runId: 'turn', status: 'succeeded',
        deliverables: [], evidence: [], createdAt: new Date(1).toISOString() },
      text: 'First report',
    };
    archiveSpaceTaskDelivery(getSqliteDatabase(), delivery);
    const latest = { ...delivery, deliveryId: 'delivery-three', resultRevision: 3, createdAt: 3 };
    archiveSpaceTaskDelivery(getSqliteDatabase(), latest);
    archiveSpaceTaskDelivery(getSqliteDatabase(), { ...delivery, deliveryId: 'delivery-two', resultRevision: 2, createdAt: 2, text: 'Second report' });
    archiveSpaceTaskDelivery(getSqliteDatabase(), latest);
    const item = listSpaceItems({ view: 'all', taskId: 'task' }).items[0];
    const detail = getSpaceItem(item.id)!;
    expect(detail.versions.map(version => version.createdAt)).toEqual([3, 2, 1]);
    expect(detail.currentVersion.id).toBe(detail.versions[0].id);
    expect(findSpaceTaskDelivery('delivery-three')?.versionId).toBe(detail.currentVersion.id);
    expect(await new Response((await readSpaceContent(item.id, detail.versions[1].id))!.body).text()).toBe('Second report');
  });
});
