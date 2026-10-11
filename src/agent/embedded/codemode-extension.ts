import { AsyncLocalStorage } from 'node:async_hooks';

import type { AgentTool, BeforeToolCallContext } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import {
  createCodemodeExtension,
  type AgentSession, type ExtensionFactory, type ExtensionToolContext,
} from '@earendil-works/pi-coding-agent';

import type { EffectiveAgentConfig } from '../../agent-config/schema.js';
import { isCodemodeCoreRead } from '../tools/codemode-permissions.js';
import { withDataToolPermissions } from '../tools/dataBatch.js';
import { getXopcToolMetadata } from './tool-metadata.js';
import { retainCodemodeOutput } from './codemode-output.js';

export type CodemodePolicy = NonNullable<EffectiveAgentConfig['runtime']['codemode']>;
const MAX_STORE_BYTES = 64 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024;

type Execution = { parentId: string; signal: AbortSignal; ctx: ExtensionToolContext };

/** Public pi extension, restricted to core reads and the current xopc turn policy. */
export function createXopcCodemodeExtension(
  policy: CodemodePolicy,
  tools: readonly AgentTool[],
  getSession: () => AgentSession | undefined,
): ExtensionFactory {
  const allowed = new Set(tools.filter(tool => isCodemodeCoreRead(tool)
    || getXopcToolMetadata(tool)?.external?.readOnly === true).map(tool => tool.name));
  const isAllowed = (name: string) => allowed.has(name) || name.startsWith('mcp__')
    || ['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'].includes(name);
  const inlineReads = tools.filter(isCodemodeCoreRead).map(tool => tool.name);
  const execution = new AsyncLocalStorage<Execution>();
  const original = createCodemodeExtension({ mode: 'on', models: false });

  const contextFor = (id: string, name: string, args: unknown): BeforeToolCallContext => {
    const session = getSession();
    const assistantMessage = session?.agent.state.messages.findLast(message => message.role === 'assistant');
    if (!session || assistantMessage?.role !== 'assistant') throw new Error('Codemode needs an active xopc turn');
    return {
      assistantMessage, toolCall: { type: 'toolCall', id, name, arguments: args as BeforeToolCallContext['toolCall']['arguments'] }, args,
      context: { messages: session.agent.state.messages, tools: session.agent.state.tools },
    };
  };

  return pi => {
    pi.on('tool_call', async event => {
      if (!event.parentToolCallId) return;
      const active = execution.getStore();
      if (!active || active.parentId !== event.parentToolCallId || !isAllowed(event.toolName)) {
        return { block: true, reason: 'Codemode tool is not authorized' };
      }
      active.signal.throwIfAborted();
      return getSession()?.agent.beforeToolCall?.(contextFor(event.toolCallId, event.toolName, event.input), active.signal);
    });
    pi.on('tool_result', async event => {
      if (!event.parentToolCallId) return;
      const active = execution.getStore();
      if (!active || active.parentId !== event.parentToolCallId) {
        return { content: [{ type: 'text', text: 'Codemode execution is no longer active' }], isError: true };
      }
      try {
        return await getSession()?.agent.afterToolCall?.({
          ...contextFor(event.toolCallId, event.toolName, event.input),
          result: { content: event.content, details: event.details, structuredContent: event.structuredContent, usage: event.usage },
          isError: event.isError,
        }, active.signal);
      } catch {
        return { content: [{ type: 'text', text: 'Codemode result policy failed' }], details: {}, isError: true };
      }
    });

    return original({
      ...pi,
      appendEntry(customType, data) {
        if (customType !== 'codemode-store') throw new Error('Unsupported Codemode entry');
        const active = execution.getStore();
        if (!active || active.signal.aborted) throw new Error('Codemode execution is no longer active');
        if (Buffer.byteLength(JSON.stringify(data)) > MAX_STORE_BYTES) throw new Error('Codemode store writes exceed 64 KiB');
        const state: Record<string, unknown> = Object.create(null);
        const apply = (value: unknown) => {
          const writes = value as { set?: Record<string, unknown>; delete?: string[] };
          for (const key of writes.delete ?? []) delete state[key];
          Object.assign(state, writes.set ?? {});
        };
        for (const entry of active.ctx.sessionManager.getBranch()) {
          if (entry.type === 'custom' && entry.customType === customType) apply(entry.data);
        }
        apply(data);
        if (Object.keys(state).length > 64 || Buffer.byteLength(JSON.stringify(state)) > MAX_STORE_BYTES) {
          throw new Error('Codemode store exceeds 64 keys or 64 KiB');
        }
        pi.appendEntry(customType, data);
      },
      registerTool(definition) {
        const prepare = definition.prepareLoadout;
        pi.registerTool({
          ...definition,
          prepareLoadout(loadout) {
            const changes = prepare?.({ ...loadout, callable: loadout.callable.filter(tool => isAllowed(tool.name)) });
            return { ...changes, descriptions: {
              ...changes?.descriptions,
              codemode: `${changes?.descriptions?.codemode ?? definition.description}\n\nCore reads: ${inlineReads.join(', ') || '(none)'}. Host-approved deferred reads and native MCP tools can be found with searchTools(). Host limits: ${policy.timeoutMs}ms, ${policy.maxConcurrentCalls} concurrent calls, ${policy.maxCalls} calls, ${policy.maxOutputTokens} estimated output tokens. Store: 64 keys / 64 KiB. Models APIs are unavailable.`,
            } };
          },
          async execute(id, params, signal, onUpdate, ctx) {
            if (!ctx) throw new Error('Codemode needs an active session');
            const input = params as { code: string };
            if (Buffer.byteLength(input.code) > MAX_SOURCE_BYTES) throw new Error('Codemode source exceeds 64 KiB');
            const source = boundCodemodeSource(input.code, policy);
            const deadline = AbortSignal.timeout(policy.timeoutMs);
            const budgetAbort = new AbortController();
            const combined = AbortSignal.any([deadline, budgetAbort.signal, ...(signal ? [signal] : [])]);
            let calls = 0;
            let running = 0;
            const waiting = new Set<() => void>();
            const boundedContext: ExtensionToolContext = {
              ...ctx,
              tools: ctx.tools.filter(tool => isAllowed(tool.name)),
              async executeTool(name, args, options) {
                if (!isAllowed(name)) throw new Error(`Codemode tool ${name} is not authorized`);
                if (++calls > policy.maxCalls) {
                  const error = new Error(`Codemode exceeds ${policy.maxCalls} calls`);
                  budgetAbort.abort(error);
                  throw error;
                }
                const callSignal = options?.signal ? AbortSignal.any([combined, options.signal]) : combined;
                while (running >= policy.maxConcurrentCalls) {
                  callSignal.throwIfAborted();
                  await new Promise<void>(resolve => {
                    const wake = () => { waiting.delete(wake); callSignal.removeEventListener('abort', wake); resolve(); };
                    waiting.add(wake);
                    callSignal.addEventListener('abort', wake, { once: true });
                  });
                }
                callSignal.throwIfAborted();
                running++;
                try {
                  return await execution.run({ parentId: id, signal: callSignal, ctx },
                    () => ctx.executeTool(name, args, { ...options, signal: callSignal }));
                } finally {
                  running--;
                  waiting.values().next().value?.();
                }
              },
            };
            return execution.run({ parentId: id, signal: combined, ctx }, () => withDataToolPermissions(allowed, async () => {
              const result = await definition.execute(id, { ...params, code: source }, combined, onUpdate, boundedContext);
              const details = result.details as Record<string, unknown>;
              let outputPath: string | undefined;
              if (details.fullOutputPath) {
                try { outputPath = await retainCodemodeOutput(ctx.cwd, details.fullOutputPath); }
                catch { /* The bounded result remains usable when output retention fails. */ }
              }
              // pi bounds raw sandbox output (16 MiB / 100,000 items); also bound all content
              // sent to the model, including image payloads, headers and truncation notices.
              let remaining = policy.maxOutputTokens * 4;
              const link = outputPath ? `Full Codemode output: ${outputPath}\n` : '';
              const retainedLink = link.length <= remaining ? link : '';
              remaining -= retainedLink.length;
              const content = result.content.flatMap<TextContent | ImageContent>(block => {
                if (block.type === 'image') {
                  if (block.data.length > remaining) return [];
                  remaining -= block.data.length;
                  return [block];
                }
                const text = block.text.replace(/\[Full output: [^\n]+\]/g, '').slice(0, remaining);
                remaining -= text.length;
                return text ? [{ type: 'text' as const, text }] : [];
              });
              details.fullOutputPath = outputPath;
              return { ...result, content: [...(retainedLink ? [{ type: 'text' as const, text: retainedLink }] : []), ...content] };
            }));
          },
        });
      },
    });
  };
}

export function boundCodemodeSource(source: string, policy: CodemodePolicy): string {
  const match = /^\s*\/\/\s*@options:\s*([^\r\n]*)(?:\r?\n|$)/.exec(source);
  const options = match ? JSON.parse(match[1]) as Record<string, unknown> : {};
  const clamp = (value: unknown, limit: number) => typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), limit) : limit;
  return `// @options: ${JSON.stringify({ timeout_ms: clamp(options.timeout_ms, policy.timeoutMs), max_output_tokens: clamp(options.max_output_tokens, policy.maxOutputTokens) })}\n${match ? source.slice(match[0].length) : source}`;
}
