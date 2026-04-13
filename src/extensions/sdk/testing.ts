/**
 * Lightweight test doubles — no Vitest dependency.
 */

import type { ExtensionApi } from '../types/core.js';

export function createMockExtensionApi(overrides?: Partial<ExtensionApi>): ExtensionApi {
  return {
    id: 'mock',
    name: 'mock',
    ...overrides,
  } as unknown as ExtensionApi;
}
