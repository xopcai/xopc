import crypto from 'node:crypto';

import type { AgentToolResult } from '@earendil-works/pi-agent-core';

import type { ExecutionHostRegistry } from '../execution-hosts/registry.js';
import type {
  WorkspaceExecutionBackend,
  WorkspaceExecutionCall,
} from '../agent/tools/workspace-execution-backend.js';
import { ExecutionEnvironmentStore } from './store.js';

const DEFAULT_TOOL_DEADLINE_MS = 30 * 60_000;

const REQUIRED_CAPABILITY = {
  read_file: undefined,
  write_file: 'patch',
  apply_patch: 'patch',
  list_dir: undefined,
  grep: 'search',
  find: 'search',
  exec_command: 'shell',
  managed_job: 'shell',
} as const;

function isToolResult(value: unknown): value is AgentToolResult<unknown> {
  return Boolean(
    value
    && typeof value === 'object'
    && Array.isArray((value as { content?: unknown }).content)
    && Object.hasOwn(value, 'details'),
  );
}

export class RemoteWorkspaceExecutionBackend implements WorkspaceExecutionBackend {
  readonly placement = 'remote' as const;
  private readonly store: ExecutionEnvironmentStore;

  constructor(private readonly options: {
    sessionKey: string;
    registry: ExecutionHostRegistry;
    store?: ExecutionEnvironmentStore;
    deadlineMs?: number;
  }) {
    this.store = options.store ?? new ExecutionEnvironmentStore();
  }

  async execute(call: WorkspaceExecutionCall): Promise<AgentToolResult<unknown>> {
    const binding = this.store.resolveBinding('session', this.options.sessionKey);
    if (!binding) throw new Error(`Session has no execution environment: ${this.options.sessionKey}`);
    const environment = this.store.getRequired(binding.environmentId);
    if (environment.hostId === 'local') {
      throw new Error('Remote execution backend cannot execute a local environment');
    }
    if (environment.status !== 'ready' && environment.status !== 'busy') {
      throw new Error(`Execution environment ${environment.id} is ${environment.status}`);
    }
    const host = this.options.registry.get(environment.hostId);
    if (!host) throw new Error(`Execution host is offline: ${environment.hostId}`);
    const requiredCapability = REQUIRED_CAPABILITY[call.toolName];
    if (requiredCapability && !host.hello.capabilities[requiredCapability]) {
      throw new Error(`Execution host does not support ${call.toolName}`);
    }
    if (call.signal?.aborted) throw call.signal.reason;

    const operationId = crypto.randomUUID();
    const idempotencyKey = crypto.createHash('sha256').update([
      environment.id,
      String(binding.epoch),
      call.toolName,
      call.toolCallId,
    ].join('\0')).digest('hex');
    const onAbort = () => {
      this.options.registry.cancel(environment.hostId, operationId, 'Workspace tool call aborted');
    };
    call.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await this.options.registry.execute(environment.hostId, {
        operationId,
        environmentId: environment.id,
        bindingEpoch: binding.epoch,
        deadlineAt: Date.now() + (this.options.deadlineMs ?? DEFAULT_TOOL_DEADLINE_MS),
        idempotencyKey,
        command: 'workspace.execute_tool',
        payload: {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          params: call.params,
        },
      }, (update) => {
        if (isToolResult(update)) call.onUpdate?.(update);
      });
      if (!isToolResult(result)) throw new Error('Execution host returned an invalid workspace tool result');
      return result;
    } finally {
      call.signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** Resolve the active placement at call time and fence non-runnable environments. */
export class SessionWorkspaceExecutionBackend implements WorkspaceExecutionBackend {
  private readonly store: ExecutionEnvironmentStore;

  constructor(private readonly options: {
    sessionKey: string;
    registry: ExecutionHostRegistry;
    localBackend: WorkspaceExecutionBackend;
    store?: ExecutionEnvironmentStore;
  }) {
    this.store = options.store ?? new ExecutionEnvironmentStore();
  }

  get placement(): 'local' | 'remote' {
    const binding = this.store.resolveBinding('session', this.options.sessionKey);
    return binding && this.store.get(binding.environmentId)?.hostId !== 'local' ? 'remote' : 'local';
  }

  async execute(call: WorkspaceExecutionCall): Promise<AgentToolResult<unknown>> {
    const binding = this.store.resolveBinding('session', this.options.sessionKey);
    if (!binding) return this.options.localBackend.execute(call);
    const environment = this.store.getRequired(binding.environmentId);
    if (environment.status !== 'ready' && environment.status !== 'busy') {
      throw new Error(`Execution environment ${environment.id} is ${environment.status}`);
    }
    if (environment.hostId === 'local') return this.options.localBackend.execute(call);
    return new RemoteWorkspaceExecutionBackend({
      sessionKey: this.options.sessionKey,
      registry: this.options.registry,
      store: this.store,
    }).execute(call);
  }
}
