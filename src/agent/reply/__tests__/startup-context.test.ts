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
  it('shouldApplyStartupContext does not apply implicit startup memory', () => {
    expect(shouldApplyStartupContext({ action: 'new' })).toBe(false);
    expect(shouldApplyStartupContext({ action: 'reset' })).toBe(false);
  });

  it('buildSessionStartupContextPrelude does not load implicit memory files', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'xopc-startup-'));
    mkdirSync(join(workspaceDir, 'memory'), { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    writeFileSync(join(workspaceDir, 'memory', `${stamp}.md`), 'Met with team about launch.');

    const prelude = buildSessionStartupContextPrelude({
      workspaceDir,
      nowMs: Date.now(),
      userTimezone: 'UTC',
    });
    expect(prelude).toBeNull();
  });

  it('stripSessionStartupContextFromUserText keeps user text only', () => {
    const userText = '[2026-06-03 14:32 UTC] hello workflow';
    const prelude = [
      '[Startup context loaded by runtime]',
      'Runtime-provided context was loaded for this new session.',
      '',
    ].join('\n');
    const persisted = `${prelude}\n\n${userText}`;
    expect(stripSessionStartupContextFromUserText(persisted)).toBe(userText);
  });
});
