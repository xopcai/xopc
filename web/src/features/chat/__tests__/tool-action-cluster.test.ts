import { describe, expect, it } from 'vitest';

import {
  classifyTool,
  clusterToolUses,
  summarizeClustersCompleted,
  summarizeClustersStreaming,
  type StepsClusterDoneLabels,
  type StepsClusterIngLabels,
  type StepsClusterJoinLabels,
} from '@/features/chat/messages/tool-action-cluster';
import type { ThinkingContent, ToolUseContent } from '@/features/chat/messages/messages.types';

const doneZh: StepsClusterDoneLabels = {
  webSearch_one: '搜索了网页',
  webSearch_other: '搜索了 {{count}} 次网页',
  memorySearch_one: '查找了记忆',
  memorySearch_other: '查找了 {{count}} 次记忆',
  codeSearch_one: '检索了代码库',
  codeSearch_other: '检索了 {{count}} 次代码库',
  search_one: '搜索了信息',
  search_other: '搜索了 {{count}} 次信息',
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
  webSearch: '正在搜索网页…',
  memorySearch: '正在查找记忆…',
  codeSearch: '正在检索代码库…',
  search: '正在搜索信息…',
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

const doneEn: StepsClusterDoneLabels = {
  webSearch_one: 'Searched the web',
  webSearch_other: 'Searched the web {{count}} times',
  memorySearch_one: 'Searched memory',
  memorySearch_other: 'Searched memory {{count}} times',
  codeSearch_one: 'Searched the codebase',
  codeSearch_other: 'Searched the codebase {{count}} times',
  search_one: 'Searched',
  search_other: 'Searched {{count}} times',
  readFile_one: 'Read 1 file',
  readFile_other: 'Read {{count}} files',
  editFile_one: 'Edited 1 file',
  editFile_other: 'Edited {{count}} files',
  writeFile_one: 'Saved 1 file',
  writeFile_other: 'Saved {{count}} files',
  runCommand_one: 'Ran 1 command',
  runCommand_other: 'Ran {{count}} commands',
  listDir_one: 'Browsed 1 folder',
  listDir_other: 'Browsed {{count}} folders',
  openUrl_one: 'Opened 1 link',
  openUrl_other: 'Opened {{count}} links',
  fetchUrl_one: 'Fetched 1 page',
  fetchUrl_other: 'Fetched {{count}} pages',
  other_one: 'Ran 1 tool',
  other_other: 'Ran {{count}} tools',
};

const joinEn: StepsClusterJoinLabels = {
  join: ', ',
  joinFinal: ' and ',
  moreSuffix: ' and more',
};

const tool = (
  id: string,
  name: string,
  input: unknown = undefined,
  status: ToolUseContent['status'] = 'done',
): ToolUseContent => ({ type: 'tool_use', id, name, input, status });

const thought = (text: string, streaming = false): ThinkingContent => ({
  type: 'thinking',
  text,
  streaming,
});

describe('classifyTool', () => {
  it('maps known tool names to action kinds', () => {
    expect(classifyTool('exec_command')).toBe('runCommand');
    expect(classifyTool('Exec_Command')).toBe('runCommand');
    expect(classifyTool('list_dir')).toBe('listDir');
    expect(classifyTool('ls')).toBe('listDir');
    expect(classifyTool('read_file')).toBe('readFile');
    expect(classifyTool('fs.read_file')).toBe('readFile');
    expect(classifyTool('review.prepare_diff')).toBe('readFile');
    expect(classifyTool('apply_patch')).toBe('editFile');
    expect(classifyTool('write_file')).toBe('writeFile');
    expect(classifyTool('web_fetch')).toBe('fetchUrl');
    expect(classifyTool('open_url')).toBe('openUrl');
    expect(classifyTool('web_search')).toBe('webSearch');
    expect(classifyTool('brave_search')).toBe('webSearch');
    expect(classifyTool('memory_search')).toBe('memorySearch');
    expect(classifyTool('grep')).toBe('codeSearch');
    expect(classifyTool('review.model_judge')).toBe('other');
    expect(classifyTool('mystery_tool')).toBe('other');
  });
});

describe('clusterToolUses', () => {
  it('counts totals and running per kind', () => {
    const map = clusterToolUses([
      tool('1', 'read_file'),
      tool('2', 'read_file'),
      tool('3', 'apply_patch', undefined, 'running'),
      thought('skip me'),
    ]);
    expect(map.get('readFile')).toEqual({ total: 2, running: 0 });
    expect(map.get('editFile')).toEqual({ total: 1, running: 1 });
    expect(map.has('other')).toBe(false);
  });
});

describe('summarizeClustersCompleted', () => {
  it('preserves the "title: detail" preview for a single search call (zh)', () => {
    const s = summarizeClustersCompleted(
      [tool('1', 'web_search', { query: '我的世界老玩家 坐电梯 梗' })],
      doneZh,
      joinZh,
      'zh',
    );
    expect(s).toContain('搜索了网页');
    expect(s).toContain('我的世界老玩家');
    expect(s).toMatch(/：/);
  });

  it('describes memory lookup without exposing its raw query (zh)', () => {
    const s = summarizeClustersCompleted(
      [tool('1', 'memory_search', { query: '用户背景与偏好' })],
      doneZh,
      joinZh,
      'zh',
    );
    expect(s).toBe('查找了记忆');
    expect(s).not.toContain('网页');
    expect(s).not.toContain('用户背景与偏好');
  });

  it('preserves single-file path for a single read call (en)', () => {
    const s = summarizeClustersCompleted(
      [tool('1', 'read_file', { path: 'src/foo.ts' })],
      doneEn,
      joinEn,
      'en',
    );
    expect(s).toBe('Read 1 file: src/foo.ts');
  });

  it('aggregates multiple calls of the same kind (zh)', () => {
    const s = summarizeClustersCompleted(
      [
        tool('1', 'read_file', { path: 'a.ts' }),
        tool('2', 'read_file', { path: 'b.ts' }),
        tool('3', 'read_file', { path: 'c.ts' }),
      ],
      doneZh,
      joinZh,
      'zh',
    );
    expect(s).toBe('读了 3 个文件');
  });

  it('joins two clusters with the language-specific final connector (zh)', () => {
    const s = summarizeClustersCompleted(
      [
        tool('1', 'read_file', { path: 'a.ts' }),
        tool('2', 'read_file', { path: 'b.ts' }),
        tool('3', 'apply_patch', { path: 'c.ts' }),
      ],
      doneZh,
      joinZh,
      'zh',
    );
    expect(s).toBe('读了 2 个文件和改了 1 个文件');
  });

  it('joins two clusters with " and " (en)', () => {
    const s = summarizeClustersCompleted(
      [
        tool('1', 'read_file', { path: 'a.ts' }),
        tool('2', 'apply_patch', { path: 'b.ts' }),
      ],
      doneEn,
      joinEn,
      'en',
    );
    expect(s).toBe('Read 1 file and Edited 1 file');
  });

  it('caps at three clusters and appends a "more" suffix (zh)', () => {
    const s = summarizeClustersCompleted(
      [
        tool('1', 'read_file'),
        tool('2', 'apply_patch'),
        tool('3', 'exec_command'),
        tool('4', 'web_fetch'),
        tool('5', 'web_search'),
      ],
      doneZh,
      joinZh,
      'zh',
    );
    expect(s).not.toBeNull();
    const line = s as string;
    expect(line.startsWith('读了 1 个文件')).toBe(true);
    expect(line.endsWith(' 等')).toBe(true);
    // Three head phrases + " 等"
    expect(line.split('，').length + line.split('和').length).toBeGreaterThan(2);
  });

  it('returns null when there are no tool uses', () => {
    expect(
      summarizeClustersCompleted([thought('only thoughts')], doneZh, joinZh, 'zh'),
    ).toBeNull();
  });

  it('falls back to the unknown-tool phrasing when classifier yields "other"', () => {
    const s = summarizeClustersCompleted([tool('1', 'mystery_tool')], doneZh, joinZh, 'zh');
    // Single "other" with no input shows "执行了 1 个工具" via the aggregate path
    // because singleToolDetailLine returns null on an empty input.
    expect(s).toBe('执行了 1 个工具');
  });
});

describe('summarizeClustersStreaming', () => {
  it('returns the progressive label for a single running cluster', () => {
    const s = summarizeClustersStreaming(
      [tool('1', 'read_file', { path: 'a.ts' }, 'running')],
      ingZh,
    );
    expect(s).toBe('正在阅读文件…');
  });

  it('returns "mixed" when multiple kinds are running in parallel', () => {
    const s = summarizeClustersStreaming(
      [
        tool('1', 'read_file', undefined, 'running'),
        tool('2', 'apply_patch', undefined, 'running'),
      ],
      ingZh,
    );
    expect(s).toBe('正在为你处理…');
  });

  it('returns "thinking" when only streaming thinking is in flight', () => {
    const s = summarizeClustersStreaming([thought('…', true)], ingZh);
    expect(s).toBe('正在思考…');
  });

  it('returns "mixed" when tools have finished but nothing is currently running', () => {
    const s = summarizeClustersStreaming([tool('1', 'read_file')], ingZh);
    expect(s).toBe('正在为你处理…');
  });

  it('returns null when there is nothing in flight or completed', () => {
    expect(summarizeClustersStreaming([], ingZh)).toBeNull();
  });
});
