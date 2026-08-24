import { describe, it, expect } from 'vitest';
import { matchReloadRule, BASE_RELOAD_RULES } from '../rules.js';

describe('matchReloadRule', () => {
  it('matches generic channels subtree for declared channel ids', () => {
    const r = matchReloadRule('channels.telegram.accounts.personal.botToken');
    expect(r?.prefix).toBe('channels');
    expect(r?.kind).toBe('hot');
  });

  it('matches generic channels subtree for other channel ids', () => {
    const r = matchReloadRule('channels.unknown_channel.enabled');
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

  it('requires restart for trusted proxy settings', () => {
    expect(matchReloadRule('gateway.trustedProxies')?.kind).toBe('restart');
    expect(matchReloadRule('gateway.allowRealIpFallback')?.kind).toBe('restart');
  });

  it('hot reloads cors origins', () => {
    expect(matchReloadRule('gateway.corsOrigins')?.kind).toBe('hot');
    expect(matchReloadRule('gateway.corsOrigins.0')?.kind).toBe('hot');
  });

  it('requires restart for share policy', () => {
    expect(matchReloadRule('gateway.share')?.kind).toBe('restart');
    expect(matchReloadRule('gateway.share.maxTtlMs')?.kind).toBe('restart');
    expect(matchReloadRule('gateway.siteShare')?.kind).toBe('restart');
    expect(matchReloadRule('gateway.siteShare.maxActiveSites')?.kind).toBe('restart');
    expect(matchReloadRule('tunnel.autoStart')?.kind).toBe('hot');
  });
});
