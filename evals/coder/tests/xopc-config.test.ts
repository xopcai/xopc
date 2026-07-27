import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { prepareXopcConfig } from '../scripts/prepare-xopc-cbm-config.js';

describe('prepareXopcConfig', () => {
  const roots: string[] = [];

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('creates isolated paired agents and enables CBM only for the candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-evals-xopc-config-'));
    roots.push(root);
    const sourceDir = join(root, 'source');
    const profileDir = join(sourceDir, 'agents', 'coder', 'profile');
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, 'SOUL.md'), '# Coder\n');
    const source = join(sourceDir, 'xopc.json');
    await writeFile(source, JSON.stringify({
      agents: {
        default: 'coder',
        capabilityPresets: {},
        list: [{ id: 'coder', identity: { name: 'Coder' }, tools: { builtin: {} } }],
      },
      channels: { telegram: { enabled: true } },
      gateway: { port: 3000, bind: 'all', auth: { mode: 'token' } },
      codeIntelligence: { enabled: true, agentIds: ['coder'], indexMode: 'moderate' },
    }));
    const output = join(root, 'generated', 'xopc.json');
    const stateDir = join(root, 'state');

    await prepareXopcConfig({
      source,
      output,
      stateDir,
      sourceAgent: 'coder',
      baselineAgent: 'eval-coder-baseline',
      candidateAgent: 'eval-coder-cbm',
      port: 4321,
    });

    const generated = JSON.parse(await readFile(output, 'utf8')) as Record<string, any>;
    expect(generated.agents.list.map((agent: { id: string }) => agent.id)).toEqual([
      'eval-coder-baseline',
      'eval-coder-cbm',
    ]);
    expect(generated.agents.list[0].identity).toEqual(generated.agents.list[1].identity);
    expect(generated.codeIntelligence.agentIds).toEqual(['eval-coder-cbm']);
    expect(generated.channels).toEqual({});
    expect(generated.gateway).toMatchObject({ bind: 'loopback', port: 4321 });
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(await readFile(join(stateDir, 'agents', 'eval-coder-baseline', 'profile', 'SOUL.md'), 'utf8'))
      .toBe('# Coder\n');
    expect(await readFile(join(stateDir, 'agents', 'eval-coder-cbm', 'profile', 'SOUL.md'), 'utf8'))
      .toBe('# Coder\n');
  });
});
