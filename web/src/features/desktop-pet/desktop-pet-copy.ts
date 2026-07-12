import { classifyTool } from '@/features/chat/messages/tool-action-cluster';
import { toolNameKey } from '@/features/chat/messages/tool-friendly-title';
import type { MessageBundle } from '@/i18n/messages';
import type { DesktopPetAction, DesktopPetEvent } from '@/types/electron';

type DesktopPetCopy = MessageBundle['desktopPet'];

export function actionForEvent(event: DesktopPetEvent): DesktopPetAction {
  if (event.kind === 'agent-error' || event.severity === 'error') return 'error';
  if (event.kind === 'agent-success' || event.severity === 'success') return 'success';
  if (event.kind === 'agent-start' || event.kind === 'agent-progress') return 'typing';
  if (event.kind === 'agent-tool') return toolActionAnimation(event.toolName);
  return 'idle';
}

function normalizedToolName(name: string): string {
  return toolNameKey(name).replace(/[.:/\\]+/g, '_');
}

function toolActionForPet(toolName: string | undefined, t: DesktopPetCopy): string {
  const raw = toolName?.trim();
  if (!raw) return t.toolActionUnknown;
  const name = normalizedToolName(raw);

  if (name === 'update_plan' || name.includes('plan')) return t.toolActionUpdatePlan;
  if (name.includes('browser') || name.includes('playwright') || name.includes('chrome')) {
    return t.toolActionBrowse;
  }
  if (name === 'image_query' || name.includes('image') || name.includes('visual')) {
    return t.toolActionImage;
  }
  if (name === 'finance' || name.includes('stock') || name.includes('market') || name.includes('crypto')) {
    return t.toolActionFinance;
  }
  if (name === 'weather' || name.includes('forecast')) return t.toolActionWeather;
  if (name === 'sports' || name.includes('score') || name.includes('schedule')) return t.toolActionSports;
  if (name === 'time' || name.includes('timezone')) return t.toolActionTime;
  if (name.includes('memory') || name.includes('remember')) return t.toolActionMemory;
  if (name.includes('automation') || name.includes('reminder') || name.includes('cron')) {
    return t.toolActionAutomation;
  }
  if (name.includes('mcp') || name.includes('connector') || name.includes('plugin')) {
    return t.toolActionConnector;
  }
  if (name.includes('apply_patch') || name.includes('edit_file') || name.includes('patch')) {
    return t.toolActionEditFile;
  }
  if (name.includes('write_file') || name.includes('save_file')) return t.toolActionWriteFile;
  if (name.includes('read_file') || name.includes('file_read')) return t.toolActionReadFile;
  if (
    name.includes('exec_command') ||
    name.includes('run_command') ||
    name.includes('shell') ||
    name.includes('bash') ||
    name.includes('powershell')
  ) {
    return t.toolActionRunCommand;
  }
  if (name.includes('list_dir') || name.includes('list_directory')) return t.toolActionListDirectory;
  if (name.includes('web_fetch') || name.includes('fetch_url')) return t.toolActionFetchUrl;
  if (name.includes('open_url')) return t.toolActionOpenUrl;
  if (name.includes('search')) return t.toolActionSearch;

  switch (classifyTool(raw)) {
    case 'search':
      return t.toolActionSearch;
    case 'readFile':
      return t.toolActionReadFile;
    case 'editFile':
      return t.toolActionEditFile;
    case 'writeFile':
      return t.toolActionWriteFile;
    case 'runCommand':
      return t.toolActionRunCommand;
    case 'listDir':
      return t.toolActionListDirectory;
    case 'openUrl':
      return t.toolActionOpenUrl;
    case 'fetchUrl':
      return t.toolActionFetchUrl;
    case 'other':
      return t.toolActionUnknown;
  }
  return t.toolActionUnknown;
}

function toolActionAnimation(toolName: string | undefined): DesktopPetAction {
  const raw = toolName?.trim();
  if (!raw) return 'toolbox';
  const name = normalizedToolName(raw);

  if (name.includes('browser') || name.includes('playwright') || name.includes('chrome')) return 'browser';
  if (name === 'image_query' || name.includes('image') || name.includes('visual')) return 'search';
  if (name === 'weather' || name.includes('forecast')) return 'search';
  if (name === 'finance' || name.includes('stock') || name.includes('market') || name.includes('crypto')) return 'search';
  if (name === 'sports' || name.includes('score') || name.includes('schedule')) return 'search';
  if (name.includes('apply_patch') || name.includes('edit_file') || name.includes('patch')) return 'file';
  if (name.includes('write_file') || name.includes('save_file')) return 'file';
  if (name.includes('read_file') || name.includes('file_read')) return 'file';
  if (name.includes('list_dir') || name.includes('list_directory')) return 'file';
  if (
    name.includes('exec_command') ||
    name.includes('run_command') ||
    name.includes('shell') ||
    name.includes('bash') ||
    name.includes('powershell')
  ) {
    return 'terminal';
  }
  if (name.includes('web_fetch') || name.includes('fetch_url') || name.includes('open_url')) return 'browser';
  if (name.includes('search')) return 'search';

  switch (classifyTool(raw)) {
    case 'search':
      return 'search';
    case 'readFile':
    case 'editFile':
    case 'writeFile':
    case 'listDir':
      return 'file';
    case 'runCommand':
      return 'terminal';
    case 'openUrl':
    case 'fetchUrl':
      return 'browser';
    case 'other':
      return 'toolbox';
  }
  return 'toolbox';
}

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}

export function messageForEvent(event: DesktopPetEvent, language: 'en' | 'zh', t: DesktopPetCopy): string {
  if (event.message?.trim()) return event.message.trim();
  const zh = language === 'zh';
  if (event.kind === 'agent-start') return zh ? '收到，我开始处理。' : 'Got it. I am on it.';
  if (event.kind === 'agent-tool') {
    return interpolate(t.toolUsing, { action: toolActionForPet(event.toolName, t) });
  }
  if (event.kind === 'agent-progress') return zh ? '还在处理中。' : 'Still working.';
  if (event.kind === 'agent-success') return zh ? '处理好了，点我查看。' : 'Done. Click me to view it.';
  if (event.kind === 'agent-error') return zh ? '这里卡住了，点我看详情。' : 'Something needs attention. Click for details.';
  if (event.kind === 'goal') return zh ? '目标状态有更新。' : 'A goal status changed.';
  return zh ? '我在这里，有事点我。' : 'I am here when you need me.';
}
