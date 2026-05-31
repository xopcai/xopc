import { resolveCliCommandPathPolicy } from './command-path-policy.js';

export function shouldLoadExtensionCliForCommandPath(commandPath: string[]): boolean {
  const policy = resolveCliCommandPathPolicy(commandPath).loadExtensions;
  if (policy === 'never') {
    return false;
  }
  if (policy === 'always') {
    return true;
  }
  return true;
}

export function shouldEagerLoadGatewaySubcommands(commandPath: string[]): boolean {
  return resolveCliCommandPathPolicy(commandPath).gatewaySubcommands === 'eager';
}

export function resolveCliStartupPolicy(params: { commandPath: string[] }) {
  return {
    loadExtensionCli: shouldLoadExtensionCliForCommandPath(params.commandPath),
    eagerGatewaySubcommands: shouldEagerLoadGatewaySubcommands(params.commandPath),
  };
}
