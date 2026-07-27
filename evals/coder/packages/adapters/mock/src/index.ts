import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  TraceEmitter,
  type AgentAdapter,
  type AgentRunResult,
  type RunRequest,
  type TraceEvent,
} from '@agent-evals/protocol';

interface MockConfig {
  delayMs?: number;
  finalText?: string;
  fail?: boolean;
  writes?: Array<{ path: string; content: string }>;
}

export class MockAdapter implements AgentAdapter {
  readonly id = 'mock';

  async run(
    request: RunRequest,
    onEvent: (event: TraceEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<AgentRunResult> {
    const config = (request.variant.config ?? {}) as MockConfig;
    const trace = new TraceEmitter(request.runId, onEvent);
    await trace.emit('run.started', { adapter: this.id, variantId: request.variant.id });
    await trace.emit('prompt.built', {
      taskChars: request.evalCase.task.length,
      task: request.evalCase.task,
    });

    if (config.delayMs) {
      await new Promise<void>((resolvePromise, reject) => {
        const timer = setTimeout(resolvePromise, config.delayMs);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Mock run aborted', 'AbortError'));
        }, { once: true });
      });
    }
    if (signal.aborted) throw new DOMException('Mock run aborted', 'AbortError');

    for (const write of config.writes ?? []) {
      const path = resolve(request.environment.workspace, write.path);
      const rel = relative(request.environment.workspace, path);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error(`Mock write escapes workspace: ${write.path}`);
      }
      await mkdir(dirname(path), { recursive: true });
      await trace.emit('tool.started', { toolName: 'write_file', path: write.path });
      await writeFile(path, write.content);
      await trace.emit('tool.finished', {
        toolName: 'write_file',
        path: write.path,
        success: true,
      });
    }

    if (config.fail) {
      await trace.emit('run.failed', { error: 'Configured mock failure' });
      return { status: 'failed', finalText: '', error: 'Configured mock failure' };
    }
    const finalText = config.finalText ?? 'Mock run completed';
    await trace.emit('model.response', {
      model: request.variant.model ?? 'mock',
      outputChars: finalText.length,
      usage: { input: 1, output: 1, total: 2 },
    });
    await trace.emit('run.completed', { finalText });
    return {
      status: 'completed',
      finalText,
      sessionKey: `agent:${request.variant.agentId ?? 'coder'}:eval:${request.runId}`,
      agentRunId: request.runId,
      usage: { input: 1, output: 1, total: 2 },
    };
  }
}
