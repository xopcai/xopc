import { TaskCommandRequestSchema, TaskCreateRequestSchema, TaskDetailResponseSchema } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { CapabilityError, defineAtomicCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { TaskApplicationService } from '../task-application-service.js';
import type { Config } from '../../config/schema.js';
import type { ProjectService } from '../../projects/index.js';
import { resolveProjectAgentId } from '../../projects/project-agent.js';
import { TaskRunRepository } from '../task-run-repository.js';
import { TaskSignalService } from '../task-signal-service.js';
import { TaskRepository } from '../task-repository.js';

const modelSchema = TaskDetailResponseSchema.pick({ task: true, operationalState: true, attention: true, allowedCommands: true });
export const TaskMutationOutputSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), model: modelSchema, runId: z.string().optional() }),
  z.object({ ok: z.literal(false), reason: z.enum(['not_found', 'conflict', 'invalid_transition', 'blocked']), model: modelSchema.optional() }),
]);

export interface TaskWriteCapabilityDeps {
  getConfig?: () => Config | undefined;
  getProjects?: () => ProjectService | undefined;
  wake?: (runs: boolean) => void;
  abortConversation?: (conversationId: string) => void | Promise<void>;
}

export function registerTaskWriteCapabilities(dispatcher: CapabilityDispatcher, deps: TaskWriteCapabilityDeps): void {
  dispatcher.register(defineAtomicCapability({
    id: 'xopc.tasks.create', majorVersion: 1, description: 'Create a task and atomically persist its operation receipt.',
    effect: 'local-write', surfaces: ['http', 'agent'], scopes: ['tasks.write'],
    input: TaskCreateRequestSchema.omit({ idempotencyKey: true }), output: TaskMutationOutputSchema,
    execute(input, context) {
      if (input.activation.mode === 'start' && !deps.wake) throw new CapabilityError('UNAVAILABLE', 'Task execution service is unavailable');
      const config = deps.getConfig?.();
      const projects = deps.getProjects?.();
      const requestedAgentId = input.delegateAgentId
        ?? (input.activation.mode === 'start' && input.activation.executor?.kind === 'agent' ? input.activation.executor.agentId : undefined);
      const agentId = config && projects
        ? resolveProjectAgentId({ config, projects, explicitAgentId: requestedAgentId, projectId: input.projectId })
        : requestedAgentId;
      const activation = input.activation.mode === 'start' && (!input.activation.executor || input.activation.executor.kind === 'agent')
        ? { ...input.activation, executor: { kind: 'agent' as const, agentId: agentId ?? 'main' } }
        : input.activation;
      // Preserve the domain's established idempotency identity across upgrades.
      return new TaskApplicationService().create({ ...input, delegateAgentId: agentId, activation, idempotencyKey: context.idempotencyKey }, context.actor);
    },
    afterCommit(result) { if (result.ok) deps.wake?.(Boolean(result.runId)); },
  }));
  dispatcher.register(defineAtomicCapability({
    id: 'xopc.tasks.command', majorVersion: 1, description: 'Apply a versioned task lifecycle command with a durable receipt.',
    effect: 'local-write', surfaces: ['http', 'agent'], scopes: ['tasks.write'],
    input: TaskCommandRequestSchema.omit({ idempotencyKey: true }).extend({ taskId: z.string().min(1) }),
    output: TaskMutationOutputSchema,
    execute(input, context) {
      if (input.command.type === 'start' && !deps.wake) throw new CapabilityError('UNAVAILABLE', 'Task execution service is unavailable');
      const result = new TaskApplicationService().execute({ ...input, command: input.command!, idempotencyKey: context.idempotencyKey, actor: context.actor });
      if (result.ok && input.command.type === 'close' && input.command.resolution === 'done') {
        new TaskSignalService().dependencyClosed(input.taskId);
      }
      return result;
    },
    async afterCommit(result, input) {
      if (!result.ok) return;
      const command = input.command;
      const denied = command.type === 'resolve_wait' && (command.resolution as { kind?: string; decision?: string } | undefined)?.kind === 'task_approval'
        && (command.resolution as { decision?: string }).decision === 'deny';
      if ((command.type === 'add_wait' && command.wait.kind === 'paused') || command.type === 'close' || denied) {
        const activeRun = new TaskRunRepository().getActiveRoot(input.taskId);
        // Replaying an old pause must not abort a newer execution of the same task.
        if (activeRun?.conversationId && new TaskRepository().get(input.taskId)?.version === result.model.task.version) {
          await deps.abortConversation?.(activeRun.conversationId);
        }
      }
      deps.wake?.(Boolean(result.runId) || command.type === 'resolve_wait' || command.type === 'close');
    },
  }));
}
