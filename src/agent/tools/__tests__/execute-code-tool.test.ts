import { describe, expect, it, vi } from 'vitest';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

import { buildSandboxToolMap, createExecuteCodeTool, SANDBOX_ALLOWED_TOOLS } from '../execute-code-tool.js';

function mockTool(name: string, text: string): AgentTool<any, any> {
  return {
    name,
    label: name,
    description: name,
    parameters: {} as any,
    async execute(): Promise<AgentToolResult<unknown>> {
      return { content: [{ type: 'text', text }], details: {} };
    },
  };
}

describe('execute_code', () => {
  it('buildSandboxToolMap keeps only allowed tool names', () => {
    const tools = [
      mockTool('read_file', 'ok'),
      mockTool('delegate_task', 'no'),
      mockTool('web_search', 's'),
    ];
    const map = buildSandboxToolMap(tools);
    expect(map.size).toBe(2);
    expect(map.has('read_file')).toBe(true);
    expect(map.has('web_search')).toBe(true);
    expect(SANDBOX_ALLOWED_TOOLS.has('delegate_task')).toBe(false);
  });

  it('runs console.log and returns stdout', async () => {
    const map = new Map<string, AgentTool<any, any>>();
    const tool = createExecuteCodeTool({ getSandboxToolMap: () => map });
    const result = await tool.execute('t1', {
      code: 'console.log("hello", 2)',
      timeout: 5,
    });
    expect(result.details.exitCode).toBe(0);
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'hello 2' });
  });

  it('dispatches a sandbox tool and returns its text', async () => {
    const map = new Map<string, AgentTool<any, any>>();
    map.set(
      'read_file',
      mockTool('read_file', 'file body'),
    );
    const tool = createExecuteCodeTool({ getSandboxToolMap: () => map });
    const result = await tool.execute('t2', {
      code: 'console.log(await tools.read_file("x.txt"))',
      timeout: 10,
    });
    expect(result.details.exitCode).toBe(0);
    expect((result.content[0] as { text: string }).text).toContain('file body');
  });

  it('fails when exceeding max tool calls', async () => {
    const map = new Map<string, AgentTool<any, any>>();
    const spy = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'x' }], details: {} });
    map.set('read_file', {
      name: 'read_file',
      label: 'r',
      description: 'r',
      parameters: {} as any,
      execute: spy,
    });
    const tool = createExecuteCodeTool({ getSandboxToolMap: () => map });
    const result = await tool.execute('t3', {
      code: `
        for (let i = 0; i < 60; i++) {
          await tools.read_file("a");
        }
      `,
      timeout: 30,
    });
    expect(result.details.exitCode).toBe(1);
    expect((result.content[0] as { text: string }).text).toMatch(/max sandbox tool calls/i);
    expect(spy.mock.calls.length).toBe(50);
  });
});
