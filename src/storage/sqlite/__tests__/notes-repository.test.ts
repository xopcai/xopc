import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Note } from '../../../notes/types.js';
import {
  completeDiscussionOrganization,
  createDiscussionCapture,
  createDiscussionOrganization,
  updateDiscussionCapture,
} from '../../../discussions/repository.js';
import {
  closeXopcDatabase,
  deleteNoteRecord,
  getNoteRecord,
  listNoteBacklinks,
  listNoteRecords,
  listNoteTagSummaries,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  syncNoteDiscussionIndex,
  upsertNoteRecord,
} from '../index.js';

describe('sqlite notes repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-notes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('stores notes and supports FTS search', () => {
    const note: Note = {
      id: 'note-1',
      kind: 'thought',
      status: 'inbox',
      markdown: '# Heading\nunique-alpha-keyword in body\n- [ ] todo\n- [x] done\n[[related]]',
      createdAt: 100,
      updatedAt: 100,
      capturedVia: { channel: 'web' },
      tags: ['work'],
    };
    upsertNoteRecord(note);

    expect(getNoteRecord('note-1')?.markdown).toContain('unique-alpha-keyword');
    const listed = listNoteRecords({ search: 'unique-alpha-keyword' });
    expect(listed.items.map((item) => item.id)).toEqual(['note-1']);
    expect(listed.items[0]).toMatchObject({
      headingCount: 1,
      taskCount: 2,
      uncheckedTaskCount: 1,
      linkCount: 1,
    });
    expect(deleteNoteRecord('note-1')).toBe(true);
    expect(getNoteRecord('note-1')).toBeNull();
  });

  it('excludes archived and trashed notes by default and sorts pinned notes first', () => {
    upsertNoteRecord({
      id: 'note-older-pinned',
      kind: 'thought',
      status: 'inbox',
      pinned: true,
      markdown: 'Pinned note',
      createdAt: 100,
      updatedAt: 100,
      capturedVia: { channel: 'web' },
    });
    upsertNoteRecord({
      id: 'note-newer-unpinned',
      kind: 'thought',
      status: 'processed',
      markdown: 'Newer unpinned note',
      createdAt: 200,
      updatedAt: 300,
      capturedVia: { channel: 'web' },
    });
    upsertNoteRecord({
      id: 'note-archived',
      kind: 'thought',
      status: 'archived',
      markdown: 'Archived note',
      createdAt: 400,
      updatedAt: 400,
      capturedVia: { channel: 'web' },
    });
    upsertNoteRecord({
      id: 'note-trashed',
      kind: 'thought',
      status: 'trashed',
      markdown: 'Trashed note',
      createdAt: 500,
      updatedAt: 500,
      capturedVia: { channel: 'web' },
    });

    const defaultList = listNoteRecords();
    expect(defaultList.items.map((item) => item.id)).toEqual([
      'note-older-pinned',
      'note-newer-unpinned',
    ]);
    expect(listNoteRecords({ status: 'archived' }).items.map((item) => item.id)).toEqual(['note-archived']);
    expect(listNoteRecords({ status: 'trashed' }).items.map((item) => item.id)).toEqual(['note-trashed']);
  });

  it('projects discussion summary, duration, and FTS/CJK search onto voice notes', () => {
    upsertNoteRecord({
      id: 'voice-note-1',
      title: 'Q4 架构评审',
      kind: 'voice',
      status: 'processed',
      markdown: '',
      createdAt: 100,
      updatedAt: 200,
      capturedVia: { channel: 'web' },
    });
    createDiscussionCapture({
      id: 'disc-1',
      clientRequestId: 'req-1',
      noteId: 'voice-note-1',
      source: 'web',
      status: 'recording',
      transcriptRevision: 1,
      recordingStartedAt: 100,
      createdAt: 100,
      updatedAt: 100,
    });
    updateDiscussionCapture('disc-1', {
      status: 'completed',
      durationMs: 125_000,
      audioAttachmentId: 'att-audio-1',
      canonicalTranscript: '[00:00-00:10] 我们决定采用 SQLite WAL 双索引架构。',
    });
    const orgRecord = createDiscussionOrganization({
      discussionId: 'disc-1',
      inputTranscriptSha256: 'sha-1',
      promptVersion: 'v1',
      modelRef: 'test/model',
      transcriptRevision: 2,
    });
    completeDiscussionOrganization(orgRecord.id, {
      title: 'Q4 架构评审纪要',
      summary: '确定了笔记与妙记双索引融合方案。',
      keyPoints: ['统一 FTS5 索引'],
      decisions: [{ id: 'd-1', text: '下周上线灰度环境' }],
      actionItems: [{ id: 'act-1', title: '补齐迁移脚本', owner: 'Alice' }],
      risks: [],
      openQuestions: [],
    });

    syncNoteDiscussionIndex('voice-note-1');

    const listed = listNoteRecords();
    expect(listed.items[0]).toMatchObject({
      id: 'voice-note-1',
      snippet: '确定了笔记与妙记双索引融合方案。',
      voiceDurationSec: 125,
    });
    expect(listNoteRecords({ search: '双索引架构' }).items.map((item) => item.id)).toEqual(['voice-note-1']);
    expect(listNoteRecords({ search: '灰度环境' }).items.map((item) => item.id)).toEqual(['voice-note-1']);
  });

  it('aggregates active tag summaries and resolves note backlinks from xopc:// and [[wiki]] links', () => {
    upsertNoteRecord({
      id: 'target-note',
      title: '产品路线图',
      kind: 'thought',
      status: 'processed',
      markdown: '# 产品路线图',
      tags: ['roadmap', 'q4'],
      createdAt: 100,
      updatedAt: 200,
      capturedVia: { channel: 'web' },
    });
    upsertNoteRecord({
      id: 'source-uri-note',
      title: '周会纪要',
      kind: 'thought',
      status: 'inbox',
      markdown: '参见 [产品路线图](xopc://open?kind=note&id=target-note) 的里程碑。',
      tags: ['roadmap', 'meeting'],
      createdAt: 150,
      updatedAt: 300,
      capturedVia: { channel: 'web' },
    });
    upsertNoteRecord({
      id: 'source-wiki-note',
      title: '研发排期',
      kind: 'thought',
      status: 'inbox',
      markdown: '对齐 [[产品路线图]] 中的发布窗口。',
      tags: ['engineering'],
      createdAt: 180,
      updatedAt: 400,
      capturedVia: { channel: 'web' },
    });
    upsertNoteRecord({
      id: 'trashed-ref-note',
      title: '已删除草稿',
      kind: 'thought',
      status: 'trashed',
      markdown: '[[产品路线图]]',
      tags: ['roadmap'],
      createdAt: 190,
      updatedAt: 500,
      capturedVia: { channel: 'web' },
    });

    const tagSummaries = listNoteTagSummaries();
    expect(tagSummaries[0]).toMatchObject({ tag: 'roadmap', noteCount: 2 });
    expect(tagSummaries.map((item) => item.tag)).toEqual(
      expect.arrayContaining(['roadmap', 'engineering', 'meeting', 'q4']),
    );

    const backlinks = listNoteBacklinks('target-note');
    expect(backlinks.map((item) => item.id)).toEqual(['source-wiki-note', 'source-uri-note']);
  });

  it('includes regular notes containing embedded audio clips under the recordings filter', () => {
    upsertNoteRecord({
      id: 'plain-text-note',
      title: '纯文本笔记',
      kind: 'thought',
      status: 'inbox',
      markdown: '没有音频附件',
      createdAt: 100,
      updatedAt: 100,
      capturedVia: { channel: 'web' },
    });
    upsertNoteRecord({
      id: 'inline-audio-note',
      title: '带内联音频片段的笔记',
      kind: 'thought',
      status: 'inbox',
      markdown: '正文里插入了一段录音 [音频片段](xopc-attachment://notes/inline-audio-note/clip-1)',
      attachments: [
        {
          id: 'clip-1',
          type: 'audio',
          fileName: 'clip-1.webm',
          filePath: '/tmp/clip-1.webm',
          mimeType: 'audio/webm',
          size: 4096,
          duration: 18,
          createdAt: 150,
        },
      ],
      createdAt: 150,
      updatedAt: 200,
      capturedVia: { channel: 'web' },
    });
    upsertNoteRecord({
      id: 'full-voice-note',
      title: '完整录音笔记',
      kind: 'voice',
      status: 'inbox',
      markdown: '',
      createdAt: 200,
      updatedAt: 300,
      capturedVia: { channel: 'web' },
    });

    const recordings = listNoteRecords({ kind: 'voice', sortBy: 'updatedAt', sortOrder: 'desc' });
    expect(recordings.items.map((item) => item.id)).toEqual(['full-voice-note', 'inline-audio-note']);
  });
});
