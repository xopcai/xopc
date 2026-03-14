/**
 * Onboard Command - Interactive Setup Wizard
 * 
 * Main entry point that orchestrates the onboarding flow.
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join } from 'path';
import { saveConfig } from '../../../config/index.js';
import { register, formatExamples, type CLIContext } from '../../registry.js';
import { colors } from '../../utils/colors.js';
import type { Config } from '../../../config/schema.js';

import { isWorkspaceSetup, setupWorkspace } from './workspace.js';
import { setupModel } from './model.js';
import { setupChannels } from './channels.js';
import { setupGateway, startGatewayNow } from './gateway.js';

/**
 * Load raw config without schema parsing to avoid default values being added.
 */
function loadRawConfig(configPath: string): Config | null {
  if (!configPath) {
    return null;
  }
  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as Config;
  } catch {
    return null;
  }
}

/**
 * Check if running in interactive mode
 */
function isInteractive(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

/**
 * Non-interactive setup handler
 */
async function setupNonInteractive(
  _configPath: string,
  existingConfig: Config | null
): Promise<Config | null> {
  console.log('\n🤖 AI Model Configuration (Non-Interactive Mode)\n');
  console.log('Current config:', JSON.stringify(existingConfig?.agents?.defaults?.model, null, 2));
  console.log('\n💡 To configure in interactive mode, run: xopcbot onboard');
  console.log('💡 Or set up manually in:', _configPath);
  return existingConfig;
}

/**
 * Main onboarding flow
 */
async function runOnboard(
  options: { model?: boolean; channels?: boolean; gateway?: boolean; all?: boolean },
  ctx: CLIContext
): Promise<void> {
  console.log(colors.cyan('\n🚀 Welcome to xopcbot setup!\n'));
  console.log('═'.repeat(50));

  const workspacePath = ctx.workspacePath;
  const configPath = ctx.configPath;

  // Use raw config loading to avoid schema defaults being added
  let config = loadRawConfig(configPath) || ({} as Config);

  // Determine what to configure based on options
  const doModel = options.model || options.all || (!options.channels && !options.gateway);
  const doChannels = options.channels || options.all || (!options.model && !options.gateway);
  const doGateway = options.gateway || options.all || (!options.model && !options.channels);
  const runFullWizard = !options.model && !options.channels && !options.gateway;

  // Auto-detect if setup is needed (for full wizard only)
  const needsSetup = !isWorkspaceSetup(workspacePath);

  if (runFullWizard && needsSetup) {
    console.log('\n📁 Step 1: Workspace Setup\n');
    setupWorkspace(workspacePath);
  }

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
      config = await setupModel(config, ctx);
    }

    if (doChannels) {
      config = await setupChannels(config);
    }

    if (doGateway) {
      config = await setupGateway(config);
    }
  }

  // Save config once at the end
  await saveConfig(config as Config, configPath);

  console.log('\n' + '═'.repeat(50));
  console.log('\n🎉 Setup Complete!\n');

  if (runFullWizard) {
    console.log('🚀 Next Steps:');
    console.log('  1. Read BOOTSTRAP.md in your workspace for first-run guidance');
    console.log('  2. Chat with your assistant: xopcbot agent -i');
    console.log('');
  }

  console.log('📝 Usage:');
  console.log('  xopcbot agent -m "Hello"    # Chat with AI');
  console.log('  xopcbot agent -i            # Interactive mode');
  console.log('  xopcbot models list         # List models');
  console.log('  xopcbot auth list           # View authentication');

  console.log('\n📁 Files:');
  console.log('  Config:', configPath);
  console.log('  Workspace:', workspacePath);
  if (runFullWizard) {
    console.log('  Bootstrap:', join(workspacePath, 'BOOTSTRAP.md'));
  }

  // Handle gateway startup if configured
  const gatewayConfigured = config?.gateway?.auth?.mode === 'token' && config?.gateway?.auth?.token;

  if (gatewayConfigured && (doGateway || runFullWizard)) {
    const host = config?.gateway?.host || '0.0.0.0';
    const port = config?.gateway?.port || 18790;
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    const token = config.gateway.auth.token;

    const webuiUrl = `http://${displayHost}:${port}?token=${token}`;

    console.log('\n🌐 WebUI Access:');
    console.log(`  URL: http://${displayHost}:${port}`);
    console.log(`  Token: ${token?.slice(0, 8)}...${token?.slice(-8)}`);
    console.log('');
    console.log('  Direct Access URL (with token):');
    console.log(`    ${webuiUrl}`);
    console.log('');

    // Auto-start gateway after onboarding
    await startGatewayNow(config, ctx);
  }

  // Explicitly exit to prevent hanging
  process.exit(0);
}

function createOnboardCommand(ctx: CLIContext): Command {
  const cmd = new Command('onboard')
    .description('Interactive setup wizard for xopcbot')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot onboard              # Full interactive setup',
        'xopcbot onboard --model      # Configure LLM model only',
        'xopcbot onboard --channels   # Configure channels only',
        'xopcbot onboard --gateway    # Configure gateway WebUI',
      ])
    )
    .option('--model', 'Configure LLM provider and model')
    .option('--channels', 'Configure messaging channels')
    .option('--gateway', 'Configure Gateway WebUI')
    .option('--all', 'Configure everything (default)')
    .action(async (options) => {
      try {
        await runOnboard(options, ctx);
      } catch (error: unknown) {
        // Handle user cancellation gracefully (Ctrl+C)
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

register({
  id: 'onboard',
  name: 'onboard',
  description: 'Interactive setup wizard for xopcbot',
  factory: createOnboardCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopcbot onboard',
      'xopcbot onboard --model',
      'xopcbot onboard --channels',
      'xopcbot onboard --gateway',
    ],
  },
});

export { runOnboard };
