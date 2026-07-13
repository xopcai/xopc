import { describe, expect, it } from 'vitest';

import { resolveSkillsMarketplaceProvider } from '../marketplace/resolve-adapter.js';

describe('resolveSkillsMarketplaceProvider', () => {
  it('defaults to the xopc store', () => {
    expect(resolveSkillsMarketplaceProvider({} as never)).toBe('store');
  });
});
