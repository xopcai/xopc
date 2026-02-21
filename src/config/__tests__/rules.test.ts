import { describe, it, expect } from 'vitest';
import {
  matchReloadRule,
  buildReloadPlan,
  getHotReloadablePaths,
  getRestartRequiredPaths,
  BASE_RELOAD_RULES,
  type ReloadRule,
} from '../rules.js';

describe('BASE_RELOAD_RULES', () => {
  it('should contain expected rules', () => {
    expect(BASE_RELOAD_RULES.length).toBeGreaterThan(0);
    
    const providersRule = BASE_RELOAD_RULES.find(r => r.prefix === 'providers');
    expect(providersRule).toBeDefined();
    expect(providersRule?.kind).toBe('hot');
  });

  it('should have unique prefixes', () => {
    const prefixes = BASE_RELOAD_RULES.map(r => r.prefix);
    const uniquePrefixes = new Set(prefixes);
    expect(prefixes.length).toBe(uniquePrefixes.size);
  });
});

describe('matchReloadRule', () => {
  it('should match exact prefix', () => {
    const rule = matchReloadRule('providers');
    expect(rule).toBeDefined();
    expect(rule?.prefix).toBe('providers');
    expect(rule?.kind).toBe('hot');
  });

  it('should match nested path under prefix', () => {
    const rule = matchReloadRule('providers.openai.apiKey');
    expect(rule).toBeDefined();
    expect(rule?.prefix).toBe('providers');
    expect(rule?.kind).toBe('hot');
  });

  it('should match agent defaults paths', () => {
    expect(matchReloadRule('agents.defaults.model')?.kind).toBe('hot');
    expect(matchReloadRule('agents.defaults.temperature')?.kind).toBe('hot');
    expect(matchReloadRule('agents.defaults.maxTokens')?.kind).toBe('hot');
  });

  it('should match gateway paths as restart', () => {
    expect(matchReloadRule('gateway.host')?.kind).toBe('restart');
    expect(matchReloadRule('gateway.port')?.kind).toBe('restart');
  });

  it('should match channels paths as hot', () => {
    expect(matchReloadRule('channels.telegram')?.kind).toBe('hot');
    expect(matchReloadRule('channels.whatsapp')?.kind).toBe('hot');
  });

  it('should match cron paths as hot', () => {
    expect(matchReloadRule('cron')?.kind).toBe('hot');
    expect(matchReloadRule('cron.enabled')?.kind).toBe('hot');
  });

  it('should match plugins paths as restart', () => {
    expect(matchReloadRule('plugins')?.kind).toBe('restart');
  });

  it('should return null for unknown paths', () => {
    const rule = matchReloadRule('unknown.path');
    expect(rule).toBeNull();
  });

  it('should match tools paths as hot', () => {
    expect(matchReloadRule('tools')?.kind).toBe('hot');
    expect(matchReloadRule('tools.web')?.kind).toBe('hot');
  });

  it('should match heartbeat paths as hot', () => {
    expect(matchReloadRule('heartbeat')?.kind).toBe('hot');
    expect(matchReloadRule('heartbeat.enabled')?.kind).toBe('hot');
  });

  it('should match workspace path as none', () => {
    expect(matchReloadRule('agents.defaults.workspace')?.kind).toBe('none');
  });

  it('should prefer exact match over prefix match', () => {
    // If there's both 'agents.defaults' and 'agents.defaults.model' rules,
    // exact match should be returned
    const rule = matchReloadRule('agents.defaults.model');
    expect(rule).toBeDefined();
    expect(rule?.prefix).toBe('agents.defaults.model');
  });
});

describe('buildReloadPlan', () => {
  it('should create plan with empty arrays for no changes', () => {
    const plan = buildReloadPlan([]);
    expect(plan.changedPaths).toEqual([]);
    expect(plan.hotPaths).toEqual([]);
    expect(plan.restartPaths).toEqual([]);
    expect(plan.noopPaths).toEqual([]);
    expect(plan.requiresRestart).toBe(false);
    expect(plan.requiresHotReload).toBe(false);
  });

  it('should categorize hot paths correctly', () => {
    const plan = buildReloadPlan([
      'providers.openai.apiKey',
      'agents.defaults.model',
      'channels.telegram.enabled',
    ]);

    expect(plan.hotPaths).toContain('providers.openai.apiKey');
    expect(plan.hotPaths).toContain('agents.defaults.model');
    expect(plan.hotPaths).toContain('channels.telegram.enabled');
    expect(plan.requiresHotReload).toBe(true);
    expect(plan.requiresRestart).toBe(false);
  });

  it('should categorize restart paths correctly', () => {
    const plan = buildReloadPlan([
      'gateway.host',
      'gateway.port',
      'plugins',
    ]);

    expect(plan.restartPaths).toContain('gateway.host');
    expect(plan.restartPaths).toContain('gateway.port');
    expect(plan.restartPaths).toContain('plugins');
    expect(plan.requiresRestart).toBe(true);
    expect(plan.requiresHotReload).toBe(false);
  });

  it('should categorize noop paths correctly', () => {
    const plan = buildReloadPlan(['agents.defaults.workspace']);

    expect(plan.noopPaths).toContain('agents.defaults.workspace');
    expect(plan.requiresHotReload).toBe(false);
    expect(plan.requiresRestart).toBe(false);
  });

  it('should handle mixed paths', () => {
    const plan = buildReloadPlan([
      'providers.openai.apiKey',
      'gateway.port',
      'agents.defaults.temperature',
      'agents.defaults.workspace',
    ]);

    expect(plan.hotPaths).toContain('providers.openai.apiKey');
    expect(plan.hotPaths).toContain('agents.defaults.temperature');
    expect(plan.restartPaths).toContain('gateway.port');
    expect(plan.noopPaths).toContain('agents.defaults.workspace');
    expect(plan.requiresRestart).toBe(true);
    expect(plan.requiresHotReload).toBe(true);
  });

  it('should default unknown paths to restart', () => {
    const plan = buildReloadPlan(['unknown.config.path']);

    expect(plan.restartPaths).toContain('unknown.config.path');
    expect(plan.requiresRestart).toBe(true);
  });

  it('should include all changed paths in changedPaths array', () => {
    const paths = [
      'providers.openai.apiKey',
      'gateway.port',
      'unknown.path',
    ];
    const plan = buildReloadPlan(paths);

    paths.forEach(path => {
      expect(plan.changedPaths).toContain(path);
    });
  });

  it('should handle deeply nested paths', () => {
    const plan = buildReloadPlan([
      'providers.openai.models.0.id',
      'agents.defaults.compaction.enabled',
      'agents.defaults.pruning.maxToolResultChars',
    ]);

    expect(plan.hotPaths).toContain('providers.openai.models.0.id');
    expect(plan.hotPaths).toContain('agents.defaults.compaction.enabled');
    expect(plan.hotPaths).toContain('agents.defaults.pruning.maxToolResultChars');
  });

  it('should handle telegram topic paths', () => {
    const plan = buildReloadPlan(['channels.telegram.accounts.account1.enabled']);

    expect(plan.hotPaths).toContain('channels.telegram.accounts.account1.enabled');
    expect(plan.requiresHotReload).toBe(true);
  });
});

describe('getHotReloadablePaths', () => {
  it('should return array of hot-reloadable paths', () => {
    const paths = getHotReloadablePaths();
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
    
    expect(paths).toContain('providers');
    expect(paths).toContain('agents.defaults.model');
    expect(paths).toContain('channels.telegram');
  });

  it('should not include restart paths', () => {
    const paths = getHotReloadablePaths();
    expect(paths).not.toContain('gateway.host');
    expect(paths).not.toContain('gateway.port');
    expect(paths).not.toContain('plugins');
  });
});

describe('getRestartRequiredPaths', () => {
  it('should return array of restart-required paths', () => {
    const paths = getRestartRequiredPaths();
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
    
    expect(paths).toContain('gateway.host');
    expect(paths).toContain('gateway.port');
    expect(paths).toContain('plugins');
  });

  it('should not include hot paths', () => {
    const paths = getRestartRequiredPaths();
    expect(paths).not.toContain('providers');
    expect(paths).not.toContain('agents.defaults.model');
  });
});

describe('ReloadRule type', () => {
  it('should support optional description', () => {
    const rule: ReloadRule = {
      prefix: 'test',
      kind: 'hot',
    };
    expect(rule.description).toBeUndefined();

    const ruleWithDesc: ReloadRule = {
      prefix: 'test',
      kind: 'hot',
      description: 'Test description',
    };
    expect(ruleWithDesc.description).toBe('Test description');
  });
});
