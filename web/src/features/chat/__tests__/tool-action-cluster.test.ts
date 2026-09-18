import { describe, expect, it } from 'vitest';

import {
  classifyTool,
  clusterToolUses,
  summarizeClustersStreaming,
  type StepsClusterIngLabels,
} from '@/features/chat/messages/tool-action-cluster';
import type { ThinkingContent, ToolUseContent } from '@/features/chat/messages/messages.types';

const ingZh: StepsClusterIngLabels = {
  thinking: '正在思考…', webSearch: '正在搜索网页…', memorySearch: '正在查找记忆…',
  codeSearch: '正在检索代码库…', search: '正在搜索信息…', readFile: '正在阅读文件…',
  editFile: '正在修改文件…', writeFile: '正在保存文件…', runCommand: '正在运行命令…',
  listDir: '正在查看文件夹…', openUrl: '正在打开链接…', fetchUrl: '正在抓取网页…',
  other: '正在处理…', mixed: '正在为你处理…',
};

const tool = (
  id: string,
  name: string,
  status: ToolUseContent['status'] = 'done',
): ToolUseContent => ({ type: 'tool_use', id, name, status });

const thought = (text: string, streaming = false): ThinkingContent => ({
  type: 'thinking', text, streaming,
});

describe('classifyTool', () => {
  it('maps known tool names to action kinds', () => {
    expect(classifyTool('exec_command')).toBe('runCommand');
    expect(classifyTool('list_dir')).toBe('listDir');
    expect(classifyTool('read_file')).toBe('readFile');
    expect(classifyTool('apply_patch')).toBe('editFile');
    expect(classifyTool('write_file')).toBe('writeFile');
    expect(classifyTool('web_fetch')).toBe('fetchUrl');
    expect(classifyTool('open_url')).toBe('openUrl');
    expect(classifyTool('web_search')).toBe('webSearch');
    expect(classifyTool('memory_search')).toBe('memorySearch');
    expect(classifyTool('grep')).toBe('codeSearch');
    expect(classifyTool('mystery_tool')).toBe('other');
  });
});

describe('clusterToolUses', () => {
  it('counts totals and running tools by kind', () => {
    const map = clusterToolUses([
      tool('1', 'read_file'),
      tool('2', 'read_file'),
      tool('3', 'apply_patch', 'running'),
      thought('skip me'),
    ]);
    expect(map.get('readFile')).toEqual({ total: 2, running: 0 });
    expect(map.get('editFile')).toEqual({ total: 1, running: 1 });
  });
});

describe('summarizeClustersStreaming', () => {
  it('returns the progressive label for a single running cluster', () => {
    expect(summarizeClustersStreaming([tool('1', 'read_file', 'running')], ingZh))
      .toBe('正在阅读文件…');
  });

  it('returns the mixed label for parallel work', () => {
    expect(summarizeClustersStreaming([
      tool('1', 'read_file', 'running'),
      tool('2', 'apply_patch', 'running'),
    ], ingZh)).toBe('正在为你处理…');
  });

  it('falls back to thinking, idle work, or no label', () => {
    expect(summarizeClustersStreaming([thought('…', true)], ingZh)).toBe('正在思考…');
    expect(summarizeClustersStreaming([tool('1', 'read_file')], ingZh)).toBe('正在为你处理…');
    expect(summarizeClustersStreaming([], ingZh)).toBeNull();
  });
});
