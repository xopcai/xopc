import { describe, expect, it } from 'vitest';

import { runWorkflow } from '../runtime.js';
import type { SubagentRunOptions, SubagentRunner } from '../types.js';

class StubRunner implements SubagentRunner {
  public calls: Array<{ prompt: string; opts: SubagentRunOptions<unknown> }> = [];

  constructor(private readonly responder: (prompt: string) => unknown) {}

  async run<T = string>(prompt: string, opts: SubagentRunOptions<T>): Promise<T | null> {
    this.calls.push({ prompt, opts: opts as SubagentRunOptions<unknown> });
    return this.responder(prompt) as T | null;
  }
}

describe('runWorkflow', () => {
  it('runs a single agent and returns its result', async () => {
    const runner = new StubRunner(() => 'hello world');
    const script = `export const meta = { name: 'demo', description: 'd' }
const r = await agent('say hi', { label: 'hi' })
return r
`;
    const res = await runWorkflow<string>(script, { runner }, { cwd: '/tmp' });
    expect(res.result).toBe('hello world');
    expect(res.agentCount).toBe(1);
    expect(runner.calls[0].opts.label).toBe('hi');
  });

  it('passes structured-output schema through to the runner', async () => {
    const runner = new StubRunner(() => ({ ok: true }));
    const script = `export const meta = { name: 'demo', description: 'd' }
return await agent('do', { label: 'x', schema: { type: 'object' } })
`;
    const res = await runWorkflow<{ ok: boolean }>(script, { runner }, { cwd: '/tmp' });
    expect(res.result).toEqual({ ok: true });
    expect(runner.calls[0].opts.schema).toEqual({ type: 'object' });
  });

  it('runs parallel agents concurrently and preserves input order', async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const runner = new StubRunner(async () => 'x') as unknown as SubagentRunner & { run: any };
    const original = runner.run.bind(runner);
    runner.run = async (...args: any[]) => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight--;
      return original(...args);
    };

    const script = `export const meta = { name: 'demo', description: 'd' }
const items = ['a', 'b', 'c', 'd']
const out = await parallel(items.map((it) => () => agent('do ' + it, { label: it })))
return out
`;
    const res = await runWorkflow<string[]>(script, { runner }, { cwd: '/tmp', concurrency: 4 });
    expect(res.result).toEqual(['x', 'x', 'x', 'x']);
    expect(peakInFlight).toBeGreaterThan(1);
  });

  it('rejects parallel() called with promises instead of thunks', async () => {
    const runner = new StubRunner(() => 'x');
    const script = `export const meta = { name: 'demo', description: 'd' }
const items = ['a', 'b']
await parallel(items.map((it) => agent('do ' + it, { label: it })))
`;
    await expect(runWorkflow(script, { runner }, { cwd: '/tmp' })).rejects.toThrow(/array of functions/);
  });

  it('pipeline interleaves per-item stages', async () => {
    const runner = new StubRunner((p) => `result-${p}`);
    const script = `export const meta = { name: 'demo', description: 'd' }
const items = ['a', 'b']
const out = await pipeline(
  items,
  (item) => agent('first ' + item, { label: 'first' }),
  (prev, original) => agent('second ' + original + ' after ' + prev, { label: 'second' }),
)
return out
`;
    const res = await runWorkflow<string[]>(script, { runner }, { cwd: '/tmp' });
    expect(res.result).toEqual([
      'result-second a after result-first a',
      'result-second b after result-first b',
    ]);
  });

  it('treats null return from runner as failure and continues', async () => {
    let calls = 0;
    const runner = new StubRunner(() => {
      calls += 1;
      return calls === 1 ? null : 'ok';
    });
    const script = `export const meta = { name: 'demo', description: 'd' }
const first = await agent('first', { label: 'first' })
const second = await agent('second', { label: 'second' })
return { first, second }
`;
    const res = await runWorkflow<{ first: string | null; second: string }>(
      script,
      { runner },
      { cwd: '/tmp' },
    );
    expect(res.result.first).toBeNull();
    expect(res.result.second).toBe('ok');
  });

  it('phase() updates state and emits onPhase events', async () => {
    const phases: string[] = [];
    const runner = new StubRunner(() => 'x');
    const script = `export const meta = { name: 'demo', description: 'd' }
phase('Scan')
await agent('a', { label: 'a' })
phase('Synthesize')
await agent('b', { label: 'b' })
`;
    const res = await runWorkflow(
      script,
      { runner },
      {
        cwd: '/tmp',
        onPhase: (t) => phases.push(t),
      },
    );
    expect(phases).toEqual(['Scan', 'Synthesize']);
    expect(res.phases).toEqual(['Scan', 'Synthesize']);
  });

  it('exposes args and budget as globals', async () => {
    const runner = new StubRunner((p) => p);
    const script = `export const meta = { name: 'demo', description: 'd' }
const greeting = args.greeting
const remaining = budget.remaining()
return await agent(greeting + ' (' + remaining + ')', { label: 'greet' })
`;
    const res = await runWorkflow<string>(
      script,
      { runner },
      { cwd: '/tmp', args: { greeting: 'hi' }, tokenBudget: 1000 },
    );
    expect(res.result.startsWith('hi (')).toBe(true);
    expect(res.result).toContain('1000');
  });

  it('aborts and reports skipped agents when signal fires', async () => {
    const controller = new AbortController();
    const runner: SubagentRunner = {
      async run(_prompt, opts) {
        await new Promise((resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          setTimeout(resolve, 100);
        });
        return 'ok';
      },
    };
    const script = `export const meta = { name: 'demo', description: 'd' }
await agent('slow', { label: 'slow' })
`;
    const promise = runWorkflow(script, { runner }, { cwd: '/tmp', signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(promise).rejects.toThrow(/aborted/);
  });

  it('caps total subagents per run', async () => {
    const runner = new StubRunner(() => 'x');
    const script = `export const meta = { name: 'demo', description: 'd' }
await agent('1', { label: '1' })
await agent('2', { label: '2' })
await agent('3', { label: '3' })
`;
    await expect(
      runWorkflow(script, { runner }, { cwd: '/tmp', maxSubagents: 2 }),
    ).rejects.toThrow(/quota/);
  });

  it('errors when workflow result is not structured-cloneable (forgot await inside container)', async () => {
    const runner = new StubRunner(() => 'x');
    // Returning a bare promise is fine — async return auto-unwraps it. The trap
    // is forgetting to await when the promise is nested in an array/object,
    // which is exactly what the runtime's structured-clone check catches.
    const script = `export const meta = { name: 'demo', description: 'd' }
const p = agent('x', { label: 'x' })
return { pending: p }
`;
    await expect(runWorkflow(script, { runner }, { cwd: '/tmp' })).rejects.toThrow(/structured-cloneable/);
  });
});
