import type { AgentTool } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import {
  bindWorkspaceExecutionTools,
  LocalWorkspaceExecutionBackend,
  type WorkspaceExecutionBackend,
} from '../workspace-execution-backend.js';

function tool(name: string, execute = vi.fn(async () => ({
  content: [{ type: 'text' as const, text: name }],
  details: {},
}))): AgentTool<any, any> {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    execute,
  } as AgentTool<any, any>;
}

const names = [
  'read_file',
  'write_file',
  'apply_patch',
  'list_dir',
  'grep',
  'find',
  'exec_command',
  'managed_job',
] as const;

describe('WorkspaceExecutionBackend', () => {
  it('routes fixed workspace tools through the local backend', async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      details: { routed: true },
    }));
    const definitions = names.map((name) => tool(name, name === 'read_file' ? execute : undefined));
    const backend = new LocalWorkspaceExecutionBackend(definitions);
    const bound = bindWorkspaceExecutionTools(definitions, backend);

    const read = bound.find((candidate) => candidate.name === 'read_file');
    const result = await read!.execute('call-1', { path: 'README.md' });

    expect(result.details).toEqual({ routed: true });
    expect(execute).toHaveBeenCalledWith('call-1', { path: 'README.md' }, undefined, undefined);
  });

  it('preserves metadata while forwarding calls to a remote backend', async () => {
    const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'remote' }], details: {} }));
    const backend: WorkspaceExecutionBackend = { placement: 'remote', execute };
    const definition = tool('grep');
    definition.label = 'Search';
    definition.supportsParallel = true;

    const [bound] = bindWorkspaceExecutionTools([definition], backend);
    const controller = new AbortController();
    const onUpdate = vi.fn();
    await bound.execute('call-2', { pattern: 'x' }, controller.signal, onUpdate);

    expect(bound.label).toBe('Search');
    expect(bound.supportsParallel).toBe(true);
    expect(execute).toHaveBeenCalledWith({
      toolCallId: 'call-2',
      toolName: 'grep',
      params: { pattern: 'x' },
      signal: controller.signal,
      onUpdate,
    });
  });

  it('fails closed when the local allowlist is incomplete', () => {
    expect(() => new LocalWorkspaceExecutionBackend([tool('read_file')])).toThrow(
      'Missing local workspace execution tool',
    );
  });
});
