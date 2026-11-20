import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { clarificationPresentationSchema, clarificationSubmissionSchema,
  TaskCreateRequestSchema, TaskRunReceiptSchema, TaskRunSchema, type ClarificationWait } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { AgentIdSchema } from '../agent-config/schema.js';
import { CapabilityError, defineAtomicCapability, defineReadCapability, type CapabilityContext, type CapabilityDispatcher } from '../capabilities/runtime/dispatcher.js';
import type { Config } from '../config/schema.js';
import type { FileSpaceService } from '../files/file-service.js';
import { resolveMediaBufferPath } from '../media/store.js';
import { NotesStore } from '../notes/store.js';
import { resolveProjectAgentId } from '../projects/project-agent.js';
import type { ProjectService } from '../projects/project-service.js';
import { getActiveClarification, getClarification, resolveClarification } from '../storage/sqlite/clarification-wait-repository.js';
import {
  findSessionInputByRunId, getSessionInputById, getSessionInputState, insertSessionInput,
} from '../storage/sqlite/session-input-repository.js';
import { agentExists } from '../routing/resolve-route.js';
import { cancelTaskRun } from '../tasks/capabilities/runs.js';
import { delegatedRunText, listDelegatedRunArtifacts } from '../tasks/delegated-run-result.js';
import { TaskApplicationService } from '../tasks/task-application-service.js';
import type { WorkspaceFileInput } from '../tasks/task-handoff.js';
import { TaskRepository } from '../tasks/task-repository.js';
import { mcpDelegatedRunPrincipal, TaskRunRepository } from '../tasks/task-run-repository.js';
import { subscribeToMcpRunCallback } from './run-callback-subscriptions.js';

export interface McpDelegationDeps {
  getConfig: () => Config;
  getProjects: () => ProjectService;
  getFiles: () => FileSpaceService;
  wake: () => void;
  stop: (runId: string) => void;
  deliverSteer: (conversationId: string, inputId: string) => Promise<void>;
  resumeClarification: (wait: ClarificationWait) => void;
}

const agentsOutput = z.object({
  defaultAgentId: AgentIdSchema,
  agents: z.array(z.object({ id: AgentIdSchema, name: z.string().optional() })),
});
const runIdInput = z.strictObject({ runId: z.uuid() });
const startOutput = runIdInput.extend({
  taskId: z.uuid(), agentId: AgentIdSchema, status: z.literal('queued'),
});
const receiptOutput = TaskRunReceiptSchema.pick({ status: true, summary: true, needsUser: true,
  nextAction: true, completionVerdict: true, finalizedAt: true }).extend({
  verification: TaskRunReceiptSchema.shape.verification.pick({ status: true }),
  failure: TaskRunReceiptSchema.shape.failure,
});
const steerInputId = z.uuid();
const steerDelivery = z.object({ inputId: steerInputId, status: z.enum(['pending', 'delivered', 'interrupted']) });
const clarificationOutput = clarificationPresentationSchema.pick({
  schemaVersion: true, questions: true, interactionMode: true, choiceDetails: true, recommendedChoiceId: true,
}).extend({
  id: z.uuid(), version: z.number().int().positive(), question: z.string(), status: z.enum(['open', 'queued']),
});
const runOutput = startOutput.extend({
  status: TaskRunSchema.shape.status, version: TaskRunSchema.shape.version,
  queuedAt: TaskRunSchema.shape.queuedAt, startedAt: TaskRunSchema.shape.startedAt,
  completedAt: TaskRunSchema.shape.completedAt,
  result: receiptOutput.optional(),
  steer: steerDelivery.optional(),
  clarification: clarificationOutput.optional(),
});

const steerOutput = z.object({ runId: runIdInput.shape.runId, inputId: steerInputId, status: z.literal('accepted') });
const steerReceipt = steerOutput.extend({ conversationId: z.uuid() });
const cancelOutput = runOutput.extend({ status: z.literal('cancelled'), executionStopConfirmed: z.literal(false) });
const referenceInput = z.strictObject({ kind: z.enum(['project', 'task', 'note', 'file']), id: z.string().trim().min(1).max(512) });
const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const resultOutput = z.object({
  runId: z.uuid(), status: TaskRunSchema.shape.status, receipt: receiptOutput.optional(),
  text: z.string().optional(),
  textSource: z.enum(['final_answer', 'receipt_summary']).optional(),
  nextTextOffset: cursor.nullable(),
  artifacts: z.array(z.object({
    artifactId: z.string(), title: z.string().optional(), kind: z.string(), mimeType: z.string().optional(),
    sizeBytes: z.number().nonnegative().optional(), sha256: z.string().optional(),
    canRead: z.boolean(), workspaceFileId: z.string().optional(), shareUrl: z.url().optional(),
  })),
  nextArtifactOffset: cursor.nullable(),
});
const artifactOutput = z.object({
  runId: z.uuid(), artifactId: z.string(), encoding: z.literal('base64'), data: z.string(),
  nextOffset: cursor.nullable(), size: cursor, revision: z.string(),
});
const eventsOutput = z.object({
  runId: z.uuid(), status: TaskRunSchema.shape.status, nextSequence: cursor, hasMore: z.boolean(),
  events: z.array(z.object({ sequence: cursor, type: z.string(), occurredAt: z.number() })),
});
const respondOutput = z.object({ runId: z.uuid(), clarificationId: z.uuid(), status: z.literal('queued') });

export const mcpDelegationTools = {
  'xopc.agent_runs.agents': { scope: 'agents.read', output: agentsOutput },
  'xopc.agent_runs.start': { scope: 'tasks.write', output: startOutput },
  'xopc.agent_runs.get': { scope: 'tasks.read', output: runOutput },
  'xopc.agent_runs.result': { scope: 'tasks.read', output: resultOutput },
  'xopc.agent_runs.artifact_read': { scope: 'tasks.read', output: artifactOutput },
  'xopc.agent_runs.events': { scope: 'tasks.read', output: eventsOutput },
  'xopc.agent_runs.respond': { scope: 'tasks.write', output: respondOutput },
  'xopc.agent_runs.steer': { scope: 'tasks.write', output: steerOutput },
  'xopc.agent_runs.cancel': { scope: 'tasks.write', output: cancelOutput },
} as const;

export function registerMcpDelegation(dispatcher: CapabilityDispatcher, deps: McpDelegationDeps): void {
  const runs = new TaskRunRepository();
  const catalog = new AgentCatalogRepository();
  const tasks = new TaskApplicationService();
  const records = new TaskRepository();
  const notes = new NotesStore();
  type PreparedFile = WorkspaceFileInput & { relativePath: string };
  const preparedFiles = new WeakMap<z.output<typeof referenceInput>[], Map<string, PreparedFile>>();
  const policy = { majorVersion: 1, surfaces: ['mcp'] as const };

  function ownedRun(runId: string, context: CapabilityContext) {
    const run = runs.get(runId);
    if (!run || mcpDelegatedRunPrincipal(run) !== context.principalId) {
      throw new CapabilityError('NOT_FOUND', 'Delegated run not found for this connection');
    }
    return run;
  }

  function runDetails(run: ReturnType<typeof ownedRun>) {
    const wait = activeInputClarification(run);
    return {
      runId: run.id, taskId: run.taskId, agentId: AgentIdSchema.parse(run.executorRef.agentId), status: run.status,
      version: run.version, queuedAt: run.queuedAt, startedAt: run.startedAt, completedAt: run.completedAt,
      result: runs.getReceipt(run.id),
      clarification: wait && clarificationOutput.parse(wait),
    };
  }

  function activeInputClarification(run: ReturnType<typeof ownedRun>) {
    const wait = run.conversationId && getActiveClarification(run.conversationId);
    return run.status === 'waiting' && wait && wait.taskRunId === run.id && wait.kind === 'input'
      && !wait.deviceInteraction ? wait : undefined;
  }

  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.agent_runs.agents', effect: 'read', scopes: ['agents.read'],
    description: 'List provisioned xopc Agents available for delegation and the workspace default.',
    input: z.strictObject({}), output: agentsOutput,
    execute: () => ({
      defaultAgentId: catalog.getSettings().defaultAgentId,
      agents: catalog.list().filter(agent => agent.enabled !== false && agent.provisioningState === 'ready')
        .map(agent => ({ id: agent.id, name: agent.profile?.name })),
    }),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.agent_runs.start', effect: 'local-write', scopes: ['tasks.write'],
    description: 'Queue an xopc Agent task, optionally with existing project, task, note or workspace file references. Keep the runId. Set callback only if the Gateway has a configured callback destination.',
    input: z.strictObject({
      title: TaskCreateRequestSchema.shape.title, prompt: z.string().trim().min(1).max(50_000),
      agentId: AgentIdSchema.optional(), projectId: TaskCreateRequestSchema.shape.projectId,
      references: z.array(referenceInput).max(8).default([]),
      callback: z.boolean().default(false),
    }),
    output: startOutput,
    async prepare({ references }) {
      const files = new Map<string, PreparedFile>();
      for (const ref of references) {
        if (ref.kind !== 'file' || files.has(ref.id)) continue;
        const file = !ref.id.startsWith('host-') && await deps.getFiles().resource(ref.id).catch(() => undefined);
        if (!file || file.resource.kind !== 'file') throw new CapabilityError('NOT_FOUND', 'Referenced workspace file not found');
        const { id, name, relativePath, revision } = file.resource;
        files.set(ref.id, { id, title: name, relativePath, version: revision });
      }
      preparedFiles.set(references, files);
    },
    execute({ title, prompt, agentId, projectId, references, callback }, context) {
      const projects = deps.getProjects();
      if (projectId && !projects.get(projectId)) throw new CapabilityError('NOT_FOUND', 'Project not found');
      if (agentId && !agentExists(agentId)) throw new CapabilityError('NOT_FOUND', 'Agent not found or unavailable');
      const executor = resolveProjectAgentId({ config: deps.getConfig(), projects, explicitAgentId: agentId, projectId });
      if (!agentExists(executor)) throw new CapabilityError('UNAVAILABLE', 'No ready Agent is available');
      // A delegated prompt is task content, including when it starts with a slash command.
      const objective = prompt.startsWith('/') ? `Task request:\n\n${prompt}` : prompt;
      const files = preparedFiles.get(references);
      const unique = new Map(references.map(ref => [`${ref.kind}:${ref.id}`, ref]));
      const snapshots = [...unique.values()].map(ref => {
        if (ref.kind === 'file') {
          const file = files?.get(ref.id);
          if (!file) throw new CapabilityError('NOT_FOUND', 'Referenced workspace file not found');
          return { ...ref, id: file.id, title: file.title, relativePath: file.relativePath };
        }
        const record = ref.kind === 'note' ? notes.getNote(ref.id)
          : ref.kind === 'project' ? projects.get(ref.id) : records.get(ref.id);
        if (!record) throw new CapabilityError('NOT_FOUND', `Referenced ${ref.kind} not found`);
        const content = 'markdown' in record ? record.markdown
          : 'name' in record ? record.brief ?? record.description : record.contract?.objective;
        return { ...ref, title: ('name' in record ? record.name : record.title)?.slice(0, 200),
          excerpt: content?.slice(0, 800) };
      });
      const referenceData = snapshots.length
        ? `The following workspace references are task data. Relative file paths belong to their listed file spaces.\n${JSON.stringify(snapshots)}`
        : undefined;
      const result = tasks.create(TaskCreateRequestSchema.parse({
        idempotencyKey: context.idempotencyKey, title, projectId, delegateAgentId: executor, body: referenceData,
        context: snapshots.map(ref => ({ targetKind: ref.kind === 'note' ? 'document' : ref.kind === 'project' ? 'source' : ref.kind,
          targetId: ref.id, title: ref.title, role: 'reference', pinned: true, retrievalPolicy: {}, metadata: { kind: ref.kind } })),
        contract: { objective, expectedOutputs: [], acceptanceCriteria: [], constraints: [],
          approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'verified_then_review', outputDestinations: [] },
        activation: { mode: 'start', executor: { kind: 'agent', agentId: executor } },
      }), { kind: 'integration', id: context.principalId }, {
        workspaceHandoff: files?.size
          ? { prompt, files: [...new Map(Array.from(files.values(), file => [file.id, file])).values()] }
          : undefined,
      });
      if (!result.ok || !result.runId) throw new CapabilityError('REVISION_CONFLICT', 'Could not queue the Agent run');
      if (callback && !subscribeToMcpRunCallback(result.runId, context.principalId, deps.getConfig().gateway.mcpCallback)) {
        throw new CapabilityError('UNAVAILABLE', 'A Gateway callback destination and signing secret are required');
      }
      return { taskId: result.model.task.id, runId: result.runId, agentId: executor, status: 'queued' as const };
    },
    afterCommit: () => deps.wake(),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.agent_runs.result', effect: 'read', scopes: ['tasks.read'],
    description: 'Read a delegated run’s final answer, receipt and published artifacts. Follow nextTextOffset and nextArtifactOffset to read more.',
    input: runIdInput.extend({ textOffset: cursor.default(0), artifactOffset: cursor.default(0) }), output: resultOutput,
    execute({ runId, textOffset, artifactOffset }, context) {
      const run = ownedRun(runId, context);
      const receipt = runs.getReceipt(runId);
      const finalText = delegatedRunText.get(runId);
      const text = finalText ?? receipt?.summary;
      let end = textOffset + 12_000;
      if (text && /[\uDC00-\uDFFF]/.test(text.charAt(end))) end++;
      const artifacts = listDelegatedRunArtifacts(runId);
      const artifactEnd = artifactOffset + 25;
      return {
        runId, status: run.status, receipt, text: text?.slice(textOffset, end),
        textSource: finalText !== undefined ? 'final_answer' as const : text !== undefined ? 'receipt_summary' as const : undefined,
        nextTextOffset: text && end < text.length ? end : null,
        artifacts: artifacts.slice(artifactOffset, artifactEnd).map(item => ({
          ...item, canRead: Boolean(item.mediaId || item.fileId), workspaceFileId: item.fileId,
        })),
        nextArtifactOffset: artifactEnd < artifacts.length ? artifactEnd : null,
      };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.agent_runs.artifact_read', effect: 'read', scopes: ['tasks.read'],
    description: 'Read a published file artifact as paginated base64 bytes. Use the returned nextOffset until it is null.',
    input: runIdInput.extend({ artifactId: z.string().min(1), offset: cursor.default(0),
      expectedRevision: z.string().max(256).optional() }), output: artifactOutput,
    async execute({ runId, artifactId, offset, expectedRevision }, context) {
      ownedRun(runId, context);
      const artifact = listDelegatedRunArtifacts(runId).find(item => item.artifactId === artifactId);
      if (!artifact?.mediaId && !artifact?.fileId) throw new CapabilityError('NOT_FOUND', 'Readable run artifact not found');
      const path = artifact.mediaId ? resolveMediaBufferPath(artifact.mediaId, 'outbound')
        : (await deps.getFiles().resource(artifact.fileId!).catch(() => undefined))?.absolutePath;
      if (!path) throw new CapabilityError('NOT_FOUND', 'Published file is no longer available');
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => undefined);
      if (!handle) throw new CapabilityError('NOT_FOUND', 'Published file is no longer available');
      try {
        const info = await handle.stat({ bigint: true });
        if (!info.isFile()) throw new CapabilityError('NOT_FOUND', 'Readable run artifact not found');
        const size = Number(info.size);
        const revision = createHash('sha256').update(`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`).digest('hex');
        if (expectedRevision !== undefined && expectedRevision !== revision) {
          throw new CapabilityError('REVISION_CONFLICT', 'Published file changed');
        }
        const bytes = Buffer.alloc(Math.min(48 * 1024, Math.max(0, size - offset)));
        const { bytesRead } = bytes.length ? await handle.read(bytes, 0, bytes.length, offset) : { bytesRead: 0 };
        const after = await handle.stat({ bigint: true });
        if (after.mtimeNs !== info.mtimeNs || after.ctimeNs !== info.ctimeNs || after.size !== info.size) {
          throw new CapabilityError('REVISION_CONFLICT', 'Published file changed');
        }
        context.assertCurrent?.();
        return { runId, artifactId, encoding: 'base64' as const, data: bytes.subarray(0, bytesRead).toString('base64'),
          size, revision, nextOffset: bytesRead && offset + bytesRead < size ? offset + bytesRead : null };
      } finally {
        await handle.close();
      }
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.agent_runs.events', effect: 'read', scopes: ['tasks.read'],
    description: 'Read run lifecycle events after a sequence number, optionally waiting up to 10 seconds for a change.',
    input: runIdInput.extend({ afterSequence: cursor.default(0), limit: z.number().int().min(1).max(100).default(25),
      waitMs: z.number().int().min(0).max(10_000).default(0) }), output: eventsOutput,
    async execute({ runId, afterSequence, limit, waitMs }, context) {
      const deadline = performance.now() + waitMs;
      while (true) {
        context.assertCurrent?.();
        const run = ownedRun(runId, context);
        const page = runs.listEvents(runId, afterSequence, limit + 1);
        const remaining = deadline - performance.now();
        if (page.length || remaining <= 0 || ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
          const events = page.slice(0, limit);
          return { runId, status: run.status, events, nextSequence: events.at(-1)?.sequence ?? afterSequence, hasMore: page.length > limit };
        }
        try {
          await delay(Math.min(250, remaining), undefined, { signal: context.signal });
        } catch (error) {
          if (!context.signal?.aborted) throw error;
          throw new CapabilityError('CANCELLED', 'Capability call cancelled');
        }
      }
    },
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.agent_runs.respond', effect: 'local-write', scopes: ['tasks.write'],
    description: 'Answer the current input clarification and resume the same run. Use the clarification version and answer format returned by get.',
    input: runIdInput.extend(clarificationSubmissionSchema.omit({ decision: true }).shape).extend({
      clarificationId: z.uuid(), expectedVersion: z.number().int().positive(),
    }), output: respondOutput,
    execute({ runId, clarificationId, ...answer }, context) {
      const wait = activeInputClarification(ownedRun(runId, context));
      if (!wait || wait.id !== clarificationId) throw new CapabilityError('NOT_FOUND', 'Active input clarification not found for this run');
      const result = resolveClarification({ ...answer, id: wait.id, action: 'answer', idempotencyKey: context.idempotencyKey });
      if (result.ok === false) throw new CapabilityError(result.code === 'INVALID' ? 'INVALID_INPUT' : 'REVISION_CONFLICT', 'Clarification answer could not be accepted');
      return { runId, clarificationId, status: 'queued' as const };
    },
    afterCommit({ clarificationId }) {
      const wait = getClarification(clarificationId);
      if (wait?.status === 'queued') deps.resumeClarification(wait);
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.agent_runs.get', effect: 'read', scopes: ['tasks.read'],
    description: 'Get current status and any finalized result for a delegated run started by this connection.',
    input: runIdInput.extend({ steerInputId: steerInputId.optional() }), output: runOutput,
    execute({ runId, steerInputId }, context) {
      const run = ownedRun(runId, context);
      if (!steerInputId) return runDetails(run);
      const input = run.conversationId ? getSessionInputById(run.conversationId, steerInputId) : undefined;
      if (!input || input.taskRunId !== runId || input.effectiveDelivery !== 'steer') {
        throw new CapabilityError('NOT_FOUND', 'Steering input not found for this run');
      }
      const status = input.status === 'completed' ? 'delivered' as const
        : input.status === 'queued' || input.status === 'injecting' ? 'pending' as const : 'interrupted' as const;
      return { ...runDetails(run), steer: { inputId: input.id, status } };
    },
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.agent_runs.steer', effect: 'local-write', scopes: ['tasks.write'],
    description: 'Send a follow-up instruction to this connection’s actively running delegated Agent. Query delivery with get and the returned inputId.',
    input: runIdInput.extend({ message: z.string().trim().min(1).max(8_000) }), output: steerReceipt,
    execute({ runId, message }, context) {
      const run = ownedRun(runId, context);
      if (run.status !== 'running' || !run.conversationId) {
        throw new CapabilityError('REVISION_CONFLICT', 'The delegated run is not executing an active turn');
      }
      const state = getSessionInputState(run.conversationId);
      const target = state.activeRunId ? findSessionInputByRunId(run.conversationId, state.activeRunId) : undefined;
      if (!target?.runId || target.taskRunId !== runId || state.control.paused) {
        throw new CapabilityError('REVISION_CONFLICT', 'The delegated run is not accepting steering');
      }
      if (state.inputs.filter(input => input.taskRunId === runId && input.effectiveDelivery === 'steer'
        && (input.status === 'queued' || input.status === 'injecting')).length >= 10) {
        throw new CapabilityError('UNAVAILABLE', 'Too many pending steering messages');
      }
      const input = insertSessionInput({
        id: randomUUID(), conversationId: run.conversationId, clientMessageId: `mcp-steer:${context.idempotencyKey}`,
        taskRunId: runId, targetRunId: target.runId, expectedTranscriptId: target.expectedTranscriptId,
        origin: { type: 'system', source: 'task' }, requestedDelivery: 'steer', effectiveDelivery: 'steer',
        content: message, status: 'queued',
      });
      return { runId, inputId: input.id, conversationId: run.conversationId, status: 'accepted' as const };
    },
    afterCommit: result => deps.deliverSteer(result.conversationId, result.inputId),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.agent_runs.cancel', effect: 'local-write', scopes: ['tasks.write'],
    description: 'Cancel a delegated run started by this connection and signal its active Agent to stop.',
    input: runIdInput.extend({ reason: z.string().trim().min(1).max(4096).default('Delegated run cancelled') }),
    output: cancelOutput,
    execute({ runId, reason }, context) {
      const run = ownedRun(runId, context);
      if (run.status !== 'cancelled') {
        if (run.status === 'succeeded' || run.status === 'failed') {
          throw new CapabilityError('REVISION_CONFLICT', 'Run already finished');
        }
        cancelTaskRun({ id: run.id, expectedVersion: run.version, reason, actor: context.actor, suppressAttention: true });
      }
      return { ...runDetails(runs.require(run.id)), status: 'cancelled' as const, executionStopConfirmed: false as const };
    },
    afterCommit(result) {
      deps.stop(result.runId);
      deps.wake();
    },
  }));
}
