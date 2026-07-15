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

const doneEn: StepsClusterDoneLabels = {
  search_one: 'Searched the web',
  search_other: 'Searched the web {{count}} times',
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
    expect(classifyTool('codebase-memory-mcp.get_code_snippet')).toBe('readFile');
    expect(classifyTool('codebase-memory-mcp__get_code_snippet')).toBe('readFile');
    expect(classifyTool('review.prepare_diff')).toBe('readFile');
    expect(classifyTool('apply_patch')).toBe('editFile');
    expect(classifyTool('write_file')).toBe('writeFile');
    expect(classifyTool('web_fetch')).toBe('fetchUrl');
    expect(classifyTool('open_url')).toBe('openUrl');
    expect(classifyTool('web_search')).toBe('search');
    expect(classifyTool('brave_search')).toBe('search');
    expect(classifyTool('codebase-memory-mcp.search_graph')).toBe('search');
    expect(classifyTool('codebase-memory-mcp__query_graph')).toBe('search');
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
