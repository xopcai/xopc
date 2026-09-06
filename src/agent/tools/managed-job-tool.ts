import { resolve } from 'node:path';

import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import type { CommandIsolation } from '../commands/command-isolation.js';
import { commandRegistry, commandTimeout } from '../commands/command-registry.js';
import { evaluateExecPolicy } from '../sandbox/exec-policy.js';

const ManagedJobSchema = Type.Union([
  Type.Object({ action: Type.Literal('start'), command: Type.String({ minLength: 1 }), cwd: Type.Optional(Type.String()), maxRuntimeMs: Type.Optional(Type.Number()) }),
  Type.Object({ action: Type.Literal('status'), jobId: Type.String() }),
  Type.Object({ action: Type.Literal('wait'), jobId: Type.String(), waitMs: Type.Optional(Type.Number({ minimum: 0, maximum: 60000 })) }),
  Type.Object({ action: Type.Literal('stdin'), jobId: Type.String(), chars: Type.String({ maxLength: 65536 }), end: Type.Optional(Type.Boolean()) }),
  Type.Object({ action: Type.Literal('list') }),
  Type.Object({ action: Type.Literal('cancel'), jobId: Type.String() }),
], { type: 'object' });

function result(value: unknown): AgentToolResult<Record<string, unknown>> {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    details: Array.isArray(value) ? { jobs: value } : value as Record<string, unknown> };
}

export function createManagedJobTool(
  workspace: string,
  getSessionKey: () => string | undefined,
  getSkillPassthroughEnvVarNames?: () => string[],
  prepareEnv?: (baseEnv: Record<string, string>, cwd: string) => Promise<Record<string, string>>,
  getCommandIsolation?: () => CommandIsolation | undefined,
): AgentTool {
  return {
    name: 'managed_job', label: 'Managed Job',
    description: 'Manage shell jobs, including jobs yielded by exec_command. Start returns an id; wait returns on completion or after at most 60s; stdin writes pipe input (not a terminal); status/list/cancel inspect or stop jobs. Completed output and logs survive restart. Interrupted jobs require inspection before restart.',
    parameters: ManagedJobSchema,
    supportsParallel: true, idempotent: false,
    async execute(_toolCallId: string, input: Static<typeof ManagedJobSchema>, signal?: AbortSignal) {
      const owner = getSessionKey() ?? workspace;
      const registry = commandRegistry();
      if (input.action === 'list') return result(registry.list(owner));
      if (input.action !== 'start') {
        if (input.action === 'stdin' && !registry.write(owner, input.jobId, input.chars, input.end)) {
          return result({ status: 'failed', error: 'Job is unavailable or stdin is closed' });
        }
        const job = input.action === 'wait' ? await registry.wait(owner, input.jobId, input.waitMs, signal)
          : input.action === 'cancel' ? await registry.cancel(owner, input.jobId) : registry.get(owner, input.jobId);
        return result(job ?? { status: 'failed', error: 'Managed job not found' });
      }
      const command = input.command.trim();
      if (!command) return result({ status: 'failed', error: 'command is required' });
      const policy = evaluateExecPolicy({ command, cwd: resolve(workspace, input.cwd?.trim() || '.'), allowedEnvVars: getSkillPassthroughEnvVarNames?.() ?? [] });
      if (!policy.allowed) return result({ status: 'blocked', error: `Command blocked: ${policy.reason}` });
      const env = prepareEnv ? await prepareEnv(policy.sanitizedEnv, policy.effectiveCwd) : policy.sanitizedEnv;
      return result(await registry.start({ owner, command, cwd: policy.effectiveCwd, env: { ...env, COLUMNS: '200' },
        workspace, isolation: getCommandIsolation?.(), timeoutMs: commandTimeout(input.maxRuntimeMs, policy.timeoutMs), snapshot: true, signal }));
    },
  } as AgentTool;
}
