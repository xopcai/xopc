import type { ClientHistoryMessage } from './client-history.js';
import { redactSensitiveOutput } from '../utils/logger/redact.js';

export interface PublicExecutionStep {
  id: string;
  kind: 'progress' | 'thinking' | 'tool';
  category?: string;
  text?: string;
  preview?: string;
  failure?: string;
  status?: 'running' | 'done' | 'error';
}

export interface PublicExecutionDetail {
  turnId: string;
  steps: PublicExecutionStep[];
}

function toolCategory(name: string, args?: unknown): string {
  const key = name.split('__').pop()?.toLowerCase().replace(/-/g, '_') ?? '';
  if (key === 'run' && args && typeof args === 'object' && !Array.isArray(args)) {
    const input = args as Record<string, unknown>;
    if (Array.isArray(input.search_query)) return 'search';
    if (Array.isArray(input.open)) return 'fetch';
  }
  if (key === 'skill_view' || key === 'tool_manual') return key;
  if (key === 'xopc_use') {
    let input = args;
    if (typeof input === 'string') {
      try { input = JSON.parse(input); } catch { return 'manage_work'; }
    }
    const record = input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown> : {};
    const mode = typeof record.mode === 'string' ? record.mode : 'work';
    const command = typeof record.command === 'string' ? record.command : '';
    const inspect = ['list', 'get', 'get_card', 'history', 'list_milestones', 'list_updates',
      'mail_sources', 'preview_edit', 'resolve_workspace'].includes(command);
    const target = mode === 'task_run' ? 'tasks'
      : ['note', 'task', 'project', 'automation'].includes(mode) ? `${mode}s` : 'work';
    return `${inspect ? 'inspect' : 'manage'}_${target}`;
  }
  if (key.includes('search')) return 'search';
  if (key === 'read_file' || key === 'read_media' || key === 'image') return 'read';
  if (key === 'exec_command' || key === 'run_command') return 'command';
  if (key === 'write_file') return 'write';
  if (key === 'apply_patch' || key === 'edit_file') return 'edit';
  if (['web_fetch', 'web_extract', 'open_url', 'browser_use'].includes(key)) return 'fetch';
  if (key === 'create_share') return 'share';
  if (key === 'text_to_speech') return 'speech';
  if (key === 'publish_artifacts') return 'publish';
  if (key === 'update_plan') return 'plan';
  return 'other';
}

function publicInputPreview(name: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const input = args as Record<string, unknown>;
  const category = toolCategory(name, args);
  if (category === 'search' && Array.isArray(input.search_query)) {
    const first = input.search_query[0];
    if (first && typeof first === 'object' && !Array.isArray(first) && typeof first.q === 'string') {
      return redactSensitiveOutput(first.q.trim().slice(0, 160));
    }
  }
  if (category === 'fetch' && Array.isArray(input.open)) {
    const first = input.open[0];
    if (first && typeof first === 'object' && !Array.isArray(first) && typeof first.ref_id === 'string') {
      try { const url = new URL(first.ref_id); return `${url.origin}${url.pathname}`.slice(0, 160); }
      catch { /* A tool-local reference is not a public URL. */ }
    }
  }
  const keys = category === 'search' ? ['query']
    : category === 'read' ? ['path', 'file_path']
    : category === 'fetch' ? ['url'] : [];
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      if (key === 'url') {
        try { const url = new URL(value); return `${url.origin}${url.pathname}`.slice(0, 160); }
        catch { return undefined; }
      }
      return redactSensitiveOutput(value.trim().slice(0, 160));
    }
  }
  return undefined;
}

function publicFailure(details: unknown): string | undefined {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const record = details as Record<string, unknown>;
  for (const key of ['errorMessage', 'reason', 'error']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return redactSensitiveOutput(value.trim().split('\n')[0].slice(0, 240));
    }
  }
  return undefined;
}

/** A bounded, public projection of stored activity. Never forwards raw reasoning or tool output. */
export function publicExecutionDetail(messages: ClientHistoryMessage[], turnId: string): PublicExecutionDetail | null {
  const selected = messages.filter(message => message.role === 'assistant'
    && (message.turnId === turnId || message.id === turnId));
  if (!selected.length) return null;
  const steps: PublicExecutionStep[] = [];
  const seenTools = new Set<string>();
  for (const message of selected) {
    const calls = new Map((message.toolCalls ?? []).map(call => [call.id, call]));
    const raw = Array.isArray(message.rawContent) ? message.rawContent : [];
    for (let index = 0; index < raw.length; index++) {
      const block = raw[index];
      if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
      const item = block as Record<string, unknown>;
      if (item.type === 'thinking') {
        if (steps.at(-1)?.kind !== 'thinking') steps.push({ id: `${message.id}:thinking:${index}`, kind: 'thinking' });
        continue;
      }
      if (item.type === 'text' && item.presentation === 'narration' && typeof item.text === 'string' && item.text.trim()) {
        steps.push({ id: `${message.id}:progress:${index}`, kind: 'progress', text: item.text.trim().slice(0, 500) });
        continue;
      }
      if (!['toolCall', 'tool_use', 'tool_call'].includes(String(item.type))) continue;
      const id = typeof item.id === 'string' ? item.id : `${message.id}:tool:${index}`;
      if (seenTools.has(id)) continue;
      seenTools.add(id);
      const call = calls.get(id);
      const name = call?.name ?? (typeof item.name === 'string' ? item.name : '');
      steps.push({ id, kind: 'tool', category: toolCategory(name, call?.args ?? item.input ?? item.args),
        preview: publicInputPreview(name, call?.args ?? item.input ?? item.args),
        failure: call?.isError ? publicFailure(call.details) : undefined,
        status: call?.isError ? 'error' : call?.result !== undefined ? 'done' : 'running' });
    }
    for (const call of message.toolCalls ?? []) {
      const id = call.id ?? `${message.id}:tool:${steps.length}`;
      if (seenTools.has(id)) continue;
      seenTools.add(id);
      steps.push({ id, kind: 'tool', category: toolCategory(call.name, call.args),
        preview: publicInputPreview(call.name, call.args),
        failure: call.isError ? publicFailure(call.details) : undefined,
        status: call.isError ? 'error' : call.result !== undefined ? 'done' : 'running' });
    }
  }
  return { turnId, steps };
}
