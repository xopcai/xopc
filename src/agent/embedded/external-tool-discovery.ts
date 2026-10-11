import { createHash } from 'node:crypto';

import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';

import { parseExternalToolRef } from '../external-tools/refs.js';
import { getExternalToolRegistry } from '../external-tools/tool-registry.js';
import { wrapToolsWithProtection } from '../tools/executor.js';
import { getEmbeddedExecutionRunId, runWithEmbeddedExecutionSession } from './execution-context.js';
import { setXopcToolMetadata } from './tool-metadata.js';

/** Project the current host directory into pi; pi owns search and declaration loading. */
export async function materializeNativeExternalTools(params: {
  conversationId: string; tools: readonly AgentTool[];
}): Promise<AgentTool[]> {
  const registry = getExternalToolRegistry(params.tools);
  if (!registry) return [];
  return runWithEmbeddedExecutionSession(params.conversationId, async () => {
    const descriptors = await registry.service.catalog(registry.nativeSources);
    const names = new Set(params.tools.map(tool => tool.name));
    const refs = new Map<string, string>();
    return wrapToolsWithProtection(descriptors.map(descriptor => {
      const parsed = parseExternalToolRef(descriptor.toolRef, descriptor.source);
      if (!parsed) throw new Error('Invalid native tool identity');
      const suffix = createHash('sha256').update(descriptor.toolRef).digest('hex').slice(0, 12);
      const prefix = descriptor.source === 'endpoint' ? 'device' : descriptor.source;
      const name = `${prefix}__${parsed.toolName.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40)}_${suffix}`;
      if (names.has(name)) throw new Error(`Native tool identifier collision: ${name}`);
      names.add(name);
      refs.set(name, descriptor.toolRef);
      return setXopcToolMetadata({
        name, label: descriptor.title, description: `${descriptor.description}\n${descriptor.summary}`,
        parameters: descriptor.inputSchema as TSchema,
        execute(id, args, signal, update) {
          return runWithEmbeddedExecutionSession(params.conversationId, () => registry.execute(id, {
            toolRef: descriptor.toolRef, revision: descriptor.revision, arguments: args,
            ...(descriptor.batchRead ? { readOnly: true } : {}),
          }, signal, update), getEmbeddedExecutionRunId());
        },
      }, { exposure: descriptor.exposure === 'model-only' ? 'model-only' : 'deferred', namespace: { name: `${prefix}__${createHash('sha256').update(parsed.namespace).digest('hex').slice(0, 12)}`,
        description: descriptor.source === 'endpoint' ? 'Tools of the current authorized device' : descriptor.namespace },
        outputSchema: descriptor.outputSchema as TSchema | undefined, annotations: descriptor.annotations,
        external: { toolRef: descriptor.toolRef, revision: descriptor.revision, readOnly: descriptor.batchRead === true },
        ...(registry.subscribeInvalidation ? { subscribeInvalidation: (listener: () => void) =>
          registry.subscribeInvalidation!(params.conversationId, descriptor.toolRef, listener) } : {}),
      });
    }), { ...registry.executorConfig, resolveTimeoutMs: name =>
      registry.executorConfig?.resolveTimeoutMs?.(refs.get(name) ?? name)
        ?? registry.executorConfig?.resolveTimeoutMs?.('xopc_tool_execute') });
  }, getEmbeddedExecutionRunId());
}
