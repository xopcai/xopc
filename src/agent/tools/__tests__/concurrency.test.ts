import { describe, expect, it } from 'vitest';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import { wrapToolsWithProtection } from '../executor.js';

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeTool(name: string, events: string[], gate?: Promise<void>, metadata: Record<string, unknown> = {}): AgentTool {
  return {
    name,
    description: name,
    parameters: {} as any,
    ...metadata,
    async execute() {
      events.push(`${name}:start`);
      await gate;
      events.push(`${name}:end`);
      return { content: [{ type: 'text', text: name }], details: {} };
    },
  } as AgentTool;
}

describe('tool concurrency wrapper', () => {
  it('runs supportsParallel read-only tools concurrently', async () => {
    const events: string[] = [];
    const gate = deferred<void>();
    const [a, b] = wrapToolsWithProtection([
      makeTool('a', events, gate.promise, { supportsParallel: true, idempotent: true }),
      makeTool('b', events, undefined, { supportsParallel: true, idempotent: true }),
    ]);

    const pa = a.execute('a', {});
    await Promise.resolve();
    const pb = b.execute('b', {});
    await Promise.resolve();

    expect(events).toEqual(['a:start', 'b:start', 'b:end']);
    gate.resolve();
    await Promise.all([pa, pb]);
    expect(events).toEqual(['a:start', 'b:start', 'b:end', 'a:end']);
  });

  it('serializes workspace-mutating tools', async () => {
    const events: string[] = [];
    const gate = deferred<void>();
    const [a, b] = wrapToolsWithProtection([
      makeTool('a', events, gate.promise, { mutatesWorkspace: true, mutationScope: 'workspace' }),
      makeTool('b', events, undefined, { mutatesWorkspace: true, mutationScope: 'workspace' }),
    ]);

    const pa = a.execute('a', {});
    await Promise.resolve();
    const pb = b.execute('b', {});
    await Promise.resolve();

    expect(events).toEqual(['a:start']);
    gate.resolve();
    await Promise.all([pa, pb]);
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });
});
