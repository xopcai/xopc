import { describe, expect, it } from 'vitest';

import {
  getToolExecutionTitle,
  hasSpecificToolExecutionTitle,
  type FriendlyToolTitleLabels,
} from '@/features/chat/messages/tool-friendly-title';
import { messages } from '@/i18n/messages';

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
    ['local_app', 'validate', 'Checking local app…', 'Checked local app'],
    ['settings', 'open', 'Opening settings…', 'Opened settings'],
    ['scene', 'check', 'Checking scene…', 'Checked scene'],
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
    expect(title('zh', 'skill_view', { name: 'proposal-writing' }, 'running')).toBe('正在查看技能说明… · proposal-writing');
    expect(title('zh', 'skill_view', '{"name":"proposal-writing"}', 'completed')).toBe('已查看技能说明 · proposal-writing');
    expect(title('zh', 'skill_view', {}, 'completed')).toBe('已查看技能说明');
  });

  it('uses dedicated wording for built-in tools', () => {
    expect(title('en', 'image_generate', {}, 'running')).toBe('Generating image…');
    expect(title('zh', 'delegate_task', {}, 'completed')).toBe('委派了任务');
    expect(title('en', 'mcp__server__workflow', {}, 'completed')).toBe('Ran workflow');
    expect(hasSpecificToolExecutionTitle('xopc_use')).toBe(true);
  });

  it('infers an action from namespaced external tool names and safely humanizes unknown tools', () => {
    expect(title('en', 'github__create_issue', {}, 'completed')).toBe('Created issue');
    expect(title('zh', 'github__create_issue', {}, 'running')).toBe('正在创建issue…');
    expect(title('en', 'vendor__customer_export', {}, 'completed')).toBe('Ran customer export');
  });
});
