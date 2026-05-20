import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  buildSessionStartupContextPrelude,
  shouldApplyStartupContext,
} from '../startup-context.js';

describe('startup-context', () => {
  it('shouldApplyStartupContext respects applyOn', () => {
    expect(shouldApplyStartupContext({ action: 'new' })).toBe(true);
    expect(
      shouldApplyStartupContext({
        action: 'reset',
        cfg: { agents: { defaults: { startupContext: { applyOn: ['new'] } } } },
      }),
    ).toBe(false);
  });

  it('buildSessionStartupContextPrelude loads recent daily memory', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'xopc-startup-'));
    mkdirSync(join(workspaceDir, 'memory'), { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    writeFileSync(join(workspaceDir, 'memory', `${stamp}.md`), 'Met with team about launch.');

    const prelude = buildSessionStartupContextPrelude({
      workspaceDir,
      nowMs: Date.now(),
      userTimezone: 'UTC',
    });
    expect(prelude).toContain('[Startup context loaded by runtime]');
    expect(prelude).toContain('Met with team about launch');
    expect(prelude).toContain('Do not claim you manually read files');
  });
});
