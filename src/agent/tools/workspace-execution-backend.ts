import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from '@earendil-works/pi-agent-core';

export const WORKSPACE_EXECUTION_TOOL_NAMES = [
  'read_file',
  'write_file',
  'apply_patch',
  'list_dir',
  'grep',
  'find',
  'exec_command',
  'managed_job',
] as const;

export type WorkspaceExecutionToolName = (typeof WORKSPACE_EXECUTION_TOOL_NAMES)[number];

export interface WorkspaceExecutionCall {
  toolCallId: string;
  toolName: WorkspaceExecutionToolName;
  params: unknown;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<unknown>;
}

export interface WorkspaceExecutionBackend {
  readonly placement: 'local' | 'remote';
  execute(call: WorkspaceExecutionCall): Promise<AgentToolResult<unknown>>;
}

const WORKSPACE_EXECUTION_TOOL_NAME_SET = new Set<string>(WORKSPACE_EXECUTION_TOOL_NAMES);

export function isWorkspaceExecutionToolName(value: string): value is WorkspaceExecutionToolName {
  return WORKSPACE_EXECUTION_TOOL_NAME_SET.has(value);
}

export class LocalWorkspaceExecutionBackend implements WorkspaceExecutionBackend {
  readonly placement = 'local' as const;
  private readonly tools: ReadonlyMap<WorkspaceExecutionToolName, AgentTool<any, any>>;

  constructor(tools: readonly AgentTool<any, any>[]) {
    const registered = new Map<WorkspaceExecutionToolName, AgentTool<any, any>>();
    for (const tool of tools) {
      if (!isWorkspaceExecutionToolName(tool.name)) {
        throw new Error(`Unsupported local workspace execution tool: ${tool.name}`);
      }
      if (registered.has(tool.name)) {
        throw new Error(`Duplicate local workspace execution tool: ${tool.name}`);
      }
      registered.set(tool.name, tool);
    }
    for (const name of WORKSPACE_EXECUTION_TOOL_NAMES) {
      if (!registered.has(name)) {
        throw new Error(`Missing local workspace execution tool: ${name}`);
      }
    }
    this.tools = registered;
  }

  async execute(call: WorkspaceExecutionCall): Promise<AgentToolResult<unknown>> {
    const tool = this.tools.get(call.toolName);
    if (!tool) throw new Error(`Workspace execution tool is unavailable: ${call.toolName}`);
    return tool.execute(
      call.toolCallId,
      call.params,
      call.signal,
      call.onUpdate,
    ) as Promise<AgentToolResult<unknown>>;
  }
}

/**
 * Keep the model-visible tool contracts local while routing execution through a
 * placement-aware backend. Remote hosts therefore execute a fixed allowlist;
 * they never advertise arbitrary tools to the model.
 */
export function bindWorkspaceExecutionTools(
  definitions: readonly AgentTool<any, any>[],
  backend: WorkspaceExecutionBackend,
): AgentTool<any, any>[] {
  return definitions.map((definition) => {
    if (!isWorkspaceExecutionToolName(definition.name)) {
      throw new Error(`Unsupported workspace execution tool definition: ${definition.name}`);
    }
    const toolName = definition.name;
    return {
      ...definition,
      execute: (
        toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
        onUpdate?: AgentToolUpdateCallback<unknown>,
      ) => backend.execute({
        toolCallId,
        toolName,
        params,
        ...(signal ? { signal } : {}),
        ...(onUpdate ? { onUpdate } : {}),
      }),
    } as AgentTool<any, any>;
  });
}
