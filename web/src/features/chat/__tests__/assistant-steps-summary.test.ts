import { describe, expect, it } from 'vitest';

import {
  buildStepsRoundCompleteSummary,
  buildStepsRoundStreamingSummary,
} from '@/features/chat/messages/assistant-steps-summary';
import type {
  StepsClusterDoneLabels,
  StepsClusterIngLabels,
  StepsClusterJoinLabels,
} from '@/features/chat/messages/tool-action-cluster';
import type { ThinkingContent, ToolUseContent } from '@/features/chat/messages/messages.types';

const doneZh: StepsClusterDoneLabels = {
  search_one: '搜索了网页',
  search_other: '搜索了 {{count}} 次网页',
  readFile_one: '读了 1 个文件',
  readFile_other: '读了 {{count}} 个文件',
  editFile_one: '改了 1 个文件',
  editFile_other: '改了 {{count}} 个文件',
  writeFile_one: '保存了 1 个文件',
  writeFile_other: '保存了 {{count}} 个文件',
  runCommand_one: '运行了 1 个命令',
  runCommand_other: '运行了 {{count}} 个命令',
  listDir_one: '查看了 1 个文件夹',
  listDir_other: '查看了 {{count}} 个文件夹',
  openUrl_one: '打开了 1 个链接',
  openUrl_other: '打开了 {{count}} 个链接',
  fetchUrl_one: '抓取了 1 个网页',
  fetchUrl_other: '抓取了 {{count}} 个网页',
  other_one: '执行了 1 个工具',
  other_other: '执行了 {{count}} 个工具',
};

const ingZh: StepsClusterIngLabels = {
  thinking: '正在思考…',
  search: '正在搜索网页…',
  readFile: '正在阅读文件…',
  editFile: '正在修改文件…',
  writeFile: '正在保存文件…',
  runCommand: '正在运行命令…',
  listDir: '正在查看文件夹…',
  openUrl: '正在打开链接…',
  fetchUrl: '正在抓取网页…',
  other: '正在处理…',
  mixed: '正在为你处理…',
};

const joinZh: StepsClusterJoinLabels = {
  join: '，',
  joinFinal: '和',
  moreSuffix: ' 等',
};

describe('buildStepsRoundCompleteSummary', () => {
  it('keeps the rich "title: detail" format for a single search call (zh)', () => {
    const blocks: Array<ThinkingContent | ToolUseContent> = [
      { type: 'thinking', text: '…' },
      {
        type: 'tool_use',
        id: '1',
        name: 'web_search',
        status: 'done',
        input: JSON.stringify({ query: '我的世界老玩家 坐电梯 梗 抖音 B站' }),
      },
    ];
    const s = buildStepsRoundCompleteSummary(blocks, doneZh, joinZh, 'zh', '查看 1 步');
    expect(s).toContain('搜索了网页');
    expect(s).toContain('我的世界老玩家');
  });

  it('aggregates multi-call multi-cluster rounds (zh)', () => {
    const blocks: Array<ThinkingContent | ToolUseContent> = [
      { type: 'tool_use', id: '1', name: 'read_file', status: 'done', input: { path: 'a.ts' } },
      { type: 'tool_use', id: '2', name: 'read_file', status: 'done', input: { path: 'b.ts' } },
      { type: 'tool_use', id: '3', name: 'edit_file', status: 'done', input: { path: 'c.ts' } },
    ];
    const s = buildStepsRoundCompleteSummary(blocks, doneZh, joinZh, 'zh', '查看 3 步');
    expect(s).toBe('读了 2 个文件和改了 1 个文件');
  });

  it('uses noToolFallback when no tools are present', () => {
    const blocks: Array<ThinkingContent | ToolUseContent> = [
      { type: 'thinking', text: 'only thoughts', streaming: false },
    ];
    expect(buildStepsRoundCompleteSummary(blocks, doneZh, joinZh, 'zh', '查看 1 步')).toBe(
      '查看 1 步',
    );
  });
});

describe('buildStepsRoundStreamingSummary', () => {
  it('returns the progressive label for the running cluster', () => {
    const s = buildStepsRoundStreamingSummary(
      [
        { type: 'tool_use', id: '1', name: 'read_file', status: 'running', input: { path: 'a.ts' } },
      ],
      ingZh,
    );
    expect(s).toBe('正在阅读文件…');
  });

  it('returns the thinking label when only streaming thinking is in flight', () => {
    const s = buildStepsRoundStreamingSummary(
      [{ type: 'thinking', text: '…', streaming: true }],
      ingZh,
    );
    expect(s).toBe('正在思考…');
  });

  it('returns null when nothing is in flight (caller falls back to legacy header)', () => {
    expect(buildStepsRoundStreamingSummary([], ingZh)).toBeNull();
  });
});
