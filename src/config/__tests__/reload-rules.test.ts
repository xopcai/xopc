import { describe, it, expect } from 'vitest';
import { matchReloadRule, BASE_RELOAD_RULES } from '../rules.js';

describe('matchReloadRule', () => {
  it('matches longest channel prefix first', () => {
    const r = matchReloadRule('channels.telegram.accounts.personal.botToken');
    expect(r?.prefix).toBe('channels.telegram');
    expect(r?.kind).toBe('hot');
  });

  it('matches generic channels subtree for other channel ids', () => {
    const r = matchReloadRule('channels.feishu.enabled');
    expect(r?.prefix).toBe('channels');
    expect(r?.kind).toBe('hot');
  });

  it('exposes sorted rules for debugging', () => {
    expect(BASE_RELOAD_RULES.some((x) => x.prefix === 'channels')).toBe(true);
  });

  it('matches gateway heartbeat paths (config shape is gateway.heartbeat)', () => {
    const r = matchReloadRule('gateway.heartbeat.intervalMs');
    expect(r?.prefix).toBe('gateway.heartbeat');
    expect(r?.kind).toBe('hot');
  });
});
