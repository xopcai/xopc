import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  buildSessionStartupContextPrelude,
  shouldApplyStartupContext,
  stripSessionStartupContextFromUserText,
} from '../startup-context.js';

describe('startup-context', () => {
  it('shouldApplyStartupContext applies on new and reset turns', () => {
    expect(shouldApplyStartupContext({ action: 'new' })).toBe(true);
    expect(shouldApplyStartupContext({ action: 'reset' })).toBe(true);
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

  it('stripSessionStartupContextFromUserText keeps user text only', () => {
    const userText = '[2026-06-03 14:32 UTC] hello workflow';
    const workspaceDir = mkdtempSync(join(tmpdir(), 'xopc-startup-strip-'));
    mkdirSync(join(workspaceDir, 'memory'), { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    writeFileSync(join(workspaceDir, 'memory', `${stamp}.md`), 'note');
    const prelude = buildSessionStartupContextPrelude({
      workspaceDir,
      nowMs: Date.now(),
      userTimezone: 'UTC',
    });
    expect(prelude).toBeTruthy();
    const persisted = `${prelude}\n\n${userText}`;
    expect(stripSessionStartupContextFromUserText(persisted)).toBe(userText);
  });
});
