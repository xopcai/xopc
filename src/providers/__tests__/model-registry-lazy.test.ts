import { describe, expect, it, afterEach } from 'vitest';

import { ModelRegistry, resetModelRegistry, getModelRegistry } from '../model-registry.js';

describe('ModelRegistry lazy load', () => {
  afterEach(() => {
    resetModelRegistry();
  });

  it('does not load catalog in constructor', () => {
    const registry = new ModelRegistry('/nonexistent/models.json');
    expect(registry.isLoaded()).toBe(false);
  });

  it('prewarm loads catalog asynchronously', async () => {
    const registry = getModelRegistry();
    expect(registry.isLoaded()).toBe(false);
    await registry.prewarm();
    expect(registry.isLoaded()).toBe(true);
    expect(registry.getAll().length).toBeGreaterThan(0);
  });
});
