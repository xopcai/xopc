import { describe, expect, it } from 'vitest';

import { buildStepsRoundStreamingSummary } from '@/features/chat/messages/assistant-steps-summary';
import type { StepsClusterIngLabels } from '@/features/chat/messages/tool-action-cluster';

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

  it('returns null when nothing is in flight', () => {
    expect(buildStepsRoundStreamingSummary([], ingZh)).toBeNull();
  });
});
