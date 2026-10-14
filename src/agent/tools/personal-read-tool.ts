import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { registerNoteReadCapabilities } from '../../notes/capabilities/read.js';
import { registerProjectReadCapabilities } from '../../projects/capabilities/read.js';
import { registerAutomationReadCapabilities } from '../../automations/capabilities/read.js';
import type { XopcUseToolDeps } from './xopc-use-tool.js';
import { LOCAL_READ_MAX_CHARS } from './local-read-budget.js';

const schema = Type.Object({
  kind: Type.Union([Type.Literal('note'), Type.Literal('project'), Type.Literal('automation')]),
  command: Type.Union([Type.Literal('list'), Type.Literal('get')]),
  id: Type.Optional(Type.String()),
  search: Type.Optional(Type.String({ maxLength: 500 })),
  projectId: Type.Optional(Type.String()),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
}, { additionalProperties: false, anyOf: [
  { properties: { command: { const: 'list' } } },
  { properties: { command: { const: 'get' } }, required: ['id'] },
] });

const fields = ['id', 'name', 'title', 'status', 'kind', 'projectId', 'description', 'markdown',
  'objective', 'enabled', 'createdAt', 'updatedAt', 'createdAtMs', 'updatedAtMs', 'trigger', 'action', 'state'] as const;

/** Small projections keep local reads from expanding the next model request. */
function compact(value: unknown, textLimit: number): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  const truncatedFields: string[] = [];
  for (const key of fields) {
    const entry = source[key];
    if (typeof entry === 'string') {
      result[key] = entry.slice(0, textLimit);
      if (entry.length > textLimit) truncatedFields.push(key);
    }
    else if (typeof entry === 'number' || typeof entry === 'boolean' || entry === null) result[key] = entry;
    else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const nested = Object.entries(entry);
      if (nested.length > 12 || nested.some(([, item]) => typeof item === 'string' && item.length > 200 || item !== null && typeof item === 'object')) truncatedFields.push(key);
      result[key] = Object.fromEntries(nested.slice(0, 12)
        .filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item) || item === null)
        .map(([field, item]) => [field, typeof item === 'string' ? item.slice(0, 200) : item]));
    } else if (Array.isArray(entry)) truncatedFields.push(key);
  }
  if (truncatedFields.length) result.truncatedFields = truncatedFields;
  return result;
}

export function createPersonalReadTool(deps: XopcUseToolDeps): AgentTool {
  const dispatcher = new CapabilityDispatcher();
  if (deps.getNotesService) registerNoteReadCapabilities(dispatcher, () => {
    const notes = deps.getNotesService!();
    if (!notes) throw new Error('Notes service unavailable');
    return notes;
  });
  const projects = deps.getProjectService?.();
  if (projects) registerProjectReadCapabilities(dispatcher, projects);
  const automations = deps.getAutomationService?.();
  if (automations) registerAutomationReadCapabilities(dispatcher, automations, projects);
  return {
    name: 'personal_read', label: 'Read local objects',
    description: 'Read local notes, projects or automation state. Only list/get; bounded excerpts, no network or model calls. Use personal_task for delegated tasks.',
    parameters: schema, supportsParallel: true, idempotent: true,
    async execute(_id, raw, signal) {
      const input = raw as { kind: string; command: string; id?: string; search?: string; projectId?: string; offset?: number; limit?: number };
      if (!['note', 'project', 'automation'].includes(input.kind) || !['list', 'get'].includes(input.command)) {
        throw new Error('Only local note/project/automation list/get is supported');
      }
      if (input.command === 'get' && !input.id?.trim()) throw new Error('id is required');
      if (input.kind === 'automation' && input.search) throw new Error('Automation search is unsupported; use list');
      const family = input.kind === 'note' ? 'notes' : input.kind === 'project' ? 'projects' : 'automations';
      const operation = `xopc.${family}.${input.command}`;
      const limit = Math.min(10, Math.max(1, input.limit ?? 5));
      const offset = Math.max(0, input.offset ?? 0);
      const args = input.command === 'get' ? { id: input.id } : input.kind === 'automation'
        ? { ...(input.projectId ? { projectId: input.projectId } : {}) }
        : { limit, offset, ...(input.search ? { search: input.search } : {}),
          ...(input.kind === 'note' && input.projectId ? { projectId: input.projectId } : {}) };
      const result = await dispatcher.call(operation, args, {
        principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`, surface: 'agent',
        scopes: ['workspace.read', 'automations.read'], allowedCapabilities: [operation],
        authorize: deps.authorizeCapability ?? (() => true), signal,
      }) as Record<string, unknown>;
      let payload: Record<string, unknown>;
      if (input.command === 'get') {
        payload = { kind: input.kind, item: compact(result[input.kind], 6000), excerpts: true };
      } else {
        const rows = (result.items ?? []) as unknown[];
        const selected = input.kind === 'automation' ? rows.slice(offset, offset + limit) : rows;
        payload = { kind: input.kind, items: selected.map(row => compact(row, 200)), offset,
          total: result.total ?? rows.length, nextOffset: offset + selected.length < Number(result.total ?? rows.length) ? offset + selected.length : undefined, excerpts: true };
      }
      const serialized = JSON.stringify(payload);
      const requiresSpecialist = input.command === 'get' && (serialized.length > LOCAL_READ_MAX_CHARS
        || Boolean((payload.item as Record<string, unknown>)?.truncatedFields));
      if (requiresSpecialist) payload = { ...payload, requiresSpecialist: true, reason: 'large_object', id: input.id,
        guidance: 'Briefly tell the user the material is large, then delegate full reading and processing using this object kind and ID.' };
      let output = JSON.stringify(payload);
      let complete = true;
      while (output.length > LOCAL_READ_MAX_CHARS) {
        if (input.command === 'list') {
          const items = payload.items as Record<string, unknown>[];
          if (!items.length) break;
          items.pop();
          payload.nextOffset = offset + items.length;
          payload.truncated = true;
        } else {
          const item = payload.item as Record<string, unknown>;
          const largest = Object.keys(item).filter(key => typeof item[key] === 'string' && (item[key] as string).length > 200)
            .sort((a, b) => (item[b] as string).length - (item[a] as string).length)[0];
          if (!largest) break;
          item[largest] = (item[largest] as string).slice(0, Math.floor((item[largest] as string).length / 2));
          item.truncatedFields = [...new Set([...(item.truncatedFields as string[] ?? []), largest])];
          payload.truncated = true;
        }
        output = JSON.stringify(payload);
      }
      if (output.length > LOCAL_READ_MAX_CHARS) {
        complete = false;
        output = JSON.stringify({ kind: input.kind, id: input.id, search: input.search,
          requiresSpecialist: true, complete: false, reason: 'large_object' });
      }
      return { content: [{ type: 'text', text: output }],
        details: { localOnly: true, requiresSpecialist: requiresSpecialist || !complete } };
    },
  } as AgentTool;
}
