import { describe, expect, it } from 'vitest';

import { buildStepsRoundCompleteSummary } from '@/features/chat/assistant-steps-block';
import type { ThinkingContent, ToolUseContent } from '@/features/chat/messages.types';

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

  it('uses noToolFallback when no tools', () => {
    const blocks: Array<ThinkingContent | ToolUseContent> = [
      { type: 'thinking', text: 'only thoughts', streaming: false },
    ];
    expect(buildStepsRoundCompleteSummary(blocks, labels, 'zh', '查看 1 步')).toBe('查看 1 步');
  });
});
