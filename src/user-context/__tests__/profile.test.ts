import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  buildUserProfileSetup,
  normalizeGatewayUserName,
  parseUserProfileMarkdown,
  patchUserProfileMarkdown,
} from '../profile.js';

const CONFIG = { gateway: { auth: { mode: 'trusted-proxy' } } } as Config;

describe('user profile', () => {
  it('prefers an explicit call name and preserves custom markdown when patching', () => {
    const source = `# PROFILE.md - About You

- **Name:** Alexandra Example
- **What to call them:** Alex
- **Timezone:** UTC

## Context

Keep updates concise.

## Custom Section

Do not remove this.
`;
    expect(parseUserProfileMarkdown(source)).toMatchObject({
      callName: 'Alex',
      timezone: 'UTC',
      notes: 'Keep updates concise.',
    });
    const updated = patchUserProfileMarkdown(source, { callName: 'Lex', timezone: 'Asia/Shanghai' });
    expect(updated).toContain('- **Name:** Alexandra Example');
    expect(updated).toContain('- **What to call them:** Lex');
    expect(updated).toContain('- **Timezone:** Asia/Shanghai');
    expect(updated).toContain('## Custom Section\n\nDo not remove this.');
  });

  it('filters technical gateway accounts and formats friendly candidates', () => {
    expect(normalizeGatewayUserName('DOMAIN\\alex.wang')).toBe('Alex Wang');
    expect(normalizeGatewayUserName('Administrator')).toBeUndefined();
    expect(normalizeGatewayUserName('runner')).toBeUndefined();
    expect(normalizeGatewayUserName('12345678')).toBeUndefined();
  });

  it('honors a persisted snooze without exposing a shared-host suggestion', () => {
    const setup = buildUserProfileSetup({
      profile: { callName: '', pronouns: '', timezone: '', notes: '' },
      promptState: { state: 'snoozed', snoozedUntil: '2026-07-26T00:00:00.000Z' },
      config: CONFIG,
      now: new Date('2026-07-19T00:00:00.000Z'),
    });
    expect(setup).toMatchObject({ state: 'snoozed', shouldPrompt: false });
    expect(setup.callNameSuggestion).toBeUndefined();
  });
});
