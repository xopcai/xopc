import type { AgentTool } from '@earendil-works/pi-agent-core';
import { AsyncLocalStorage } from 'node:async_hooks';

import { acquireData, type DataSourceOptions } from '../data-acquisition/service.js';
import { DataBatchSchema, type DataBatchArgs } from '../data-acquisition/schema.js';
import { renderDataBatch } from '../data-acquisition/render.js';
import { createLogger } from '../../utils/logger.js';

const executionTools = new AsyncLocalStorage<ReadonlySet<string>>();
const log = createLogger('DataAcquisition');

export function withDataToolPermissions<T>(names: ReadonlySet<string>, run: () => T): T {
  return executionTools.run(names, run);
}

export function createDataBatchTool(workspace: string, getAllowedTools: () => ReadonlySet<string>, options: DataSourceOptions = {}): AgentTool {
  return {
    name: 'data_batch', label: 'Read and search data', parameters: DataBatchSchema,
    description: 'Acquire up to eight independent file, Git, knowledge, web or host-approved external reads using existing permissions. external_read requires a described batchRead contract, exact revision and explicit account. Items retain status and source. File search patterns use OR. Use original tools for single items; submit dependent queries later. Partial results are not a complete inventory.',
    supportsParallel: true, idempotent: false,
    async execute(_id: string, args: DataBatchArgs, signal?: AbortSignal) {
      const started = Date.now();
      const active = executionTools.getStore();
      const allowed = new Set([...getAllowedTools()].filter(name => !active || active.has(name)));
      const { text, result } = renderDataBatch(await acquireData(workspace, args, allowed, signal, options));
      log.debug({ toolCallId: _id, durationMs: Date.now() - started, operations: result.operations.length,
        sourceRequests: result.sourceRequests, outputChars: text.length,
        partialCount: result.operations.filter(op => op.status !== 'ok').length }, 'Batch data acquisition completed');
      return { content: [{ type: 'text', text }], details: {
        status: result.operations.every(op => op.status === 'cancelled') ? 'cancelled'
          : result.operations.every(op => op.status === 'error' || op.status === 'denied' || op.status === 'cancelled') ? 'failed' : 'completed',
        operationCount: result.operations.length, sourceRequests: result.sourceRequests,
        partialCount: result.operations.filter(op => op.status !== 'ok').length,
      } };
    },
  } as AgentTool;
}
