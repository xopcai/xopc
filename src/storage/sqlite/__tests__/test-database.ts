import { afterEach, beforeEach } from 'vitest';
import { closeXopcDatabase, openXopcDatabase } from '../connection.js';

/** Isolated database for consumers that previously only needed a temporary folder. */
export function useTestDatabase(): void {
  beforeEach(() => { closeXopcDatabase(); openXopcDatabase({ path: ':memory:' }); });
  afterEach(() => { closeXopcDatabase(); });
}
