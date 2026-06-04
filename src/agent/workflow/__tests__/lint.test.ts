import { describe, expect, it } from 'vitest';

import { parseWorkflowScript } from '../parser.js';

// Lint runs inside parseWorkflowScript — testing the public seam mirrors how
// users hit it (workflow-tool.ts calls parseWorkflowScript before runtime).
const META = `export const meta = { name: 'demo', description: 'd' }\n`;

describe('await lint', () => {
  describe('rejects', () => {
    it('parallel() assigned without await', () => {
      const script = META + `const x = parallel([])\nawait agent('y')\n`;
      expect(() => parseWorkflowScript(script)).toThrow(/lint error.*parallel.*await/s);
    });

    it('pipeline() assigned without await', () => {
      const script = META + `const x = pipeline([], v => v)\nawait agent('y')\n`;
      expect(() => parseWorkflowScript(script)).toThrow(/lint error.*pipeline.*await/s);
    });

    it('agent() assigned without await', () => {
      const script = META + `const x = agent('foo')\n`;
      expect(() => parseWorkflowScript(script)).toThrow(/lint error.*agent.*await/s);
    });

    it('chained .map directly on parallel()', () => {
      const script = META + `parallel([]).map(() => null)\n`;
      expect(() => parseWorkflowScript(script)).toThrow(/lint error.*parallel.*await/s);
    });

    it('chained .then directly on agent()', () => {
      const script = META + `agent('x').then(() => null)\n`;
      expect(() => parseWorkflowScript(script)).toThrow(/lint error.*agent.*await/s);
    });

    it('interpolated in template literal', () => {
      const script = META + 'const s = `${parallel([])}`\nawait agent(s)\n';
      expect(() => parseWorkflowScript(script)).toThrow(/lint error.*parallel.*await/s);
    });

    it('passed as a non-thunk argument', () => {
      const script = META + `const s = JSON.stringify(agent('x'))\nawait agent(s)\n`;
      expect(() => parseWorkflowScript(script)).toThrow(/lint error.*agent.*await/s);
    });

    it('reproduces the original AI bug (parallel assigned, then .map)', () => {
      // Real-world failure: AI generated `const results = parallel(...)` then
      // `results.map(...)` and got "results.map is not a function" at runtime.
      // Lint should catch the missing await at the assignment, not the .map.
      const script =
        META +
        `const results = parallel(['a', 'b'].map((d) => () => agent('do ' + d)))\n` +
        `await agent('summary: ' + results.map((r) => r).join(','))\n`;
      expect(() => parseWorkflowScript(script)).toThrow(/lint error.*parallel.*await/s);
    });

    it('error message includes line number and ❌/✅ examples', () => {
      const script = META + `\n\nconst x = parallel([])\nawait agent('y')\n`;
      try {
        parseWorkflowScript(script);
        throw new Error('should have thrown');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        expect(message).toMatch(/line 4/);
        expect(message).toContain('❌');
        expect(message).toContain('✅');
      }
    });
  });

  describe('accepts', () => {
    it('awaited calls', () => {
      const script =
        META +
        `await parallel([])\n` +
        `await pipeline([], v => v)\n` +
        `await agent('y')\n`;
      expect(() => parseWorkflowScript(script)).not.toThrow();
    });

    it('returned directly (async IIFE auto-unwrap)', () => {
      const script = META + `return agent('y')\n`;
      expect(() => parseWorkflowScript(script)).not.toThrow();
    });

    it('return await chain', () => {
      const script = META + `return await parallel([])\n`;
      expect(() => parseWorkflowScript(script)).not.toThrow();
    });

    it('agent inside parallel thunk body', () => {
      const script =
        META + `await parallel(['a', 'b'].map((it) => () => agent('do ' + it)))\n`;
      expect(() => parseWorkflowScript(script)).not.toThrow();
    });

    it('agent inside pipeline stage body', () => {
      const script =
        META +
        `await pipeline(['a'], (item) => agent('first ' + item), (prev) => agent('second ' + prev))\n`;
      expect(() => parseWorkflowScript(script)).not.toThrow();
    });

    it('fire-and-forget agent() as expression statement', () => {
      // Top-level discarded call — runtime drains via pendingAgentRuns.
      const script = META + `agent('fire-and-forget')\nawait agent('y')\n`;
      expect(() => parseWorkflowScript(script)).not.toThrow();
    });

    it('chained call via intermediate awaited variable', () => {
      const script =
        META +
        `const r = await parallel(['a'].map((it) => () => agent(it)))\n` +
        `return r.map((x) => x)\n`;
      expect(() => parseWorkflowScript(script)).not.toThrow();
    });

    it('does not flag identifiers named after lint targets', () => {
      // `parallel` as a property key or local variable should not trigger.
      const script =
        META +
        `const cfg = { parallel: true, pipeline: 'foo' }\n` +
        `await agent('use ' + cfg.pipeline)\n`;
      expect(() => parseWorkflowScript(script)).not.toThrow();
    });
  });
});
