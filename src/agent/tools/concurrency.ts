import type { AgentTool } from '@earendil-works/pi-agent-core';

import { getToolMetadata } from './metadata.js';

export type ToolLockMode = 'none' | 'exclusive';

export function resolveToolLockMode(tool: AgentTool<any, any>): ToolLockMode {
  const meta = getToolMetadata(tool);
  if (meta.supportsParallel && !meta.mutatesWorkspace && meta.mutationScope === 'none') {
    return 'none';
  }
  return 'exclusive';
}

export class ToolConcurrencyController {
  private tail: Promise<void> = Promise.resolve();

  run<T>(mode: ToolLockMode, fn: () => Promise<T>): Promise<T> {
    if (mode === 'none') {
      return fn();
    }
    return this.runExclusive(fn);
  }

  private async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
