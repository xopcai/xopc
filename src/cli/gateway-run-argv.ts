import { resolveCliArgvInvocation } from './argv-invocation.js';

const GATEWAY_RUN_VALUE_FLAGS = new Set([
  '--port',
  '--bind',
  '--token',
  '--tailscale',
]);

const GATEWAY_RUN_BOOLEAN_FLAGS = new Set([
  '--tailscale-reset-on-exit',
  '--force',
  '--no-hot-reload',
  '--foreground',
]);

const GATEWAY_SUBCOMMANDS = new Set([
  'token',
  'status',
  'health',
  'call',
  'probe',
  'stop',
  'restart',
  'logs',
  'service',
  'ssh-tunnel',
]);

function isValueToken(token: string | undefined): boolean {
  return typeof token === 'string' && token.length > 0 && !token.startsWith('-');
}

export function consumeGatewayRunOptionToken(args: ReadonlyArray<string>, index: number): number {
  const arg = args[index];
  if (!arg || arg === '--' || !arg.startsWith('-')) {
    return 0;
  }
  const equalsIndex = arg.indexOf('=');
  const flag = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
  if (GATEWAY_RUN_BOOLEAN_FLAGS.has(flag)) {
    return equalsIndex === -1 ? 1 : 0;
  }
  if (!GATEWAY_RUN_VALUE_FLAGS.has(flag)) {
    return 0;
  }
  if (equalsIndex !== -1) {
    return arg.slice(equalsIndex + 1).trim() ? 1 : 0;
  }
  return isValueToken(args[index + 1]) ? 2 : 0;
}

export function consumeGatewayFastPathRootOptionToken(
  args: ReadonlyArray<string>,
  index: number,
): number {
  const arg = args[index];
  if (!arg || arg === '--') {
    return 0;
  }
  if (arg.startsWith('--config=')) {
    return arg.slice('--config='.length).trim() ? 1 : 0;
  }
  if (arg === '--config') {
    return isValueToken(args[index + 1]) ? 2 : 0;
  }
  if (arg.startsWith('--workspace=')) {
    return arg.slice('--workspace='.length).trim() ? 1 : 0;
  }
  if (arg === '--workspace') {
    return isValueToken(args[index + 1]) ? 2 : 0;
  }
  if (arg === '--verbose' || arg === '-v') {
    return 1;
  }
  return 0;
}

export function resolveGatewayCatalogCommandPath(argv: string[]): string[] | null {
  const args = argv.slice(2).filter((arg) => arg !== '--');
  let sawGateway = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || arg === '--') {
      break;
    }
    if (!sawGateway) {
      const consumed = consumeGatewayFastPathRootOptionToken(args, index);
      if (consumed > 0) {
        index += consumed - 1;
        continue;
      }
      if (arg.startsWith('-')) {
        continue;
      }
      if (arg !== 'gateway') {
        return null;
      }
      sawGateway = true;
      continue;
    }

    const consumed = consumeGatewayRunOptionToken(args, index);
    if (consumed > 0) {
      index += consumed - 1;
      continue;
    }
    if (arg.startsWith('-')) {
      continue;
    }
    if (arg === 'service') {
      for (let nestedIndex = index + 1; nestedIndex < args.length; nestedIndex += 1) {
        const nested = args[nestedIndex];
        if (!nested || nested === '--') {
          break;
        }
        if (nested.startsWith('-')) {
          continue;
        }
        return ['gateway', 'service', nested];
      }
      return ['gateway', 'service'];
    }
    return ['gateway', arg];
  }

  return sawGateway ? ['gateway'] : null;
}

export function resolveGatewaySubcommandName(argv: string[]): string | undefined {
  const path = resolveGatewayCatalogCommandPath(argv);
  return path && path.length >= 2 ? path[1] : undefined;
}

export function isGatewayRunFastPathArgv(argv: string[]): boolean {
  if (process.env.XOPC_DISABLE_GATEWAY_RUN_FAST_PATH === '1') {
    return false;
  }

  const invocation = resolveCliArgvInvocation(argv);
  if (invocation.hasHelpOrVersion) {
    return false;
  }

  const args = argv.slice(2).filter((arg) => arg !== '--');
  let sawGateway = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || arg === '--') {
      return false;
    }
    if (!sawGateway) {
      const consumed = consumeGatewayFastPathRootOptionToken(args, index);
      if (consumed > 0) {
        index += consumed - 1;
        continue;
      }
      if (arg !== 'gateway') {
        return false;
      }
      sawGateway = true;
      continue;
    }

    const consumed = consumeGatewayRunOptionToken(args, index);
    if (consumed > 0) {
      index += consumed - 1;
      continue;
    }
    if (arg.startsWith('-')) {
      continue;
    }
    return false;
  }

  return sawGateway;
}

export function isKnownGatewaySubcommand(name: string): boolean {
  return GATEWAY_SUBCOMMANDS.has(name);
}
