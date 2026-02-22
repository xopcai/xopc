/**
 * Skills CLI Command
 * 
 * Manage skills: list, install, enable/disable, configure, test
 */

import { Command } from 'commander';
import { 
  createSkillLoader,
  installSkill,
  findInstallSpec,
  hasBinary,
  getDefaultInstallerPreferences,
  createSkillConfigManager,
  isSkillEnabled,
  scanSkillDirectory,
  formatScanSummary,
  type Skill,
} from '../../agent/skills/index.js';
import { DEFAULT_BASE_DIR, getBundledSkillsDir } from '../../config/paths.js';
import { register, type CLIContext } from '../registry.js';
import { createSkillsTestCommand } from './skills-test.js';

function loadWorkspaceSkillEntries(workspaceDir: string): Array<{ skill: Skill; metadata: Skill['metadata']; enabled: boolean }> {
  const loader = createSkillLoader();
  loader.init(workspaceDir, getBundledSkillsDir());
  const result = loader.load();
  return result.skills.map(skill => ({
    skill,
    metadata: skill.metadata,
    enabled: true,
  }));
}

function createSkillsCommand(ctx: CLIContext): Command {
  const command = new Command('skills');
  command.description('Manage skills');

  // List available skills
  command
    .command('list')
    .description('List available skills')
    .option('-v, --verbose', 'Show detailed information')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const loader = createSkillLoader();
      const workspaceDir = ctx.workspacePath;
      loader.init(workspaceDir, getBundledSkillsDir());
      const result = loader.load();

      if (options.json) {
        console.log(JSON.stringify({
          skills: result.skills.map(s => ({
            name: s.name,
            description: s.description,
            source: s.source,
            path: s.filePath,
            enabled: true, // Would need config to determine actual state
            metadata: s.metadata,
          })),
          diagnostics: result.diagnostics,
        }, null, 2));
        return;
      }

      console.log(`\nFound ${result.skills.length} skill(s):\n`);

      for (const skill of result.skills) {
        const emoji = skill.metadata.emoji || skill.metadata.openclaw?.emoji || '📦';
        const source = `[${skill.source}]`;
        console.log(`${emoji} ${skill.name} ${source}`);
        console.log(`   ${skill.description}`);
        
        if (options.verbose) {
          console.log(`   Path: ${skill.filePath}`);
          
          const requires = skill.metadata.requires || skill.metadata.openclaw?.requires;
          if (requires?.bins) {
            const binsStatus = requires.bins.map(bin => {
              const available = hasBinary(bin);
              return `${bin} ${available ? '✓' : '✗'}`;
            }).join(', ');
            console.log(`   Requires: ${binsStatus}`);
          }
          
          const install = skill.metadata.install || skill.metadata.openclaw?.install;
          if (install && install.length > 0) {
            console.log(`   Install options: ${install.map(i => i.label || i.kind).join(', ')}`);
          }
          
          console.log();
        }
      }

      if (result.diagnostics.length > 0) {
        console.log('\nDiagnostics:');
        for (const diag of result.diagnostics) {
          const icon = diag.type === 'error' ? '❌' : diag.type === 'warning' ? '⚠️' : 'ℹ️';
          console.log(`${icon} ${diag.message}`);
        }
      }

      console.log();
    });

  // Install a skill dependency
  command
    .command('install <skill-name>')
    .description('Install a skill dependency')
    .option('-i, --id <install-id>', 'Install spec ID to use')
    .option('--timeout <ms>', 'Installation timeout in ms', '300000')
    .option('--dry-run', 'Show what would be installed without executing')
    .action(async (skillName, options) => {
      const workspaceDir = ctx.workspacePath;
      const entries = loadWorkspaceSkillEntries(workspaceDir);
      const entry = entries.find(e => e.skill.name === skillName);

      if (!entry) {
        console.error(`Error: Skill "${skillName}" not found in workspace`);
        console.log('\nAvailable skills:');
        const loader = createSkillLoader();
        const result = loader.load();
        for (const skill of result.skills) {
          console.log(`  - ${skill.name}`);
        }
        process.exit(1);
      }

      const installSpecs = entry.metadata.install || entry.metadata.openclaw?.install || [];
      if (installSpecs.length === 0) {
        console.log(`Skill "${skillName}" has no install specs`);
        process.exit(0);
      }

      // Find the install spec
      let installSpec = options.id 
        ? findInstallSpec(entry, options.id)
        : installSpecs[0];

      if (!installSpec) {
        console.error(`Error: Install spec "${options.id}" not found`);
        console.log('\nAvailable install specs:');
        for (const [index, spec] of installSpecs.entries()) {
          const id = spec.id || `${spec.kind}-${index}`;
          const label = spec.label || id;
          console.log(`  ${id}: ${label}`);
        }
        process.exit(1);
      }

      if (options.dryRun) {
        console.log('Dry run - would install:');
        console.log(`  Skill: ${skillName}`);
        console.log(`  Method: ${installSpec.kind}`);
        if (installSpec.package) {
          console.log(`  Package: ${installSpec.package}`);
        }
        if (installSpec.formula) {
          console.log(`  Formula: ${installSpec.formula}`);
        }
        if (installSpec.module) {
          console.log(`  Module: ${installSpec.module}`);
        }
        if (installSpec.bins) {
          console.log(`  Expected binaries: ${installSpec.bins.join(', ')}`);
        }
        return;
      }

      console.log(`Installing dependency for "${skillName}"...`);
      
      const timeoutMs = parseInt(options.timeout, 10);
      const preferences = getDefaultInstallerPreferences();

      const result = await installSkill({
        workspaceDir,
        skillEntry: entry,
        installSpec,
        timeoutMs,
        preferences,
      });

      if (result.ok) {
        console.log('✓ Installation successful');
        if (result.stdout) {
          console.log(result.stdout);
        }
      } else {
        console.error('✗ Installation failed');
        console.error(result.message);
        if (result.stderr) {
          console.error(result.stderr);
        }
        process.exit(1);
      }

      if (result.warnings && result.warnings.length > 0) {
        console.log('\nWarnings:');
        for (const warning of result.warnings) {
          console.log(`  ⚠️  ${warning}`);
        }
      }
    });

  // Enable/disable a skill
  command
    .command('enable <skill-name>')
    .description('Enable a skill')
    .action(async (skillName) => {
      const configManager = createSkillConfigManager(DEFAULT_BASE_DIR);
      configManager.setSkillEnabled(skillName, true);
      console.log(`✓ Skill "${skillName}" enabled`);
    });

  command
    .command('disable <skill-name>')
    .description('Disable a skill')
    .action(async (skillName) => {
      const configManager = createSkillConfigManager(DEFAULT_BASE_DIR);
      configManager.setSkillEnabled(skillName, false);
      console.log(`✓ Skill "${skillName}" disabled`);
    });

  // Show skill status
  command
    .command('status [skill-name]')
    .description('Show skill status')
    .option('--json', 'Output as JSON')
    .action(async (skillName, options) => {
      const loader = createSkillLoader();
      const workspaceDir = ctx.workspacePath;
      loader.init(workspaceDir, getBundledSkillsDir());
      const result = loader.load();
      const configManager = createSkillConfigManager(DEFAULT_BASE_DIR);
      const config = configManager.load();

      if (skillName) {
        // Show specific skill
        const skill = result.skills.find(s => s.name === skillName);
        if (!skill) {
          console.error(`Error: Skill "${skillName}" not found`);
          process.exit(1);
        }

        const skillConfig = config.entries?.[skillName];
        const enabled = isSkillEnabled(skill, config);

        if (options.json) {
          console.log(JSON.stringify({
            name: skill.name,
            enabled,
            config: skillConfig,
            metadata: skill.metadata,
            path: skill.filePath,
          }, null, 2));
          return;
        }

        const emoji = skill.metadata.emoji || skill.metadata.openclaw?.emoji || '📦';
        console.log(`\n${emoji} ${skill.name}`);
        console.log(`   Description: ${skill.description}`);
        console.log(`   Enabled: ${enabled ? '✓' : '✗'}`);
        console.log(`   Source: ${skill.source}`);
        console.log(`   Path: ${skill.filePath}`);

        if (skillConfig?.apiKey) {
          console.log(`   API Key: ${skillConfig.apiKey.slice(0, 8)}...`);
        }

        const requires = skill.metadata.requires || skill.metadata.openclaw?.requires;
        if (requires) {
          if (requires.bins) {
            console.log(`   Required binaries: ${requires.bins.join(', ')}`);
            for (const bin of requires.bins) {
              const available = hasBinary(bin);
              console.log(`     ${bin}: ${available ? '✓' : '✗'}`);
            }
          }
          if (requires.anyBins) {
            console.log(`   Any of: ${requires.anyBins.join(', ')}`);
            const hasAny = requires.anyBins.some(bin => hasBinary(bin));
            console.log(`     Status: ${hasAny ? '✓' : '✗'}`);
          }
        }

        console.log();
      } else {
        // Show summary
        const skillsStatus = result.skills.map(skill => ({
          name: skill.name,
          enabled: isSkillEnabled(skill, config),
          source: skill.source,
        }));

        if (options.json) {
          console.log(JSON.stringify({
            total: skillsStatus.length,
            enabled: skillsStatus.filter(s => s.enabled).length,
            skills: skillsStatus,
          }, null, 2));
          return;
        }

        const enabledCount = skillsStatus.filter(s => s.enabled).length;
        console.log(`\nSkills: ${enabledCount}/${skillsStatus.length} enabled\n`);

        for (const status of skillsStatus) {
          const icon = status.enabled ? '✓' : '✗';
          console.log(`${icon} ${status.name} [${status.source}]`);
        }

        console.log();
      }
    });

  // Security audit
  command
    .command('audit [skill-name]')
    .description('Security audit for skills')
    .option('--deep', 'Show detailed findings')
    .action(async (skillName, options) => {
      const loader = createSkillLoader();
      const workspaceDir = ctx.workspacePath;
      loader.init(workspaceDir, getBundledSkillsDir());
      const result = loader.load();

      async function auditSkill(skill: typeof result.skills[0]) {
        const summary = await scanSkillDirectory(skill.baseDir);
        
        console.log(`\n${formatScanSummary(summary, skill.name)}\n`);
        
        if (options.deep && summary.findings.length > 0) {
          console.log('Detailed findings:');
          for (const finding of summary.findings) {
            const icon = finding.severity === 'critical' ? '❌' : finding.severity === 'warning' ? '⚠️' : 'ℹ️';
            console.log(`  ${icon} ${finding.message}`);
            console.log(`     File: ${finding.file}:${finding.line}`);
            if (finding.pattern) {
              console.log(`     Pattern: ${finding.pattern}`);
            }
          }
          console.log();
        }
      }

      if (skillName) {
        const skill = result.skills.find(s => s.name === skillName);
        if (!skill) {
          console.error(`Error: Skill "${skillName}" not found`);
          process.exit(1);
        }
        await auditSkill(skill);
      } else {
        console.log('Auditing all skills...\n');
        for (const skill of result.skills) {
          await auditSkill(skill);
        }
      }
    });

  // Configure skill
  command
    .command('config <skill-name>')
    .description('Configure a skill')
    .option('--api-key <key>', 'Set API key')
    .option('--env <KEY=VALUE>', 'Set environment variable', (val, prev: string[] = []) => [...prev, val], [])
    .option('--show', 'Show current configuration')
    .action(async (skillName, options) => {
      const configManager = createSkillConfigManager(DEFAULT_BASE_DIR);
      
      if (options.show) {
        const config = configManager.getSkillConfig(skillName);
        if (config) {
          console.log(JSON.stringify(config, null, 2));
        } else {
          console.log(`No configuration for skill "${skillName}"`);
        }
        return;
      }

      const updates: Record<string, unknown> = {};
      
      if (options.apiKey) {
        updates.apiKey = options.apiKey;
      }

      if (options.env && options.env.length > 0) {
        const env: Record<string, string> = {};
        for (const entry of options.env) {
          const [key, ...valueParts] = entry.split('=');
          if (key && valueParts.length > 0) {
            env[key] = valueParts.join('=');
          }
        }
        if (Object.keys(env).length > 0) {
          updates.env = env;
        }
      }

      if (Object.keys(updates).length === 0) {
        console.log('No configuration changes specified. Use --api-key, --env, or --show.');
        return;
      }

      configManager.updateSkillConfig(skillName, updates);
      console.log(`✓ Updated configuration for skill "${skillName}"`);
    });

  // Add test subcommand
  const testCommand = createSkillsTestCommand(ctx);
  command.addCommand(testCommand);

  return command;
}

// Register the command
register({
  id: 'skills',
  name: 'skills',
  description: 'Manage skills (install, enable, configure, test)',
  factory: createSkillsCommand,
  metadata: {
    category: 'utility',
    examples: [
      'xopcbot skills list                        # List all available skills',
      'xopcbot skills list -v                     # List with detailed information',
      'xopcbot skills install weather             # Install weather skill dependencies',
      'xopcbot skills enable weather              # Enable a skill',
      'xopcbot skills disable weather             # Disable a skill',
      'xopcbot skills status                      # Show skill status summary',
      'xopcbot skills status weather              # Show detailed skill status',
      'xopcbot skills audit                       # Security audit all skills',
      'xopcbot skills audit weather --deep        # Detailed security audit',
      'xopcbot skills config weather --show       # Show skill configuration',
      'xopcbot skills config weather --api-key=KEY  # Set API key',
      'xopcbot skills test                        # Test all skills',
      'xopcbot skills test weather                # Test specific skill',
      'xopcbot skills test validate ./skills/weather/SKILL.md  # Validate SKILL.md file',
      'xopcbot skills test check-deps             # Check dependencies',
      'xopcbot skills test security --deep        # Security audit',
    ],
  },
});

export { createSkillsCommand };
