import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ input: { clientMessageId: 'mcp-setup:goal' } as { clientMessageId: string } | undefined, goal: { phase: 'ready', transcriptId: 'transcript', objective: 'complete_task', serverId: 'my-service' } }));
vi.mock('../../../storage/sqlite/durable-state.js', () => ({ DurableState: class { get() { return state.goal; } } }));
vi.mock('../../../storage/sqlite/session-input-repository.js', () => ({ findSessionInputByRunId: () => state.input }));
vi.mock('../../../storage/sqlite/session-read-repository.js', () => ({ getSessionMetadata: () => ({ transcriptId: 'transcript' }) }));
vi.mock('../../embedded/execution-context.js', () => ({ getEmbeddedExecutionRunId: () => 'run' }));
import { createMcpSetupContinuationGuard } from '../continuation-guard.js';

let handlers: Record<string, (event: any) => any>;
beforeEach(() => {
  state.input = { clientMessageId: 'mcp-setup:goal' };
  state.goal = { phase: 'ready', transcriptId: 'transcript', objective: 'complete_task', serverId: 'my-service' };
  handlers = {};
  createMcpSetupContinuationGuard('conversation', true)({ on: (name: string, handler: (event: any) => any) => { handlers[name] = handler; } } as any);
});
it('blocks business reads for connection-only objectives and stale setup continuations', () => {
  state.goal.objective = 'connect_only';
  expect(handlers.tool_call({ toolName: 'mcp__my_service__read', input: {} })).toMatchObject({ block: true });
  expect(handlers.tool_call({ toolName: 'read_mcp_resource', input: { server: 'my-service' } })).toMatchObject({ block: true });
  state.goal.objective = 'complete_task'; state.goal.transcriptId = 'reset';
  expect(handlers.tool_call({ toolName: 'mcp__my_service__read', input: {} })).toMatchObject({ block: true });
});
it('pins resumed native calls and resource reads to the selected service', () => {
  expect(handlers.tool_call({ toolName: 'mcp__my_service__read', input: {} })).toBeUndefined();
  expect(handlers.tool_call({ toolName: 'mcp__another__read', input: {} })).toMatchObject({ block: true });
  expect(handlers.tool_call({ toolName: 'read_mcp_resource', input: { server: 'another' } })).toMatchObject({ block: true });
  expect(handlers.tool_call({ toolName: 'read_mcp_resource', input: { server: 'my-service' } })).toBeUndefined();
  state.input = undefined;
  expect(handlers.tool_call({ toolName: 'mcp__another__read', input: {} })).toBeUndefined();
});
it('guides empty searches without performing configuration and distinguishes resumed discovery', () => {
  const event = { toolName: 'codemode', input: { code: 'text(await searchTools("资料"))' }, content: [{ type: 'text', text: 'Output:\n[]' }] };
  expect(handlers.tool_result(event).content[1].text).toContain('mcp__my_service');
  state.input = undefined;
  expect(handlers.tool_result(event).content[1].text).toContain('mcp_setup discover');
  expect(handlers.tool_result({ ...event, isError: true })).toBeUndefined();
  expect(handlers.tool_result({ ...event, content: [{ type: 'text', text: 'Output:\n[{"name":"read"}]' }] })).toBeUndefined();
});

it('leaves initial intent routing to the general tool guidance instead of keyword-based MCP steering', () => {
  expect(handlers.before_agent_start).toBeUndefined();
});
