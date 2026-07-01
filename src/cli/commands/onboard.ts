import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import { saveConfig } from '../../config/index.js';
import { register, formatExamples } from '../registry.js';
import type { CLIContext } from '../registry.js';
import type { Config } from '../../config/schema.js';
import { setupModel as runModelSetup } from './onboard/model.js';
import { colors } from '../utils/colors.js';
import { setupChannels as runChannelOnboard, getChannelConfigurators } from './onboard/channels/index.js';
import { resolveGatewayLocalClientHost } from '../../config/gateway-bind.js';
import { initWorkspace } from '../utils/init-workspace.js';
import { ConfigSchema } from '../../config/schema.js';

function isInteractive(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

function printGitHubStarHint(): void {
  console.log('\n⭐ If xopc helps you keep long-term AI work moving, please star the repo:');
  console.log('   https://github.com/xopcai/xopc');
}

async function setupNonInteractive(_configPath: string, existingConfig: Config): Promise<Config> {
  console.log('\n🤖 AI Model Configuration (Non-Interactive Mode)\n');
  console.log('Current agent manifests:', JSON.stringify(existingConfig.agents?.list ?? [], null, 2));
  console.log('\n💡 To configure in interactive mode, run: xopc onboard');
  console.log('💡 Or set up manually in:', _configPath);
  return existingConfig;
}

function createOnboardCommand(ctx: CLIContext): Command {
  const cmd = new Command('onboard')
    .description('Interactive setup wizard for xopc (gateway uses schema defaults)')
    .addHelpText(
      'after',
      formatExamples([
        'xopc onboard              # Full interactive setup',
        'xopc onboard --quick      # Configure model only, then launch locally',
        'xopc onboard --model      # Configure LLM model only',
        'xopc onboard --channels   # Configure messaging channels',
        'xopc onboard --gateway    # Apply default gateway settings (quiet)',
      ])
    )
    .option('--quick', 'Configure model only, then launch locally')
    .option('--model', 'Configure LLM provider and model')
    .option('--channels', 'Configure messaging channels')
    .option('--gateway', 'Configure gateway WebUI')
    .option('--all', 'Configure everything (default)')
    .action(async (options) => {
      try {
        await runOnboard(options, ctx);
      } catch (error: unknown) {
        const err = error as { name?: string; code?: string };
        if (err?.name === 'ExitPromptError' || err?.code === 'EXIT_PROMPT') {
          console.log('\n\n👋 Setup cancelled.');
          process.exit(0);
        }
        throw error;
      }
    });

  return cmd;
}

type OnboardOptions = {
  quick?: boolean;
  model?: boolean;
  channels?: boolean;
  gateway?: boolean;
  all?: boolean;
};

async function runOnboard(
  options: OnboardOptions,
  ctx: CLIContext
): Promise<void> {
  console.log(colors.cyan('\n🚀 Welcome to xopc setup!\n'));
  console.log('═'.repeat(50));

  const workspacePath = ctx.workspacePath;
  const configPath = ctx.configPath;

  const initResult = await initWorkspace({ configPath, workspacePath });
  let config = initResult.config;

  // Determine what to configure based on options
  const doModel = options.quick || options.model || options.all || (!options.channels && !options.gateway);
  const doChannels = !options.quick && (options.channels || options.all || (!options.model && !options.gateway));
  const doGateway = !options.quick && (options.gateway || options.all || (!options.model && !options.channels));
  const runFullWizard = !options.quick && !options.model && !options.channels && !options.gateway;
  /** Any setup step besides the unified launch prompt ran in interactive flow. */
  const didConfigurableSteps = doModel || doChannels || doGateway;

  if (!isInteractive()) {
    // Non-interactive mode
    if (doModel) {
      config = await setupNonInteractive(configPath, config);
    }
    if (doChannels) {
      console.log('\n💬 Channels Configuration (Non-Interactive Mode)\n');
      console.log('💡 To configure channels, edit the config file manually.');
    }
    if (doGateway) {
      console.log('\n🌐 Gateway Configuration (Non-Interactive Mode)\n');
      console.log('💡 To configure gateway, edit the config file manually.');
    }
  } else {
    // Interactive mode
    if (doModel) {
      config = await runModelSetup(config, ctx);
    }

    if (doChannels) {
      const channelIds = (await getChannelConfigurators(config)).map(c => c.id);
      console.log(colors.gray(`\nChannel onboarding: ${channelIds.join(', ')}\n`));
      config = await runChannelOnboard(config);
    }

    if (doGateway) {
      config = await setupGateway(config);
    }
  }

  // Save config once at the end
  await saveConfig(config as Config, configPath);

  console.log('\n' + '═'.repeat(50));
  console.log('\n🎉 Setup Complete!\n');

  const gatewayAuth = (config as any)?.gateway?.auth;
  const gatewayConfigured =
    gatewayAuth?.mode === 'token' &&
    typeof gatewayAuth?.token === 'string' &&
    gatewayAuth.token.length > 0;
  const port = (config as Config)?.gateway?.port ?? 18790;
  const displayHost = resolveGatewayLocalClientHost(config as Config);
  const gwToken = gatewayConfigured ? (gatewayAuth.token as string) : undefined;

  const showGatewaySummary = Boolean(gatewayConfigured && gwToken && (doGateway || runFullWizard));

  if (showGatewaySummary && gwToken) {
    const webuiUrl = `http://${displayHost}:${port}?token=${gwToken}`;
    console.log('🌐 Web console (browser) — start here');
    console.log(`   Open: http://${displayHost}:${port}`);
    console.log(`   Token: ${gwToken.slice(0, 8)}...${gwToken.slice(-8)}`);
    console.log('   Bookmark link (token is saved in the browser when you open it):');
    console.log(`   ${webuiUrl}`);
    console.log('');
  }

  if (runFullWizard) {
    console.log('🚀 Next steps:');
    if (gatewayConfigured) {
      console.log('  1. Choose how to launch below (gateway or terminal UI)');
      console.log('  2. Or chat with: xopc agent -i');
    } else {
      console.log('  1. Chat in the terminal: xopc agent -i');
      console.log('  2. Optional: add the Web console: xopc onboard --gateway');
    }
    console.log('');
  } else if (doGateway && gatewayConfigured) {
    console.log('🚀 Next step:');
    console.log('  Start the gateway if it is not running, then open the Web console URL above.');
    console.log('');
  }

  console.log('📝 Usage:');
  console.log('  xopc agent -m "Hello"    # Chat with AI');
  console.log('  xopc agent -i            # Interactive mode');
  console.log('  xopc models list         # List models');
  console.log('  xopc config validate     # Validate xopc.json');
  console.log('  xopc auth list           # View authentication');
  console.log('  xopc init                # Full state dirs (if upgrading or missing data)');

  console.log('\n📁 Files:');
  console.log('  Config:', configPath);
  console.log('  Workspace:', workspacePath);

  printGitHubStarHint();

  if (isInteractive() && didConfigurableSteps) {
    await promptLaunchAfterOnboard(config as Config, ctx, { doChannels });
  }

  process.exit(0);
}

async function startGatewayAsService(config: Config, ctx: CLIContext): Promise<void> {
  const { startGatewayNow } = await import('./onboard/gateway.js');
  await startGatewayNow(config, ctx);
}

async function promptLaunchAfterOnboard(
  config: Config,
  ctx: CLIContext,
  _flags: { doChannels: boolean },
): Promise<void> {
  console.log('');
  const choice = await select<'tui' | 'gateway' | 'none'>({
    message: 'How do you want to launch xopc now?',
    choices: [
      {
        value: 'tui',
        name: 'Terminal UI (embedded)',
        description: 'xopc — no gateway process required',
      },
      {
        value: 'gateway',
        name: 'Gateway WebUI (OS service)',
        description: 'Install and start the HTTP gateway for the browser console',
      },
      {
        value: 'none',
        name: 'Exit — I will start manually',
        description: 'Finish setup without starting a runtime',
      },
    ],
    default: 'tui',
  });

  if (choice === 'gateway') {
    await startGatewayAsService(config, ctx);
    return;
  }

  if (choice === 'tui') {
    const { runTui } = await import('../../tui/tui.js');
    await runTui({ local: true });
    return;
  }

  console.log('\n⏭️  You can start later:');
  console.log('   xopc gateway service install');
  console.log('   xopc gateway');
  console.log('   xopc');
}

async function setupGateway(config: Config): Promise<Config> {
  console.log(colors.cyan('\n🌐 Gateway WebUI\n'));
  console.log(
    colors.gray(
      'Applying defaults from config schema (127.0.0.1:18790, token auth; token generated if missing).\n',
    ),
  );

  const gw = config.gateway ?? {};
  const { randomBytes } = await import('node:crypto');
  const authMode = gw.auth?.mode === 'none' ? ('none' as const) : ('token' as const);
  const token =
    authMode === 'token'
      ? typeof gw.auth?.token === 'string' && gw.auth.token.length > 0
        ? gw.auth.token
        : randomBytes(24).toString('hex')
      : undefined;

  const merged: Config = {
    ...config,
    gateway: {
      ...gw,
      bind: gw.bind ?? 'loopback',
      port: gw.port ?? 18790,
      auth:
        authMode === 'none'
          ? { mode: 'none' as const }
          : { mode: 'token' as const, token: token! },
    },
  };

  const parsed = ConfigSchema.parse(merged);
  console.log('✅ Gateway defaults applied.\n');
  return parsed;
}

register({
  id: 'onboard',
  name: 'onboard',
  description: 'Interactive setup wizard',
  factory: createOnboardCommand,
  metadata: {
    category: 'setup',
    examples: ['xopc onboard', 'xopc onboard --model', 'xopc onboard --channels'],
  },
});
