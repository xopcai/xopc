/**
 * Lazy command loaders.
 *
 * Modules here trigger their `register({...})` side effect on import; the
 * caller then mounts the requested command via `registry.installOne` (or via
 * the explicit registrar functions for non-registry commands).
 *
 * Keeping this map static-but-thunked means `bin.ts` short-circuits and
 * `runCli` can resolve a single subcommand without paying for unrelated
 * command modules.
 */
import type { Command } from 'commander';
import { registry, type CLIContext } from './registry.js';

export type CommandLoader = () => Promise<unknown>;

export const REGISTRY_COMMAND_MODULES: Record<string, CommandLoader> = {
  setup: () => import('./commands/setup.js'),
  onboard: () => import('./commands/onboard.js'),
  agent: () => import('./commands/agent.js'),
  tui: () => import('./commands/tui.js'),
  gateway: () => import('./commands/gateway.js'),
  session: () => import('./commands/session.js'),
  cron: () => import('./commands/cron.js'),
  config: () => import('./commands/config.js'),
  doctor: () => import('./commands/doctor/index.js'),
  image: () => import('./commands/image.js'),
  channels: () => import('./commands/channels.js'),
  models: () => import('./commands/models.js'),
  auth: () => import('./commands/auth.js'),
  skills: () => import('./commands/skills.js'),
  browser: () => import('./commands/browser.js'),
  update: () => import('./commands/update.js'),
  logs: () => import('./commands/logs.js'),
  tunnel: () => import('./commands/tunnel.js'),
  tailscale: () => import('./commands/tailscale.js'),
  mcp: () => import('./commands/mcp.js'),
};

export interface NonRegistryMatcher {
  matches: (name: string) => boolean;
  load: (program: Command) => Promise<void>;
}

export const NON_REGISTRY_COMMAND_MATCHERS: NonRegistryMatcher[] = [
  {
    matches: (name) => name === 'agents' || name.startsWith('agents:'),
    load: async (program) => {
      const { registerAgentsCli } = await import('./commands/agents.js');
      registerAgentsCli(program);
    },
  },
  {
    matches: (name) => name === 'extensions',
    load: async (program) => {
      const [{ registerExtensionCommands }, { registerExtensionCliCommands }] = await Promise.all([
        import('./commands/extension.js'),
        import('./extension-cli-register.js'),
      ]);
      registerExtensionCommands(program);
      await registerExtensionCliCommands(program);
    },
  },
];

const FLAGS_WITH_VALUE = new Set(['--config', '--workspace']);

/**
 * Resolve which command module to load based on argv. Skips global flags
 * (`--verbose`/`--config <path>`/`--workspace <path>`) and treats
 * `help <cmd>` as if the user had typed `<cmd>`, so that `xopc help gateway`
 * loads only the gateway module.
 */
export function resolveCommandName(argv: string[]): string | undefined {
  let i = 2;
  let firstSubcommand: string | undefined;
  while (i < argv.length) {
    const arg = argv[i];
    if (!arg) {
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      i += FLAGS_WITH_VALUE.has(arg) ? 2 : 1;
      continue;
    }
    if (firstSubcommand === undefined) {
      firstSubcommand = arg;
      if (arg === 'help') {
        i += 1;
        continue;
      }
      return arg;
    }
    return arg;
  }
  return firstSubcommand;
}

export async function tryLoadCommand(
  program: Command,
  ctx: CLIContext,
  name: string,
  getCtx?: () => CLIContext,
): Promise<boolean> {
  const moduleLoader = REGISTRY_COMMAND_MODULES[name];
  if (moduleLoader) {
    await moduleLoader();
    return registry.installOne(program, name, ctx, getCtx);
  }
  const matcher = NON_REGISTRY_COMMAND_MATCHERS.find((m) => m.matches(name));
  if (matcher) {
    await matcher.load(program);
    return true;
  }
  return false;
}

export async function loadAllCommands(
  program: Command,
  ctx: CLIContext,
  getCtx?: () => CLIContext,
): Promise<void> {
  // Sequential to keep registration order deterministic; registry.install
  // sorts by category and is stable within a category.
  for (const loader of Object.values(REGISTRY_COMMAND_MODULES)) {
    await loader();
  }
  registry.install(program, ctx, getCtx);
  for (const matcher of NON_REGISTRY_COMMAND_MATCHERS) {
    await matcher.load(program);
  }
}
