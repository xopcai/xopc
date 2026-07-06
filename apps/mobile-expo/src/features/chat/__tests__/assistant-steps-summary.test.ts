import { describe, expect, it } from 'vitest';

import { buildStepsRoundActiveSummary, buildStepsRoundCompleteSummary, viewStepsLabel } from '../assistant-steps-summary';
import type { ThinkingContent, ToolUseContent } from '../messages.types';
import { getFriendlyToolTitle } from '../tool-friendly-title';

const labels = {
  searchedWeb: '搜索网页',
  readFile: '读取文件',
  runCommand: '运行命令',
  listDirectory: '查看文件夹',
  writeFile: '保存文件',
  editFile: '修改文件',
  openUrl: '打开链接',
  fetchUrl: '获取网页',
  unknownTool: '执行：{{name}}',
};

describe('buildStepsRoundCompleteSummary', () => {
  it('shows first web search title and query only (zh)', () => {
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
    const s = buildStepsRoundCompleteSummary(blocks, labels, 'zh', '查看 1 步');
    expect(s).not.toContain('已完成');
    expect(s).toContain('搜索网页');
    expect(s).toContain('我的世界老玩家');
  });

  it('summarizes active running tool', () => {
    const blocks: Array<ThinkingContent | ToolUseContent> = [
      { type: 'thinking', text: '', streaming: true },
      {
        type: 'tool_use',
        id: '1',
        name: 'web_search',
        status: 'running',
        input: JSON.stringify({ query: 'top 命令' }),
      },
    ];

    const s = buildStepsRoundActiveSummary(blocks, labels, 'zh', '查看 2 步');
    expect(s).toContain('正在搜索网页');
    expect(s).toContain('top 命令');
  });

  it('uses noToolFallback when no tools', () => {
    const blocks: Array<ThinkingContent | ToolUseContent> = [
      { type: 'thinking', text: 'only thoughts', streaming: false },
    ];
    expect(buildStepsRoundCompleteSummary(blocks, labels, 'zh', '查看 1 步')).toBe('查看 1 步');
  });
});

describe('viewStepsLabel', () => {
  it('interpolates count for singular and plural', () => {
    expect(viewStepsLabel(1, { viewSteps_one: 'View {{count}} step', viewSteps_other: 'View {{count}} steps' })).toBe(
      'View 1 step',
    );
    expect(viewStepsLabel(3, { viewSteps_one: 'View {{count}} step', viewSteps_other: 'View {{count}} steps' })).toBe(
      'View 3 steps',
    );
  });
});

describe('getFriendlyToolTitle', () => {
  it('maps known tool names to friendly labels', () => {
    expect(getFriendlyToolTitle('web_search', labels)).toBe('搜索网页');
    expect(getFriendlyToolTitle('read_file', labels)).toBe('读取文件');
    expect(getFriendlyToolTitle('shell', labels)).toBe('运行命令');
  });

  it('falls back to unknownTool template', () => {
    expect(getFriendlyToolTitle('custom_tool', labels)).toBe('执行：custom_tool');
  });
});
