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

  it('errors with a Promise-path hint when workflow result nests a Promise', async () => {
    // Static lint catches the common `const p = agent(...)` shape, so we use
    // a runner that returns a Promise inside its result — the script awaits
    // the runner correctly, but the Promise inside survives into the return.
    const runner: SubagentRunner = {
      async run() {
        return { pending: Promise.resolve('inner') } as never;
      },
    };
    const script = `export const meta = { name: 'demo', description: 'd' }
return await agent('x', { label: 'x' })
`;
    await expect(runWorkflow(script, { runner }, { cwd: '/tmp' })).rejects.toThrow(
      /contains a Promise.*await/s,
    );
  });

  it('resolves a real model id via resolveModelId', async () => {
    const runner = new StubRunner(() => 'ok');
    const m = { id: 'fake/x' } as never;
    let askedFor: string | undefined;
    const script = `export const meta = { name: 'demo', description: 'd' }
return await agent('do', { model: 'openai/gpt-4o-mini' })
`;
    await runWorkflow(
      script,
      {
        runner,
        resolveModelId: (id) => {
          askedFor = id;
          return m;
        },
      },
      { cwd: '/tmp' },
    );
    expect(askedFor).toBe('openai/gpt-4o-mini');
    expect(runner.calls[0].opts.model).toBe(m);
  });

  it('resolves typed model id via resolveModelId', async () => {
    const runner = new StubRunner(() => 'ok');
    const m = { id: 'fake/small' } as never;
    let askedFor: string | undefined;
    const script = `export const meta = { name: 'demo', description: 'd' }
return await agent('do', { model: 'small' })
`;
    await runWorkflow(
      script,
      {
        runner,
        resolveModelId: (id) => {
          askedFor = id;
          return m;
        },
      },
      { cwd: '/tmp' },
    );
    expect(askedFor).toBe('small');
    expect(runner.calls[0].opts.model).toBe(m);
  });

  it('uses phase default model via resolveModelId', async () => {
    const runner = new StubRunner(() => 'ok');
    const m = { id: 'fake/large' } as never;
    let askedFor: string | undefined;
    const script = `export const meta = {
  name: 'demo',
  description: 'd',
  phases: [{ title: 'Review', model: 'large' }],
}
phase('Review')
return await agent('do', { label: 'review' })
`;
    await runWorkflow(
      script,
      {
        runner,
        resolveModelId: (id) => {
          askedFor = id;
          return m;
        },
      },
      { cwd: '/tmp' },
    );
    expect(askedFor).toBe('large');
    expect(runner.calls[0].opts.model).toBe(m);
  });

  it('rewrites .map-on-Promise TypeError with an await hint', async () => {
    // Bypass static lint via dynamic indirection: a closure returns the
    // Promise, then the script calls .map on it. This mirrors bugs that
    // slip past the AST check (helper functions, late-bound vars).
    const runner = new StubRunner(() => ['a', 'b']);
    const script = `export const meta = { name: 'demo', description: 'd' }
const fns = [1].map(() => parallel(['x'].map((v) => () => agent(v))))
return fns[0].map((r) => r)
`;
    await expect(runWorkflow(script, { runner }, { cwd: '/tmp' })).rejects.toThrow(
      /map is not a function[\s\S]*Hint:[\s\S]*await/,
    );
  });
});
