import type { Command } from 'commander';
import type { ExtensionRegistry } from '../types/index.js';

/**
 * Apply all `registerCli` factories collected on the registry to a Commander program.
 */
export function registerExtensionCliProgram(program: Command, registry: ExtensionRegistry): void {
  for (const reg of registry.getCliRegistrations()) {
    reg.factory({ program });
  }
}
