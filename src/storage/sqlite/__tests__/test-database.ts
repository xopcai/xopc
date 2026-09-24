import { afterEach, beforeEach } from 'vitest';
import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { closeXopcDatabase } from '../connection.js';

/** Isolated database for consumers that previously only needed a temporary folder. */
export function useTestDatabase(): void {
  beforeEach(() => {
    initializeTestAgentCatalog();
  });
  afterEach(() => { closeXopcDatabase(); });
}
