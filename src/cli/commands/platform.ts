import { Command } from 'commander';

import { getProfile, upsertAuthProfile } from '../../auth/profiles/index.js';
import { loadConfig, saveConfig } from '../../config/index.js';
import {
  PLATFORM_RUNTIME_PROFILE,
  PLATFORM_RUNTIME_PROVIDER,
  PlatformRuntimeClient,
  discoverPlatform,
} from '../../platform/index.js';
import { formatExamples, register, type CLIContext } from '../registry.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function readRuntimeToken(value: string | undefined, fromStdin: boolean): Promise<string> {
  if (value?.trim()) return value.trim();
  if (fromStdin) return readStdin();
  if (process.stdin.isTTY) {
    const { password } = await import('@inquirer/prompts');
    return (await password({ message: 'Platform runtime token', mask: '*' })).trim();
  }
  throw new Error('Provide a runtime token, pass --stdin, or run interactively.');
}

function runtimeToken(): string {
  const fromEnv = process.env.XOPC_PLATFORM_RUNTIME_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const credential = getProfile(PLATFORM_RUNTIME_PROFILE);
  if (credential?.type === 'token' && credential.provider === PLATFORM_RUNTIME_PROVIDER) return credential.token;
  throw new Error('Runtime token is not configured. Run `xopc platform runtime token set`.');
}

function connectedConfig(ctx: CLIContext) {
  const config = loadConfig(ctx.configPath);
  if (config.platform.mode !== 'connected') throw new Error('XOPC is in standalone mode. Run `xopc platform connect <url>`.');
  return { config, platform: config.platform };
}

function createPlatformCommand(ctx: CLIContext): Command {
  const command = new Command('platform')
    .description('Connect to XOPC Cloud or an enterprise platform')
    .addHelpText('after', formatExamples([
      'xopc platform connect https://console.xopc.ai',
      'xopc platform status --refresh',
      'xopc platform runtime token set --stdin',
      'xopc platform runtime heartbeat',
    ]));

  command.command('connect')
    .argument('<url>', 'Platform base URL')
    .option('--workspace <id>', 'Default workspace ID')
    .action(async (url: string, options: { workspace?: string }) => {
      const discovery = await discoverPlatform(url);
      const config = loadConfig(ctx.configPath);
      config.platform = {
        mode: 'connected',
        url: new URL(url).toString().replace(/\/+$/, ''),
        workspaceId: options.workspace,
        discovery,
      };
      await saveConfig(config, ctx.configPath);
      console.log(`Connected to ${discovery.displayName} (${discovery.deploymentMode}, ${discovery.region})`);
    });

  command.command('disconnect')
    .description('Return to standalone mode')
    .action(async () => {
      const config = loadConfig(ctx.configPath);
      config.platform = { mode: 'standalone' };
      await saveConfig(config, ctx.configPath);
      console.log('XOPC is now in standalone mode.');
    });

  command.command('status')
    .option('--refresh', 'Refresh discovery before printing status')
    .option('--json', 'Output JSON')
    .action(async (options: { refresh?: boolean; json?: boolean }) => {
      const config = loadConfig(ctx.configPath);
      if (config.platform.mode === 'standalone') {
        console.log(options.json ? JSON.stringify(config.platform) : 'Mode: standalone');
        return;
      }
      if (options.refresh) {
        config.platform.discovery = await discoverPlatform(config.platform.url);
        await saveConfig(config, ctx.configPath);
      }
      if (options.json) console.log(JSON.stringify(config.platform, null, 2));
      else console.log(`Mode: connected\nPlatform: ${config.platform.discovery.displayName}\nURL: ${config.platform.url}`);
    });

  const runtime = command.command('runtime').description('Manage this XOPC runtime connection');
  const token = runtime.command('token').description('Store the one-time runtime registration token');
  token.command('set')
    .argument('[token]')
    .option('--stdin', 'Read token from standard input')
    .action(async (value: string | undefined, options: { stdin?: boolean }) => {
      const runtimeTokenValue = await readRuntimeToken(value, options.stdin ?? false);
      if (!/^xopc_rt_[A-Za-z0-9_-]{43}$/.test(runtimeTokenValue)) throw new Error('Invalid platform runtime token.');
      upsertAuthProfile({
        profileId: PLATFORM_RUNTIME_PROFILE,
        credential: { type: 'token', provider: PLATFORM_RUNTIME_PROVIDER, token: runtimeTokenValue },
      });
      console.log('Platform runtime token stored in the credential store.');
    });

  runtime.command('heartbeat')
    .description('Verify the outbound runtime connection and fetch current policy snapshots')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const { platform } = connectedConfig(ctx);
      const client = new PlatformRuntimeClient(platform.discovery, runtimeToken());
      const result = await client.heartbeat({ capabilities: { engine: 'xopc' } });
      console.log(options.json ? JSON.stringify(result, null, 2) : 'Runtime heartbeat accepted.');
    });

  return command;
}

register({
  id: 'platform',
  name: 'platform',
  description: 'Connect to XOPC Cloud or an enterprise platform',
  factory: createPlatformCommand,
  metadata: { category: 'runtime', examples: ['xopc platform status'] },
});
