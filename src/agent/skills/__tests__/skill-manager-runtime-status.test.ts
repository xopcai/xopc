import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SkillManager } from '../skill-manager.js';

describe('SkillManager runtime status', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function makeWorkspace(): string {
    const root = mkdtempSync(join(tmpdir(), 'xopc-skill-manager-'));
    roots.push(root);
    const skillDir = join(root, '.xopc', 'skills', 'demo');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: demo\ndescription: Demo skill\n---\n\nUse this skill for tests.\n`,
    );
    return root;
  }

  it('increments version and exposes reload status', () => {
    const workspace = makeWorkspace();
    const manager = new SkillManager(workspace, undefined);

    expect(manager.getVersion()).toBe('1');
    expect(manager.getStatus()).toEqual(
      expect.objectContaining({
        version: '1',
        reloadInProgress: false,
        reloadPending: false,
        lastReloadReason: 'initial',
        lastReloadOk: true,
      }),
    );

    manager.reload();

    expect(manager.getVersion()).toBe('2');
    expect(manager.getStatus()).toEqual(
      expect.objectContaining({
        version: '2',
        reloadInProgress: false,
        reloadPending: false,
        lastReloadReason: 'disk',
        lastReloadOk: true,
      }),
    );
  });
});
