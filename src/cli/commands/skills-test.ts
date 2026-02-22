/**
 * Skills Test CLI Command
 * 
 * Test and validate skills
 */

import { Command } from 'commander';
import { join } from 'path';
import { createLogger } from '../../utils/logger.js';
import { 
  SkillTestFramework,
  SkillTestRunner,
  formatTestResults,
  formatTestResultsJson,
  formatTestResultsTap,
} from '../../agent/skills/index.js';
import { getBundledSkillsDir } from '../../config/paths.js';
import { register, type CLIContext } from '../registry.js';

const log = createLogger('cli:skills-test');

function createSkillsTestCommand(_ctx: CLIContext): Command {
  const cmd = new Command('test')
    .description('Test and validate skills')
    .argument('[skill-name]', 'Specific skill to test (default: all skills)')
    .option('--skills-dir <path>', 'Skills directory to test')
    .option('--format <format>', 'Output format: text, json, tap', 'text')
    .option('--verbose', 'Show detailed output')
    .option('--skip-security', 'Skip security tests')
    .option('--skip-deps', 'Skip dependency tests')
    .option('--skip-examples', 'Skip example tests')
    .option('--strict', 'Strict mode - fail on warnings')
    .option('--timeout <ms>', 'Timeout for example tests', '10000')
    .action(async (skillName, options) => {
      const skillsDir = options.skillsDir 
        ? join(process.cwd(), options.skillsDir)
        : getBundledSkillsDir() || join(process.cwd(), 'skills');

      log.info({ skillsDir, skillName }, 'Running skill tests');

      try {
        if (skillName) {
          // Test specific skill
          const skillDir = join(skillsDir, skillName);
          const framework = new SkillTestFramework({
            skipSecurity: options.skipSecurity,
            skipDeps: options.skipDeps,
            skipExamples: options.skipExamples,
            strict: options.strict,
            exampleTimeout: parseInt(options.timeout, 10),
          });

          const report = await framework.testSkill(skillDir);
          outputReport(report, options.format, options.verbose);
          
          process.exit(report.passed ? 0 : 1);
        } else {
          // Test all skills
          const runner = new SkillTestRunner({
            skillsDir,
            skipSecurity: options.skipSecurity,
            skipDeps: options.skipDeps,
            skipExamples: options.skipExamples,
            strict: options.strict,
            exampleTimeout: parseInt(options.timeout, 10),
            format: options.format as 'text' | 'json' | 'tap',
            verbose: options.verbose,
          });

          const { reports, passed } = await runner.run();
          outputReports(reports, options.format, options.verbose);
          
          process.exit(passed ? 0 : 1);
        }
      } catch (err) {
        console.error('Error running tests:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // Subcommand: Validate a single SKILL.md file
  cmd
    .command('validate <skill-path>')
    .description('Validate a SKILL.md file')
    .option('--strict', 'Strict mode - fail on warnings')
    .action(async (skillPath, options) => {
      const framework = new SkillTestFramework({
        strict: options.strict,
      });

      const formatResult = framework.testSkillMdFormat(skillPath);
      
      console.log(`\nValidating: ${skillPath}`);
      console.log(`Status: ${formatResult.status === 'pass' ? '✅' : '❌'} ${formatResult.message}`);
      
      if (formatResult.details) {
        for (const detail of formatResult.details) {
          console.log(`  - ${detail}`);
        }
      }

      process.exit(formatResult.status === 'pass' ? 0 : 1);
    });

  // Subcommand: Check dependencies
  cmd
    .command('check-deps [skill-name]')
    .description('Check skill dependencies')
    .action(async (skillName) => {
      const skillsDir = getBundledSkillsDir() || join(process.cwd(), 'skills');
      const framework = new SkillTestFramework();

      if (skillName) {
        const skillDir = join(skillsDir, skillName);
        const report = await framework.testSkill(skillDir);
        const depsResult = report.results.find(r => r.name === 'Dependencies');
        
        if (depsResult) {
          console.log(`\nDependencies for ${skillName}:`);
          console.log(`Status: ${depsResult.status === 'pass' ? '✅' : '❌'} ${depsResult.message}`);
          if (depsResult.details) {
            for (const detail of depsResult.details) {
              console.log(`  ${detail}`);
            }
          }
        } else {
          console.log('No dependency tests found');
        }
      } else {
        // Check all skills
        const runner = new SkillTestRunner({
          skillsDir,
          skipSecurity: true,
          skipExamples: true,
        });

        const { reports } = await runner.run();
        
        console.log('\nDependency Status:\n');
        for (const report of reports) {
          const depsResult = report.results.find(r => r.name === 'Dependencies');
          const icon = depsResult?.status === 'pass' ? '✅' : depsResult?.status === 'fail' ? '❌' : '⚠️';
          console.log(`${icon} ${report.skillName}: ${depsResult?.message || 'No dependencies'}`);
        }
      }
    });

  // Subcommand: Security audit
  cmd
    .command('security [skill-name]')
    .description('Security audit for skills')
    .option('--deep', 'Show detailed findings')
    .action(async (skillName, options) => {
      const skillsDir = getBundledSkillsDir() || join(process.cwd(), 'skills');
      const framework = new SkillTestFramework();

      if (skillName) {
        const skillDir = join(skillsDir, skillName);
        const report = await framework.testSkill(skillDir);
        const securityResult = report.results.find(r => r.name === 'Security');
        
        if (securityResult) {
          console.log(`\nSecurity audit for ${skillName}:`);
          console.log(`Status: ${securityResult.status === 'pass' ? '✅' : '❌'} ${securityResult.message}`);
          if (securityResult.details) {
            for (const detail of securityResult.details) {
              console.log(`  ${detail}`);
            }
          }
        }
      } else {
        // Audit all skills
        const runner = new SkillTestRunner({
          skillsDir,
          skipDeps: true,
          skipExamples: true,
        });

        const { reports } = await runner.run();
        
        console.log('\nSecurity Audit:\n');
        for (const report of reports) {
          const securityResult = report.results.find(r => r.name === 'Security');
          const icon = securityResult?.status === 'pass' ? '✅' : securityResult?.status === 'fail' ? '❌' : '⚠️';
          console.log(`${icon} ${report.skillName}: ${securityResult?.message || 'Not scanned'}`);
          
          if (options.deep && securityResult?.details) {
            for (const detail of securityResult.details) {
              console.log(`    ${detail}`);
            }
          }
        }
      }
    });

  return cmd;
}

function outputReport(report: any, format: string, verbose: boolean) {
  switch (format) {
    case 'json':
      console.log(formatTestResultsJson([report]));
      break;
    case 'tap':
      console.log(formatTestResultsTap([report]));
      break;
    default:
      console.log(formatTestResults([report], verbose));
  }
}

function outputReports(reports: any[], format: string, verbose: boolean) {
  switch (format) {
    case 'json':
      console.log(formatTestResultsJson(reports));
      break;
    case 'tap':
      console.log(formatTestResultsTap(reports));
      break;
    default:
      console.log(formatTestResults(reports, verbose));
  }
}

// Register the command
register({
  id: 'skills:test',
  name: 'test',
  description: 'Test and validate skills',
  factory: createSkillsTestCommand,
  metadata: {
    category: 'maintenance',
    examples: [
      'xopcbot skills test                        # Test all skills',
      'xopcbot skills test weather                # Test specific skill',
      'xopcbot skills test --format json          # Output as JSON',
      'xopcbot skills test --verbose              # Show detailed output',
      'xopcbot skills test --skip-security        # Skip security tests',
      'xopcbot skills validate ./skills/weather   # Validate SKILL.md file',
      'xopcbot skills check-deps                  # Check all dependencies',
      'xopcbot skills security --deep             # Security audit with details',
    ],
  },
});

export { createSkillsTestCommand };
