/**
 * CLI: `xopc browser` — browser automation commands.
 *
 * Shares the same action registry and pipeline runner as the `browser_use` AgentTool.
 */

import { Command } from 'commander';
import { register, type CLIContext } from '../registry.js';

function createBrowserCommand(_ctx: CLIContext): Command {
  const cmd = new Command('browser')
    .description('Browser automation commands (uses Playwright)');

    cmd
      .command('open <url>')
      .description('Open a URL in the browser')
      .option('--headless', 'Run without a visible window (default: use config; default config is headed)')
      .action(async (url: string, opts: { headless?: boolean }) => {
        const { executeBrowserCliAction } = await import('./browser-cli-helpers.js');
        await executeBrowserCliAction('open', { url, ...opts });
      });

    cmd
      .command('state')
      .description('Get current page state (URL, title, ARIA snapshot)')
      .option('--selector <selector>', 'CSS selector to scope snapshot')
      .action(async (opts: { selector?: string }) => {
        const { executeBrowserCliAction } = await import('./browser-cli-helpers.js');
        await executeBrowserCliAction('state', opts);
      });

    cmd
      .command('click')
      .description('Click an element')
      .option('--selector <selector>', 'CSS selector')
      .option('--text <text>', 'Visible text')
      .option('--role <role>', 'ARIA role:name (e.g. button:Submit)')
      .action(async (opts: { selector?: string; text?: string; role?: string }) => {
        const { executeBrowserCliAction } = await import('./browser-cli-helpers.js');
        await executeBrowserCliAction('click', opts);
      });

    cmd
      .command('type')
      .description('Type text into an input')
      .option('--selector <selector>', 'CSS selector')
      .option('--label <label>', 'Label text')
      .requiredOption('--text <text>', 'Text to type')
      .option('--enter', 'Press Enter after typing')
      .action(async (opts: { selector?: string; label?: string; text: string; enter?: boolean }) => {
        const { executeBrowserCliAction } = await import('./browser-cli-helpers.js');
        await executeBrowserCliAction('type', { ...opts, pressEnter: opts.enter });
      });

    cmd
      .command('screenshot [path]')
      .description('Take a screenshot')
      .option('--selector <selector>', 'CSS selector')
      .option('--full-page', 'Full page screenshot')
      .action(async (path: string | undefined, opts: { selector?: string; fullPage?: boolean }) => {
        const { executeBrowserCliAction } = await import('./browser-cli-helpers.js');
        await executeBrowserCliAction('screenshot', { path: path ?? './screenshot.png', ...opts, full_page: opts.fullPage });
      });

    cmd
      .command('validate <file>')
      .description('Validate a browser pipeline YAML without executing')
      .action(async (file: string) => {
        const { validatePipelineCli } = await import('./browser-cli-helpers.js');
        await validatePipelineCli(file);
      });

    cmd
      .command('run <file>')
      .description('Run a browser pipeline YAML')
      .option('--arg <args...>', 'Pipeline args (key=value)')
      .action(async (file: string, opts: { arg?: string[] }) => {
        const { runPipelineCli } = await import('./browser-cli-helpers.js');
        const args: Record<string, string> = {};
        if (opts.arg) {
          for (const a of opts.arg) {
            const eq = a.indexOf('=');
            if (eq > 0) args[a.slice(0, eq)] = a.slice(eq + 1);
          }
        }
        await runPipelineCli(file, args);
      });

    cmd
      .command('doctor')
      .description('Check browser environment (Playwright, Chromium)')
      .action(async () => {
        const { doctorCli } = await import('./browser-cli-helpers.js');
        await doctorCli();
      });

    cmd
      .command('close')
      .description('Close the browser session')
      .action(async () => {
        const { executeBrowserCliAction } = await import('./browser-cli-helpers.js');
        await executeBrowserCliAction('close', {});
      });

  return cmd;
}

register({
  id: 'browser',
  name: 'browser',
  description: 'Browser automation commands',
  factory: createBrowserCommand,
  metadata: {
    category: 'utility',
    examples: [
      'xopc browser open https://example.com',
      'xopc browser validate ./flow.yaml',
      'xopc browser run ./flow.yaml',
      'xopc browser doctor',
    ],
  },
});
