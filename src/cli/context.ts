/**
 * CLI parsed-options + context builder.
 *
 * Extracted from `cli/index.ts` so command modules can import
 * `getContextWithOpts` without pulling the full CLI wiring graph (which
 * imports `command-loaders.ts`, which lazy-imports every command file). Before
 * this split, every command file circularly depended on `cli/index.ts` →
 * `command-loaders.ts` → that same command file.
 */

import { createDefaultContext, type CLIContext } from './registry.js';

/**
 * Global parsed options — updated before each command via the Commander
 * `preAction` hook in `cli/index.ts`.
 */
export const parsedOpts: { config?: string; workspace?: string; verbose?: boolean } = {};

export function getContextWithOpts(argv: string[] = process.argv): CLIContext {
  return createDefaultContext(argv, parsedOpts);
}
