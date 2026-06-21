import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveBundledSkillsDir } from '../paths.js';

const ENV_BUNDLED_SKILLS_ROOT = 'XOPC_BUNDLED_SKILLS_ROOT';

describe('resolveBundledSkillsDir', () => {
  const tempRoots: string[] = [];
  const originalEnv = process.env[ENV_BUNDLED_SKILLS_ROOT];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_BUNDLED_SKILLS_ROOT];
    } else {
      process.env[ENV_BUNDLED_SKILLS_ROOT] = originalEnv;
    }
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prefers XOPC_BUNDLED_SKILLS_ROOT when it exists', async () => {
    const root = join(tmpdir(), `xopc-bundled-skills-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(root, { recursive: true });
    tempRoots.push(root);
    process.env[ENV_BUNDLED_SKILLS_ROOT] = root;

    expect(resolveBundledSkillsDir()).toBe(root);
  });
});
