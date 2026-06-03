import { describe, expect, it } from 'vitest';

import { parseWorkflowScript } from '../parser.js';

describe('parseWorkflowScript', () => {
  it('parses a minimal valid script', () => {
    const script = `export const meta = { name: 'demo', description: 'demo script' }
await agent('hello')
`;
    const { meta, body } = parseWorkflowScript(script);
    expect(meta).toEqual({ name: 'demo', description: 'demo script' });
    expect(body).toContain("await agent('hello')");
    expect(body).not.toContain('export const meta');
  });

  it('accepts a description with explicit phases array', () => {
    const script = `export const meta = {
  name: 'audit_repo',
  description: 'audit repo',
  whenToUse: 'when asked to audit',
  phases: [{ title: 'Scan' }, { title: 'Synthesize', detail: 'merge findings' }],
}
phase('Scan')
await agent('inspect')
`;
    const { meta } = parseWorkflowScript(script);
    expect(meta.name).toBe('audit_repo');
    expect(meta.phases).toHaveLength(2);
    expect(meta.phases?.[1]?.detail).toBe('merge findings');
  });

  it('rejects scripts without meta as first statement', () => {
    const script = `const x = 1
export const meta = { name: 'demo', description: 'd' }
`;
    expect(() => parseWorkflowScript(script)).toThrow(/first statement/);
  });

  it('rejects non-literal meta values (e.g. shorthand identifier)', () => {
    // shorthand `{ name }` expands to { name: <Identifier> } — not a literal.
    const script = `const name = 'demo'\nexport const meta = { name, description: 'd' }\n`;
    // The "first statement" guard fires first here; flip order so the literal
    // check runs and we exercise the path we actually care about.
    const script2 = `export const meta = { name: someIdent, description: 'd' }\n`;
    expect(() => parseWorkflowScript(script)).toThrow(/first statement/);
    expect(() => parseWorkflowScript(script2)).toThrow(/non-literal/);
  });

  it('rejects spread in meta', () => {
    const script = `export const meta = { ...{ name: 'x' }, description: 'd' }
`;
    expect(() => parseWorkflowScript(script)).toThrow(/spread/);
  });

  it('rejects template interpolation in meta', () => {
    const script = `export const meta = { name: \`demo_\${1}\`, description: 'd' }
`;
    expect(() => parseWorkflowScript(script)).toThrow(/template interpolation/);
  });

  it('rejects Date.now()', () => {
    const script = `export const meta = { name: 'demo', description: 'd' }
const t = Date.now()
`;
    expect(() => parseWorkflowScript(script)).toThrow(/deterministic/);
  });

  it('rejects Math.random()', () => {
    const script = `export const meta = { name: 'demo', description: 'd' }
const r = Math.random()
`;
    expect(() => parseWorkflowScript(script)).toThrow(/deterministic/);
  });

  it('rejects new Date()', () => {
    const script = `export const meta = { name: 'demo', description: 'd' }
const d = new Date()
`;
    expect(() => parseWorkflowScript(script)).toThrow(/deterministic/);
  });

  it('rejects require()', () => {
    const script = `export const meta = { name: 'demo', description: 'd' }
const fs = require('fs')
`;
    expect(() => parseWorkflowScript(script)).toThrow(/require/);
  });

  it('rejects import declarations', () => {
    const script = `import { x } from 'mod'
export const meta = { name: 'demo', description: 'd' }
`;
    expect(() => parseWorkflowScript(script)).toThrow(/import/);
  });

  it('rejects non-snake-case name', () => {
    const script = `export const meta = { name: 'DemoName', description: 'd' }
`;
    expect(() => parseWorkflowScript(script)).toThrow(/snake_case/);
  });

  it('rejects empty description', () => {
    const script = `export const meta = { name: 'demo', description: '' }
`;
    expect(() => parseWorkflowScript(script)).toThrow(/description/);
  });

  it('allows negative number literals in meta', () => {
    const script = `export const meta = { name: 'demo', description: 'd', timeoutSec: -1 }
`;
    const { meta } = parseWorkflowScript(script);
    expect((meta as any).timeoutSec).toBe(-1);
  });

  it('accepts tags and estimatedAgents in meta', () => {
    const script = `export const meta = {
  name: 'demo',
  description: 'd',
  tags: ['code-review', 'audit'],
  estimatedAgents: { min: 3, max: 7 },
}
await agent('go')
`;
    const { meta } = parseWorkflowScript(script);
    expect(meta.tags).toEqual(['code-review', 'audit']);
    expect(meta.estimatedAgents).toEqual({ min: 3, max: 7 });
  });

  it('rejects invalid estimatedAgents', () => {
    const script = `export const meta = { name: 'demo', description: 'd', estimatedAgents: { min: 0, max: 1 } }
`;
    expect(() => parseWorkflowScript(script)).toThrow(/estimatedAgents/);
  });
});
