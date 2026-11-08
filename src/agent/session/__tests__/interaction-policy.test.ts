import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { closeXopcDatabase } from '../../../storage/sqlite/index.js';
import { allowsExecutionTool, resolveExecutionToolPolicy } from '../../embedded/execution-tool-policy.js';
import { acquireEmbeddedRunLease } from '../../embedded/runs.js';
import { monitorChildRun } from '../../orchestration/child-run-monitor.js';
import { getSessionInteractionPolicy, setSessionInteractionPolicy } from '../interaction-policy.js';

beforeEach(() => { initializeTestAgentCatalog(); });
afterEach(() => closeXopcDatabase());

describe('session interaction policy', () => {
  it('refuses a mode change while an owned subagent is still running', () => {
    const child = monitorChildRun({ id: 'policy-child', parentConversationId: 'A', task: 'inspect', abort: () => {} });
    try {
      expect(() => setSessionInteractionPolicy('A', { mode: 'plan', access: 'configured' })).toThrow('subagents');
      setSessionInteractionPolicy('B', { mode: 'plan', access: 'configured' });
    } finally { child.finish('cancelled', 'test finished'); }
    setSessionInteractionPolicy('A', { mode: 'plan', access: 'configured' });
  });
  it('persists Plan mode separately for each conversation and filters mutation paths', () => {
    setSessionInteractionPolicy('A', { mode: 'plan', access: 'configured' });
    expect(getSessionInteractionPolicy('A').mode).toBe('plan');
    expect(getSessionInteractionPolicy('B').mode).toBe('default');
    const policy = resolveExecutionToolPolicy('A');
    for (const name of ['apply_patch', 'write_file', 'delegate_task', 'tool_search', 'xopc_tool_execute', 'send_message']) {
      expect(allowsExecutionTool(policy, name), name).toBe(false);
    }
    for (const name of ['exec_command', 'managed_job', 'read_file', 'find', 'grep', 'list_dir', 'clarify', 'update_plan']) {
      expect(allowsExecutionTool(policy, name), name).toBe(true);
    }
    expect(policy.nativeMcp).toBe(false);
    expect(policy.codemode).toBe(false);
    expect(policy.discovery).toBe(false);
  });

  it('enforces read-only access even in Default mode', () => {
    setSessionInteractionPolicy('A', { mode: 'default', access: 'read-only' });
    expect(allowsExecutionTool(resolveExecutionToolPolicy('A'), 'write_file')).toBe(false);
    expect(allowsExecutionTool(resolveExecutionToolPolicy('A'), 'exec_command')).toBe(true);
    setSessionInteractionPolicy('A', { mode: 'default', access: 'configured' });
    expect(allowsExecutionTool(resolveExecutionToolPolicy('A'), 'exec_command')).toBe(true);
  });

  it('refuses mode changes during a live run', () => {
    const lease = acquireEmbeddedRunLease({ conversationId: 'A', runId: 'run-A', transcriptId: 'transcript-A' });
    try {
      expect(() => setSessionInteractionPolicy('A', { mode: 'plan', access: 'configured' })).toThrow('Stop the active run');
      expect(getSessionInteractionPolicy('A').mode).toBe('default');
    } finally { lease.release(); }
  });
});
