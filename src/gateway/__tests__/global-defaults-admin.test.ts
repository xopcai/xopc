import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import type { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import { listGlobalDefaults, prepareUpdateGlobalDefaults } from '../global-defaults-admin.js';

describe('global defaults admin', () => {
  let catalog: AgentCatalogRepository;

  beforeEach(() => { catalog = initializeTestAgentCatalog(); });
  afterEach(() => closeXopcDatabase());

  it('returns one bilingual description for every built-in tool', () => {
    const payload = listGlobalDefaults();
    expect(payload.builtinTools.length).toBeGreaterThan(0);
    expect(new Set(payload.builtinTools.map((tool) => tool.id)).size).toBe(payload.builtinTools.length);
    expect(payload.builtinTools.every((tool) => tool.description.en && tool.description.zh)).toBe(true);
  });

  it('replaces the single validated global defaults object', () => {
    const defaults = catalog.getSettings().defaults;
    const result = prepareUpdateGlobalDefaults({
      defaults: {
        ...defaults,
        models: {
          ...defaults.models,
          chat: { primary: 'openai/gpt-5', fallbacks: ['anthropic/claude-sonnet-4-5'] },
        },
        tools: { exec_command: { mode: 'ask' } },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.changed).toBe(true);
    expect(result.data.defaults.models.chat.primary).toBe('openai/gpt-5');
    expect(result.data.defaults.tools.exec_command?.mode).toBe('ask');
  });

  it('marks an identical defaults update as unchanged', () => {
    const result = prepareUpdateGlobalDefaults({
      defaults: structuredClone(catalog.getSettings().defaults),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.changed).toBe(false);
  });

  it('checks model conflicts at write time before preparing any update', () => {
    const defaults = catalog.getSettings().defaults;
    const oldModels = { ...defaults.models, chat: { primary: 'old/chat', fallbacks: [] } };
    expect(prepareUpdateGlobalDefaults({ defaults, scope: 'models', expectedModels: oldModels })).toMatchObject({ ok: false, status: 409 });
  });

  it('keeps current non-model settings when applying model-only changes', () => {
    const current = catalog.getSettings().defaults;
    const submitted = { ...current, tools: {}, models: { ...current.models, chat: { primary: 'openai/gpt-5', fallbacks: [] } } };
    const result = prepareUpdateGlobalDefaults({ defaults: submitted, scope: 'models', expectedModels: current.models });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.defaults.tools).toEqual(current.tools);
    expect(result.data.defaults.models).toEqual(submitted.models);
  });

  it('keeps the current model routes when an agent settings page saves an old snapshot', () => {
    const current = catalog.getSettings().defaults;
    const submitted = { ...current, models: { ...current.models, chat: { primary: 'old/chat', fallbacks: [] } }, tools: { exec_command: { mode: 'ask' as const } } };
    const result = prepareUpdateGlobalDefaults({ defaults: submitted, scope: 'agent' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.defaults.models).toEqual(current.models);
    expect(result.data.defaults.tools).toEqual(submitted.tools);
  });
});
