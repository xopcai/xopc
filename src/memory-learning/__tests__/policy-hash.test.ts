import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { learningPolicyHash } from '../repository.js';

describe('learning policy identity', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); seedTestAgentCatalog(); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });
  it('preserves pending work across gateway, display, profile and unrelated model changes', () => {
    const config = ConfigSchema.parse({}); const before = learningPolicyHash(config);
    config.gateway.port += 1;
    config.userContext.userModel.showMemoryReferences = !config.userContext.userModel.showMemoryReferences;
    expect(learningPolicyHash(config)).toBe(before);
    const catalog = seedTestAgentCatalog(); const main = catalog.get('main')!;
    catalog.update('main', main.revision, { id: 'main', profile: { name: 'Renamed assistant' } });
    const settings = catalog.getSettings();
    catalog.updateDefaults({ ...settings.defaults, models: { ...settings.defaults.models,
      intents: { ...settings.defaults.models.intents, coding: { primary: 'test/coder', fallbacks: [] } } } }, settings.revision);
    expect(learningPolicyHash(config)).toBe(before);
  });
  it.each(['enabled', 'write', 'processing', 'sources', 'workspace', 'model'] as const)('invalidates %s changes', kind => {
    const config = ConfigSchema.parse({}); const before = learningPolicyHash(config);
    if (kind === 'enabled') config.userContext.enabled = false;
    if (kind === 'write') config.userContext.userModel.writePolicy = 'deny';
    if (kind === 'processing') config.userContext.userModel.processingPolicy = 'local_only';
    if (kind === 'sources') config.userContext.knowledgeMemory.contentSources = [];
    const catalog = seedTestAgentCatalog(); const main = catalog.get('main')!;
    if (kind === 'workspace') catalog.update('main', main.revision, { id: 'main', workspace: '/different' });
    if (kind === 'model') catalog.update('main', main.revision, { id: 'main', models: { intents: { understanding: { primary: 'test/reviewer', fallbacks: [] } } } });
    expect(learningPolicyHash(config)).not.toBe(before);
  });
});
