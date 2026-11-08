import { afterEach, expect, it, vi } from 'vitest';
import { Type } from '@sinclair/typebox';

const harness = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../embedded/run-turn.js', () => ({ runXopcEmbeddedTurn: harness.run }));
vi.mock('../../embedded/session-runner.js', () => ({ evictEmbeddedSessionRunner: vi.fn() }));
vi.mock('../../../providers/index.js', () => ({ resolveModel: () => ({ id: 'test', provider: 'openai', contextWindow: 10000 }) }));
vi.mock('../../tools/factory.js', () => ({ AgentToolsFactory: class {
  createAllTools() { return ['read_file', 'write_file'].map(name => ({ name, description: name, label: name, parameters: Type.Object({}), execute: async () => ({ content: [] }) })); }
} }));

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { closeXopcDatabase } from '../../../storage/sqlite/connection.js';
import { ConfigSchema } from '../../../config/schema.js';
import { setSessionInteractionPolicy } from '../../session/interaction-policy.js';
import { getChildRun, monitorChildRun } from '../child-run-monitor.js';
import { resumeChildRun } from '../child-run-resume.js';

afterEach(() => { closeXopcDatabase(); harness.run.mockReset(); delete (globalThis as Record<symbol, unknown>)[Symbol.for('xopc.child-run-monitor')]; });

it('reconstructs a saved child with previous context and intersects the original tool grant', async () => {
  initializeTestAgentCatalog();
  const child = monitorChildRun({ id: 'resume-child', parentConversationId: 'parent-A', task: 'original task', workspace: '/tmp', modelRef: 'openai/test', agentId: 'main', allowedTools: ['read_file'], maxIterations: 3, abort: () => {} });
  child.snapshot([{ role: 'user', content: 'previous child context', timestamp: 1 }]); child.finish('partial', 'unfinished');
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('xopc.child-run-monitor')];
  harness.run.mockImplementation(async params => {
    expect(params.tools.map((tool: { name: string }) => tool.name)).toEqual(['read_file']);
    expect(params.toolPolicyConversationId).toBe('parent-A');
    expect(await params.transcriptRuntime.loadMessages()).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'previous child context' })]));
    expect(params.userMessage.content).toBe('continue with the parser');
    return { ok: true, lastAssistantText: 'finished' };
  });
  await resumeChildRun('parent-A', 'resume-child', 'continue with the parser', ConfigSchema.parse({}));
  await vi.waitFor(() => expect(getChildRun('parent-A', 'resume-child').status).toBe('success'));
  await expect(resumeChildRun('parent-B', 'resume-child', 'wrong owner', ConfigSchema.parse({}))).rejects.toThrow('not found');
  setSessionInteractionPolicy('parent-A', { mode: 'plan', access: 'configured' });
  await expect(resumeChildRun('parent-A', 'resume-child', 'mutate files', ConfigSchema.parse({}))).rejects.toThrow('Plan');
});
