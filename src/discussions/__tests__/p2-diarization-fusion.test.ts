import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stateDir: '',
  complete: vi.fn(),
}));

vi.mock('../../config/paths.js', () => ({
  resolveStateDir: () => mocks.stateDir,
}));

vi.mock('../../config/schema.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/schema.js')>();
  return {
    ...actual,
    getAgentDefaultModelRef: () => 'openai/gpt-4o-mini',
  };
});

vi.mock('../../providers/index.js', () => ({
  resolveModel: () => ({ id: 'gpt-4o-mini', provider: 'openai' }),
}));

vi.mock('../../providers/model-call.js', () => ({
  completeWithResolvedCredentials: (...args: unknown[]) => mocks.complete(...args),
}));

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertNoteRecord,
} from '../../storage/sqlite/index.js';
import { analyzeDiscussion } from '../analyzer.js';
import {
  diarizeDiscussionSegments,
  inferHeuristicSpeakerLabels,
  normalizeProviderSpeakerLabel,
} from '../diarization.js';
import { createDiscussionCapture, listDiscussionTranscriptSegments } from '../repository.js';
import { replaceTranscriptSegments } from '../revisions.js';
import {
  buildHotwordsPrompt,
  normalizeHotwords,
  readDiscussionVocabulary,
  updateDiscussionVocabulary,
} from '../vocabulary.js';

describe('P2 hotwords, speaker diarization, and Granola outline fusion', () => {
  beforeEach(() => {
    mocks.stateDir = mkdtempSync(join(tmpdir(), 'xopc-p2-disc-'));
    mocks.complete.mockReset();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(mocks.stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(mocks.stateDir, { recursive: true, force: true });
  });

  it('persists deduplicated hotwords and builds STT prompt hints', () => {
    expect(normalizeHotwords('xopc, 妙记，xopc\nSQLite WAL；王敏')).toEqual([
      'xopc',
      '妙记',
      'SQLite WAL',
      '王敏',
    ]);
    const saved = updateDiscussionVocabulary({
      hotwords: 'xopc, 妙记, 王敏',
      diarizationEnabled: true,
    });
    expect(saved.hotwords).toEqual(['xopc', '妙记', '王敏']);
    expect(readDiscussionVocabulary().hotwords).toEqual(['xopc', '妙记', '王敏']);
    expect(buildHotwordsPrompt()).toContain('xopc、妙记、王敏');
  });

  it('normalizes provider speaker IDs and attributes speaker turns while preserving manual edits', async () => {
    expect(normalizeProviderSpeakerLabel('1:1:SPEAKER_00', true)).toBe('说话人 1');
    expect(normalizeProviderSpeakerLabel('SPEAKER_01', false)).toBe('Speaker 2');

    upsertNoteRecord({
      id: 'note-diarize',
      title: '评审录音',
      kind: 'voice',
      status: 'inbox',
      markdown: '',
      createdAt: 100,
      updatedAt: 100,
      capturedVia: { channel: 'web' },
    });
    createDiscussionCapture({
      id: 'disc-diarize',
      clientRequestId: 'req-diarize',
      noteId: 'note-diarize',
      source: 'web',
      status: 'organizing',
      transcriptRevision: 1,
      recordingStartedAt: 100,
      createdAt: 100,
      updatedAt: 100,
    });
    replaceTranscriptSegments('disc-diarize', [
      { text: '大家好，我是李雷，负责网关改造，今天对齐发布窗口？', startedAtMs: 0, endedAtMs: 4_000 },
      { text: '没问题，我是韩梅，前端联调这周四可以完成。', startedAtMs: 6_000, endedAtMs: 10_000 },
      { text: '人工校对过的段落', startedAtMs: 12_000, endedAtMs: 15_000, speakerLabel: '主持人', correctedByUser: true },
    ]);

    const segments = listDiscussionTranscriptSegments('disc-diarize');
    const heuristic = inferHeuristicSpeakerLabels(segments, true);
    expect(heuristic.get(0)).toBe('李雷');
    expect(heuristic.get(1)).toBe('韩梅');

    const updatedCount = await diarizeDiscussionSegments({
      discussionId: 'disc-diarize',
      segments,
      useModel: false,
    });
    expect(updatedCount).toBe(2);

    const after = listDiscussionTranscriptSegments('disc-diarize');
    expect(after.map((s) => s.speakerLabel)).toEqual(['李雷', '韩梅', '主持人']);
  });

  it('fuses personal outline notes and hotwords into analyzeDiscussion while validating evidence IDs', async () => {
    upsertNoteRecord({
      id: 'note-fusion',
      title: '产品周会',
      kind: 'voice',
      status: 'inbox',
      markdown: '- 关注 Q4 预算上限\n- 灰度上线日期？',
      createdAt: 100,
      updatedAt: 100,
      capturedVia: { channel: 'web' },
    });
    createDiscussionCapture({
      id: 'disc-fusion',
      clientRequestId: 'req-fusion',
      noteId: 'note-fusion',
      source: 'web',
      status: 'organizing',
      transcriptRevision: 1,
      recordingStartedAt: 100,
      createdAt: 100,
      updatedAt: 100,
    });
    replaceTranscriptSegments('disc-fusion', [
      { text: 'Q4 预算上限最终定在 50 万，下周三启动灰度。', startedAtMs: 0, endedAtMs: 5_000 },
    ]);

    mocks.complete.mockResolvedValueOnce({
      stopReason: 'stop',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: 'Q4 预算与灰度排期纪要',
            summary: '围绕个人提纲确认了 Q4 预算上限 50 万及下周三灰度计划。',
            summaryEvidenceSegmentIds: [0],
            keyPoints: [{ text: 'Q4 预算上限 50 万', evidenceSegmentIds: [0] }],
            decisions: [{ text: '下周三启动灰度上线', evidenceSegmentIds: [0] }],
            actionItems: [],
            risks: [],
            openQuestions: [],
          }),
        },
      ],
    });

    const result = await analyzeDiscussion({
      config: {} as never,
      discussionId: 'disc-fusion',
      transcript: 'Q4 预算上限最终定在 50 万，下周三启动灰度。',
      segments: listDiscussionTranscriptSegments('disc-fusion'),
      personalNotesMarkdown: '- 关注 Q4 预算上限\n- 灰度上线日期？',
      hotwords: ['Q4', '灰度上线'],
    });

    expect(mocks.complete).toHaveBeenCalledTimes(1);
    const callPayload = mocks.complete.mock.calls[0]![1] as {
      systemPrompt: string;
      messages: Array<{ content: string }>;
    };
    expect(callPayload.systemPrompt).toContain('userOutline');
    expect(callPayload.systemPrompt).toContain('灰度上线');
    expect(callPayload.messages[0]!.content).toContain('关注 Q4 预算上限');
    expect(result.organization.title).toBe('Q4 预算与灰度排期纪要');
    expect(result.organization.decisions[0]?.text).toBe('下周三启动灰度上线');
  });
});
