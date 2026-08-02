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
      .description('Validate a Browser Recipe v1 YAML file without executing')
      .action(async (file: string) => {
        const { validatePipelineCli } = await import('./browser-cli-helpers.js');
        await validatePipelineCli(file);
      });

    cmd
      .command('run <file>')
      .description('Run a Browser Recipe v1 YAML file')
      .option('--arg <args...>', 'Recipe args (key=<JSON value>)')
      .action(async (file: string, opts: { arg?: string[] }) => {
        const { runPipelineCli } = await import('./browser-cli-helpers.js');
        const args: Record<string, unknown> = {};
        if (opts.arg) {
          for (const a of opts.arg) {
            const eq = a.indexOf('=');
            if (eq <= 0) throw new Error(`Invalid --arg: ${a}`);
            args[a.slice(0, eq)] = JSON.parse(a.slice(eq + 1));
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

    // ── CloakBrowser sub-commands ───────────────────────────────────────────
    const cloakCmd = cmd
      .command('cloakbrowser')
      .description('CloakBrowser anti-fingerprint browser management');

    cloakCmd
      .command('doctor')
      .description('Check CloakBrowser installation status and version')
      .action(async () => {
        const { cloakBrowserDoctor } = await import('../../browser/providers/cloakbrowser.js');
        const result = await cloakBrowserDoctor();
        console.log('\n  CloakBrowser Status\n');
        console.log(`  Installed:   ${result.installed ? '✓ yes' : '✗ no'}`);
        console.log(`  Platform:    ${result.platform}`);
        console.log(`  Version:     ${result.version ?? '(not installed)'}`);
        console.log(`  Binary:      ${result.binaryPath ?? '(not found)'}`);
        console.log(`  Cache dir:   ${result.cacheDir}`);
        console.log('');
        if (!result.installed) {
          console.log('  Run "xopc browser cloakbrowser install" to download CloakBrowser.\n');
        }
      });

    cloakCmd
      .command('install')
      .description('Download and install CloakBrowser binary')
      .option('--cache-dir <dir>', 'Custom cache directory for the binary')
      .action(async (opts: { cacheDir?: string }) => {
        console.log('\n  Downloading CloakBrowser...\n');
        try {
          const { launchCloakBrowser, cleanupCloakBrowser } = await import('../../browser/providers/cloakbrowser.js');
          // Launch with headless + temporary profile just to trigger download, then immediately cleanup
          const result = await launchCloakBrowser({
            headless: true,
            temporaryProfile: true,
            keepOpen: false,
            cacheDir: opts.cacheDir,
          });
          await result.browser.close().catch(() => {});
          await cleanupCloakBrowser(result.childProcess, result.temporaryProfileDir);
          console.log('  ✓ CloakBrowser installed successfully.\n');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`  ✗ Installation failed: ${msg}\n`);
          process.exitCode = 1;
        }
      });

    // ── Chrome extension sub-commands ───────────────────────────────────────
    const extensionCmd = cmd
      .command('extension')
      .description('xopc Chrome extension (browser bridge) management');

    extensionCmd
      .command('doctor')
      .description('Check bundled extension install status')
      .option('--cache-dir <dir>', 'Custom bin cache directory')
      .action(async (opts: { cacheDir?: string }) => {
        const { browserExtDoctor } = await import('../../browser/providers/browser-ext-install.js');
        const result = await browserExtDoctor({ cacheDir: opts.cacheDir });
        console.log('\n  Chrome Extension Artifacts\n');
        console.log(`  Bundled:     ${result.bundledAvailable ? '✓ yes' : '✗ no'}`);
        console.log(`  Installed:   ${result.installed ? '✓ yes' : '✗ no'}`);
        console.log(`  xopc ver:    ${result.xopcVersion}`);
        console.log(`  Installed:   ${result.installedVersion ?? '(none)'}`);
        console.log(`  Manifest:    ${result.manifestVersion ?? '(none)'}`);
        console.log(`  Directory:   ${result.extensionDir ?? '(not installed)'}`);
        console.log(`  Cache dir:   ${result.cacheDir}`);
        console.log(`  Refresh:     ${result.needsRefresh ? 'needed' : 'up to date'}`);
        if (result.needsChromeReload) {
          console.log('  ⚠ Chrome reload required (extension runtime version mismatch)');
        }
        console.log('');
        if (!result.installed) {
          console.log('  Run "xopc browser extension install" to copy bundled artifacts.\n');
        }
      });

    extensionCmd
      .command('install')
      .description('Copy bundled Chrome extension to the local bin directory')
      .option('--cache-dir <dir>', 'Custom bin cache directory')
      .option('--force', 'Force reinstall even when up to date')
      .action(async (opts: { cacheDir?: string; force?: boolean }) => {
        console.log('\n  Installing Chrome extension artifacts...\n');
        try {
          const { ensureBrowserExtensionArtifacts } = await import(
            '../../browser/providers/browser-ext-install.js'
          );
          const result = await ensureBrowserExtensionArtifacts({
            cacheDir: opts.cacheDir,
            force: opts.force,
          });
          console.log(`  ✓ ${result.copied ? 'Installed' : 'Already up to date'}`);
          console.log(`  Directory: ${result.extensionDir}\n`);
          console.log('  Next steps:');
          console.log('  1. Open chrome://extensions');
          console.log('  2. Enable Developer mode');
          console.log('  3. Load unpacked → select the directory above');
          console.log('  4. Run "xopc browser extension open" to open Chrome and reveal the folder\n');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`  ✗ Installation failed: ${msg}\n`);
          process.exitCode = 1;
        }
      });

    extensionCmd
      .command('open')
      .description('Open chrome://extensions and reveal the extension folder')
      .option('--cache-dir <dir>', 'Custom bin cache directory')
      .action(async (opts: { cacheDir?: string }) => {
        try {
          const { openBrowserExtensionInstallUi } = await import(
            '../../browser/providers/browser-ext-install.js'
          );
          const { extensionDir } = await openBrowserExtensionInstallUi({
            action: 'both',
            cacheDir: opts.cacheDir,
          });
          console.log(`Opened Chrome extensions page and folder:\n  ${extensionDir}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`  ✗ ${msg}\n`);
          process.exitCode = 1;
        }
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
      'xopc browser cloakbrowser doctor',
      'xopc browser cloakbrowser install',
      'xopc browser extension doctor',
      'xopc browser extension install',
      'xopc browser extension open',
    ],
  },
});
