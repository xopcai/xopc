import { describe, expect, it } from 'vitest';

import {
  getToolExecutionTitle,
  getPublicToolExecutionTitle,
  hasSpecificToolExecutionTitle,
  type FriendlyToolTitleLabels,
} from '@/features/chat/messages/tool-friendly-title';
import { messages } from '@/i18n/messages';
import { summarizeToolActivity } from '@/features/chat/messages/assistant-activity-groups';
import type { ToolUseContent } from '@/features/chat/messages/messages.types';

function friendly(language: 'en' | 'zh'): FriendlyToolTitleLabels {
  const chat = messages(language).chat;
  return {
    searchedWeb: chat.stepSearchedWeb,
    searchedMemory: chat.stepSearchedMemory,
    searchedCode: chat.stepSearchedCode,
    searched: chat.stepSearched,
    readFile: chat.stepReadFile,
    runCommand: chat.stepRunCommand,
    listDirectory: chat.stepListDirectory,
    writeFile: chat.stepWriteFile,
    editFile: chat.stepEditFile,
    openUrl: chat.stepOpenUrl,
    fetchUrl: chat.stepFetchUrl,
    unknownTool: chat.stepUnknownTool,
  };
}

function title(
  language: 'en' | 'zh',
  name: string,
  input: unknown,
  state: 'running' | 'completed',
): string {
  const chat = messages(language).chat;
  return getToolExecutionTitle(name, input, state, chat.toolActivity, friendly(language));
}

describe('getToolExecutionTitle', () => {
  it.each([
    ['project', 'list', 'Inspecting project…', 'Inspected project'],
    ['project', 'create_milestone', 'Creating milestone…', 'Created milestone'],
    ['project', 'create_update', 'Creating project update…', 'Created project update'],
    ['automation', 'run', 'Running automation…', 'Ran automation'],
    ['note', 'update', 'Updating note…', 'Updated note'],
    ['task', 'delete', 'Removing task…', 'Removed task'],
    ['task_run', 'cancel', 'Stopping task run…', 'Stopped task run'],
    ['local_app', 'validate', 'Checking app…', 'Checked app'],
    ['settings', 'open', 'Opening settings…', 'Opened settings'],
  ])('describes xopc_use %s/%s in English', (mode, command, running, completed) => {
    expect(title('en', 'xopc_use', { mode, command }, 'running')).toBe(running);
    expect(title('en', 'xopc_use', { mode, command }, 'completed')).toBe(completed);
  });

  it('describes xopc_use with natural Chinese wording', () => {
    expect(title('zh', 'xopc_use', { mode: 'note', command: 'update' }, 'running')).toBe('正在更新笔记…');
    expect(title('zh', 'xopc_use', { mode: 'note', command: 'update' }, 'completed')).toBe('更新了笔记');
    expect(title('zh', 'xopc_use', JSON.stringify({ mode: 'automation', command: 'run' }), 'completed')).toBe('运行了自动化');
  });

  it('names the actual skill without inventing a purpose', () => {
    expect(title('zh', 'skill_view', { name: 'proposal-writing' }, 'running')).toBe('正在查阅参考资料… · proposal-writing');
    expect(title('zh', 'skill_view', '{"name":"proposal-writing"}', 'completed')).toBe('已查阅参考资料 · proposal-writing');
    expect(title('zh', 'skill_view', {}, 'completed')).toBe('已查阅参考资料');
  });

  it('uses dedicated wording for built-in tools', () => {
    expect(title('en', 'image_generate', {}, 'running')).toBe('Generating image…');
    expect(title('zh', 'delegate_task', {}, 'completed')).toBe('已安排相关工作');
    expect(title('en', 'mcp__server__inspect', {}, 'completed')).toBe('Other actions');
    expect(hasSpecificToolExecutionTitle('xopc_use')).toBe(true);
  });

  it('infers an action from namespaced external tool names and safely humanizes unknown tools', () => {
    expect(title('en', 'github__create_issue', {}, 'completed')).toBe('Created issue');
    expect(title('zh', 'github__create_issue', {}, 'running')).toBe('正在创建issue…');
    expect(title('en', 'vendor__customer_export', {}, 'completed')).toBe('Other actions');
  });

  it.each(['en', 'zh'] as const)('keeps arbitrary names, paths and skill identifiers out of public %s titles', language => {
    const chat = messages(language).chat;
    for (const name of ['vendor__customer_export', 'read_file', 'exec_command', 'skill_view']) {
      for (const state of ['running', 'completed'] as const) {
        const text = getPublicToolExecutionTitle({ name, input: { name: 'private-skill', path: '/private/data', command: 'cat secret' } },
          state, chat.toolActivity, friendly(language), chat.stepsClusterIng);
        expect(text).not.toMatch(/private|secret|customer.export|exec.command|read.file|skill.view/);
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });

  it('names code execution and tool discovery explicitly', () => {
    expect(title('zh', 'codemode', {}, 'running')).toBe('正在运行代码…');
    expect(title('zh', 'tool_search', {}, 'completed')).toBe('查找可用工具');
  });
});

describe('readable activity summaries', () => {
  const tool = (name: string, input?: unknown): ToolUseContent => ({
    type: 'tool_use', id: name, name, input, status: 'done',
  });
  function summary(tools: ToolUseContent[], language: 'en' | 'zh' = 'zh') {
    const chat = messages(language).chat;
    return summarizeToolActivity(tools, block => getPublicToolExecutionTitle(block, 'completed',
      chat.toolActivity, friendly(language), chat.stepsClusterIng), {
      repeated: chat.activityRepeated, more: chat.activityMore, failed: chat.activityFailed,
      separator: language === 'zh' ? '、' : ', ',
    });
  }

  it('distinguishes different actions that share the other display category', () => {
    expect(summary([tool('xopc_use', { mode: 'note', command: 'update' }), tool('browser_use')]))
      .toBe('更新了笔记、操作了浏览器');
  });

  it('counts repeated actions and bounds long summaries without exposing raw parameters', () => {
    expect(summary([tool('read_file'), tool('read_file'), tool('read_file'),
      tool('xopc_use', { mode: 'note', command: 'update', title: '/private/secret' }),
      tool('browser_use'), tool('codemode'), tool('tool_search')]))
      .toBe('读取文件（3 次）、更新了笔记、另 3 项操作');
  });

  it('reserves the fallback for unknown actions and keeps failures out of successful counts', () => {
    expect(summary([tool('vendor__unknown'), { ...tool('read_file'), status: 'error' }]))
      .toBe('其他操作、1 项操作未完成');
    expect(summary([tool('read_file'), tool('read_file')], 'en')).toBe('Read files (2 times)');
  });
});
