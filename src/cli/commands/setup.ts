import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { loadAllTemplates } from '../templates.js';

/**
 * Check if workspace exists and has content
 */
function isWorkspaceSetup(workspacePath: string): boolean {
  return existsSync(workspacePath) && existsSync(join(workspacePath, 'AGENTS.md'));
}

/**
 * Check if config file exists
 */
function isConfigSetup(configPath: string): boolean {
  return existsSync(configPath);
}

/**
 * Setup workspace directory and bootstrap files
 */
function setupWorkspace(workspacePath: string): void {
  if (!existsSync(workspacePath)) {
    mkdirSync(workspacePath, { recursive: true });
    console.log('✅ Created workspace:', workspacePath);
  } else {
    console.log('ℹ️  Workspace already exists:', workspacePath);
  }

  // Load templates from docs/reference/templates/
  const templates = loadAllTemplates();

  const memoryDir = join(workspacePath, 'memory');
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
    console.log('✅ Created memory/ directory');
  }

  for (const [filename, content] of Object.entries(templates)) {
    const filePath = join(workspacePath, filename);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content, 'utf-8');
      console.log('✅ Created', filename);
    } else {
      console.log('ℹ️ ', filename, 'already exists (skipped)');
    }
  }
}

/**
 * Create empty config file
 */
function setupConfig(configPath: string): void {
  const configDir = join(configPath, '..');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  if (!existsSync(configPath)) {
    writeFileSync(configPath, '{}\n', 'utf-8');
    console.log('✅ Created config:', configPath);
  } else {
    console.log('ℹ️  Config already exists:', configPath);
  }
}

function createSetupCommand(ctx: CLIContext): Command {
  const cmd = new Command('setup')
    .description('Initialize config file and workspace directory')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot setup                    # Create config + workspace',
        'xopcbot setup --workspace /path  # Custom workspace path',
      ])
    )
    .option('--workspace <path>', 'Workspace directory path', ctx.workspacePath)
    .action(async (options) => {
      const workspacePath = options.workspace || ctx.workspacePath;
      const configPath = ctx.configPath;

      console.log('🔧 xopcbot Setup\n');
      console.log('═'.repeat(40));

      // Check current status
      const configExists = isConfigSetup(configPath);
      const workspaceSetup = isWorkspaceSetup(workspacePath);

      console.log('\n📊 Current Status:');
      console.log(`   Config: ${configExists ? '✅ exists' : '❌ not found'}`);
      console.log(`   Workspace: ${workspaceSetup ? '✅ setup' : '❌ not found'}`);

      // Setup config
      if (!configExists) {
        console.log('\n📝 Creating config file...');
        setupConfig(configPath);
      } else {
        console.log('\n📝 Config already exists, skipping...');
      }

      // Setup workspace
      if (!workspaceSetup) {
        console.log('\n📁 Creating workspace...');
        setupWorkspace(workspacePath);
      } else {
        console.log('\n📁 Workspace already setup, skipping...');
      }

      console.log('\n' + '═'.repeat(40));
      console.log('\n✅ Setup complete!\n');

      console.log('📁 Files:');
      console.log('   Config:', configPath);
      console.log('   Workspace:', workspacePath);

      console.log('\n🚀 Next Steps:');
      console.log('   xopcbot onboard              # Run full setup wizard');
      console.log('   xopcbot onboard --model      # Configure model only');
      console.log('   xopcbot onboard --channels  # Configure channels only');
    });

  return cmd;
}

register({
  id: 'setup',
  name: 'setup',
  description: 'Initialize config file and workspace directory',
  factory: createSetupCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopcbot setup',
      'xopcbot setup --workspace ~/.my-workspace',
    ],
  },
});
