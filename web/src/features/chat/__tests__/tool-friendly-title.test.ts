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

  it('uses recognized desktop operations, browser actions and manual topics without displaying their payloads', () => {
    const chat = messages('zh').chat;
    const publicTitle = (block: Parameters<typeof getPublicToolExecutionTitle>[0]) =>
      getPublicToolExecutionTitle(block, 'completed', chat.toolActivity, friendly('zh'), chat.stepsClusterIng);
    expect(publicTitle({ name: 'computer_use', input: { op: 'run', goal: 'private text' },
      result: JSON.stringify({ run: { actionsExecuted: 3 } }) })).toBe('执行了 3 次界面操作');
    expect(publicTitle({ name: 'browser_use', input: { action: 'fill', value: 'private text' } }))
      .toBe('已填写网页表单字段');
    expect(publicTitle({ name: 'tool_manual', input: { tool: 'computer_use' } }))
      .toBe('已查看工具使用说明 · 电脑操作');
    expect(publicTitle({ name: 'automation', input: { action: 'run' } })).toBe('已触发自动化运行');
    expect(publicTitle({ name: 'managed_job', input: { action: 'wait' } })).toBe('已检查后台任务更新');
    expect(publicTitle({ name: 'todo', input: { todos: [] } })).toBe('已更新待办清单');
    expect(publicTitle({ name: 'computer_use', input: { op: 'private text' } })).toBe('操作了电脑');
    expect(publicTitle({ name: 'computer_use', input: { op: 'run' },
      result: { details: { run: { actionsExecuted: 0 } } } })).toBe('未触发界面操作');
  });

  it('reports web search results from activity metadata without echoing the query', () => {
    const chat = messages('zh').chat;
    const activity = { category: 'web', action: 'search', source: 'internet', sensitivity: 'normal' } as const;
    const publicTitle = (status: 'completed' | 'empty', count: number) =>
      getPublicToolExecutionTitle({ name: 'web_search', input: { query: 'private query' },
        activity: { ...activity, status, count } }, 'completed', chat.toolActivity, friendly('zh'), chat.stepsClusterIng);
    expect(publicTitle('completed', 4)).toBe('找到 4 条结果');
    expect(publicTitle('empty', 0)).toBe('未找到匹配结果');
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
      .toBe('读取文件（3 次）、更新了笔记、还有 3 条记录');
  });

  it('reserves the fallback for unknown actions and keeps failures out of successful counts', () => {
    expect(summary([tool('vendor__unknown'), { ...tool('read_file'), status: 'error' }]))
      .toBe('其他操作、1 项操作未完成');
    expect(summary([tool('read_file'), tool('read_file')], 'en')).toBe('Read files (2 times)');
  });

  it('prioritizes user-visible progress and counts a returned browser error as unfinished', () => {
    expect(summary([tool('tool_search'), tool('tool_manual'), tool('read_file'), tool('write_file'),
      { ...tool('browser_use', { action: 'fill' }), result: JSON.stringify({ details: { ok: false } }) }]))
      .toBe('读取文件、保存文件、还有 2 条记录、1 项操作未完成');
  });
});
