import { resolveCliCommandPath } from './argv.js';
import {
  cliCommandCatalog,
  type CliCommandPathPolicy,
} from './command-catalog.js';
import { matchesCommandPath } from './command-path-matches.js';
import { resolveGatewayCatalogCommandPath } from './gateway-run-argv.js';

const DEFAULT_CLI_COMMAND_PATH_POLICY: CliCommandPathPolicy = {
  loadExtensions: 'when-configured',
  gatewaySubcommands: 'eager',
};

export function resolveCliCommandPathPolicy(commandPath: string[]): CliCommandPathPolicy {
  const resolvedPolicy: CliCommandPathPolicy = { ...DEFAULT_CLI_COMMAND_PATH_POLICY };
  for (const entry of cliCommandCatalog) {
    if (!entry.policy) {
      continue;
    }
    if (!matchesCommandPath(commandPath, entry.commandPath, { exact: entry.exact })) {
      continue;
    }
    Object.assign(resolvedPolicy, entry.policy);
  }
  return resolvedPolicy;
}

function isCommandPathPrefix(commandPath: string[], pattern: readonly string[]): boolean {
  return pattern.every((segment, index) => commandPath[index] === segment);
}

export function resolveCliCatalogCommandPath(argv: string[]): string[] {
  const tokens =
    resolveGatewayCatalogCommandPath(argv) ?? resolveCliCommandPath(argv);
  if (tokens.length === 0) {
    return [];
  }
  let bestMatch: readonly string[] | null = null;
  for (const entry of cliCommandCatalog) {
    if (!isCommandPathPrefix(tokens, entry.commandPath)) {
      continue;
    }
    if (!bestMatch || entry.commandPath.length > bestMatch.length) {
      bestMatch = entry.commandPath;
    }
  }
  return bestMatch ? [...bestMatch] : [tokens[0]!];
}
