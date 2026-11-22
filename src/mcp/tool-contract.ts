import { createHash } from 'node:crypto';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CapabilityCallSchema, type CapabilityDescriptor } from '@xopcai/gateway-contract';

import { CapabilityError } from '../capabilities/runtime/dispatcher.js';

export const MCP_SERVER_INSTRUCTIONS = [
  'xopc Gateway exposes the user’s workspace (projects, tasks, notes, files, automations, user context/memory) and agent delegation.',
  '1. Discover stable IDs with xopc_workspace_search or list tools (xopc_projects_list, xopc_tasks_list, xopc_notes_list, xopc_files_search) before calling get/read tools.',
  '2. Every write tool requires a unique idempotencyKey per write intent. If a write returns OUTCOME_UNKNOWN, retry with the exact same arguments and idempotencyKey.',
  '3. On REVISION_CONFLICT, re-read the entity with its get tool to obtain the latest version/revision before retrying with a new idempotencyKey.',
  '4. For agent delegation, call xopc_agent_runs_agents to pick the best specialist, start with xopc_agent_runs_start, monitor with xopc_agent_runs_list/get/events (or MCP Tasks), answer clarifications with xopc_agent_runs_respond, and fetch deliverables via xopc_agent_runs_result and xopc_agent_runs_artifact_read.',
].join('\n');

const NON_DESTRUCTIVE_WRITES = new Set([
  'xopc.projects.create',
  'xopc.projects.create_milestone',
  'xopc.projects.create_update',
  'xopc.notes.create',
  'xopc.notes.capture',
  'xopc.notes.append',
  'xopc.tasks.create',
  'xopc.tasks.add_context',
  'xopc.task_runs.feedback',
  'xopc.automations.draft',
  'xopc.agent_runs.start',
  'xopc.agent_runs.steer',
  'xopc.agent_runs.respond',
]);

const OPEN_WORLD_TOOLS = new Set([
  'xopc.agent_runs.start',
]);

export function toolName(id: string): string {
  return id.replaceAll('.', '_');
}

export function describeTool(item: CapabilityDescriptor): Tool {
  const write = item.effect !== 'read';
  const inputSchema: Tool['inputSchema'] = { ...item.inputSchema, type: 'object' };
  if (write) {
    inputSchema.properties = {
      ...inputSchema.properties,
      idempotencyKey: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
        description: 'Choose one stable key for this write intent. Reuse it with the exact same arguments if the outcome is uncertain.',
      },
    };
    inputSchema.required = [...new Set([...(inputSchema.required ?? []), 'idempotencyKey'])];
  }
  const destructiveHint = write && !NON_DESTRUCTIVE_WRITES.has(item.id);
  const openWorldHint = OPEN_WORLD_TOOLS.has(item.id);
  return {
    name: toolName(item.id),
    description: item.description,
    inputSchema,
    outputSchema: { ...item.outputSchema, type: 'object' },
    annotations: {
      readOnlyHint: !write,
      destructiveHint,
      idempotentHint: true,
      openWorldHint,
    },
  };
}

function sanitizeHint(hint: string | undefined): string | undefined {
  if (!hint) return undefined;
  const trimmed = hint.trim().replace(/\s+/g, ' ');
  if (!trimmed) return undefined;
  return trimmed.length > 300 ? `${trimmed.slice(0, 297)}...` : trimmed;
}

export function safeCapabilityHint(error: unknown): string | undefined {
  if (!(error instanceof CapabilityError)) return undefined;
  if (error.code === 'INTERNAL' || error.code === 'OUTCOME_UNKNOWN') return undefined;
  // Format Zod JSON array messages into compact readable field hints
  if (error.code === 'INVALID_INPUT' && error.message.startsWith('[')) {
    try {
      const issues = JSON.parse(error.message) as Array<{ path?: Array<string | number>; message?: string }>;
      if (Array.isArray(issues) && issues.length > 0) {
        const formatted = issues.slice(0, 4).map(issue => {
          const path = Array.isArray(issue.path) && issue.path.length ? issue.path.join('.') : 'input';
          return `${path}: ${issue.message ?? 'invalid'}`;
        }).join('; ');
        return sanitizeHint(formatted);
      }
    } catch {
      // fall through
    }
  }
  return sanitizeHint(error.message);
}

export function toolFailure(code: string, operationId?: string, hint?: string) {
  const safeHint = code === 'INTERNAL' || code === 'OUTCOME_UNKNOWN' ? undefined : sanitizeHint(hint);
  return {
    isError: true,
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        code,
        ...(operationId ? { operationId } : {}),
        ...(safeHint ? { hint: safeHint } : {}),
      }),
    }],
  };
}

export function toolResult(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data };
}

export function parseToolArguments(item: CapabilityDescriptor, args: Record<string, unknown> = {}) {
  const { idempotencyKey, ...input } = args;
  if (item.effect === 'read') return idempotencyKey === undefined ? { input } : undefined;
  const key = CapabilityCallSchema.shape.idempotencyKey.safeParse(idempotencyKey);
  return key.success && key.data?.trim() ? { input, idempotencyKey: key.data } : undefined;
}

export function scopedMcpIdempotencyKey(principalId: string, capabilityId: string, key?: string): string | undefined {
  // Domain-level deduplication must be isolated even when distinct callers choose the same key.
  return key?.trim() ? createHash('sha256').update(JSON.stringify([principalId, capabilityId, key])).digest('hex') : undefined;
}
