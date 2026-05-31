/**
 * CLI helpers for `xopc browser` — shared runtime setup for CLI browser commands.
 */

import type { Page } from 'playwright-core';

import { BrowserManager, resolveBrowserBackendFromConfig, createBrowserActionRegistry } from '../../browser/index.js';
import { loadPlaywrightCoreModule } from '../../browser/providers/playwright-doctor.js';
import { validateBrowserPipeline, runBrowserPipeline } from '../../browser/pipeline/runner.js';
import { loadBrowserPipelineSource } from '../../browser/pipeline/source.js';
import type { BrowserActionContext } from '../../browser/actions/types.js';
import { loadConfig } from '../../config/loader.js';

let _manager: BrowserManager | null = null;
/** When set, `xopc browser open --headless` overrides config for this CLI invocation. */
let browserCliHeadlessOverride: boolean | undefined;

async function getManager(): Promise<BrowserManager> {
  if (_manager) return _manager;
  const config = await loadConfig();
  _manager = new BrowserManager({
    getHeadless: () => {
      if (typeof browserCliHeadlessOverride === 'boolean') return browserCliHeadlessOverride;
      return config?.agents?.defaults?.browser?.headless === true;
    },
    getBackend: () => resolveBrowserBackendFromConfig(config),
  });
  return _manager;
}

async function getActionContext(): Promise<BrowserActionContext> {
  const manager = await getManager();
  await manager.ensureConnected();
  const ext = manager.getExtensionProvider();
  const page: Page = ext ? (null as unknown as Page) : await manager.getPage('cli');
  const config = await loadConfig();
  return { page, manager, config, taskId: 'cli' };
}

export async function executeBrowserCliAction(action: string, args: Record<string, unknown>): Promise<void> {
  const prevOverride = browserCliHeadlessOverride;
  if (typeof args.headless === 'boolean') {
    browserCliHeadlessOverride = args.headless;
  }
  try {
    const registry = createBrowserActionRegistry();
    const ctx = await getActionContext();

    const result = await registry.execute(action, ctx, args);

    if (result.ok) {
      if (result.text) console.log(result.text);
      if (result.data && !result.text) console.log(JSON.stringify(result.data, null, 2));
    } else {
      console.error(`[${result.error?.code}] ${result.error?.message}`);
      process.exitCode = 1;
    }

    // Close after non-persistent actions
    if (action === 'close') {
      await _manager?.shutdown();
      _manager = null;
    }
  } finally {
    browserCliHeadlessOverride = prevOverride;
  }
}

export async function validatePipelineCli(file: string): Promise<void> {
  let yamlSource: string;
  try {
    yamlSource = (await loadBrowserPipelineSource(file)).source;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Failed to read pipeline source: ${msg}`);
    process.exitCode = 1;
    return;
  }

  const registry = createBrowserActionRegistry();
  const result = validateBrowserPipeline(yamlSource, registry);

  if (result.ok) {
    console.log(`✓ Pipeline "${result.document!.name}" is valid (${result.document!.pipeline.length} steps).`);
  } else {
    console.error('✗ Pipeline validation failed:');
    for (const err of result.errors) {
      console.error(`  ${err.path}: ${err.message}`);
    }
    process.exitCode = 1;
  }
}

export async function runPipelineCli(file: string, args: Record<string, unknown>): Promise<void> {
  let yamlSource: string;
  try {
    yamlSource = (await loadBrowserPipelineSource(file)).source;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Failed to read pipeline source: ${msg}`);
    process.exitCode = 1;
    return;
  }

  const registry = createBrowserActionRegistry();
  const ctx = await getActionContext();
  const result = await runBrowserPipeline(yamlSource, args, ctx, registry);

  if (result.ok) {
    if (result.text) console.log(result.text);
    if (result.data && !result.text) console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.error(`Pipeline failed: [${result.error?.code}] ${result.error?.message}`);
    if (result.diagnostics?.snapshot) {
      console.error(`Snapshot:\n${result.diagnostics.snapshot.slice(0, 2000)}`);
    }
    process.exitCode = 1;
  }

  await _manager?.shutdown();
  _manager = null;
}

export async function doctorCli(): Promise<void> {
  console.log('Browser Doctor');
  console.log('──────────────');

  // Check playwright-core
  try {
    const pw = await loadPlaywrightCoreModule();
    const chromium = pw.chromium ?? (pw as any).default?.chromium;
    if (chromium) {
      console.log('✓ playwright-core installed');
      // Try to detect browsers
      const execPath = chromium.executablePath?.();
      if (execPath) {
        console.log(`  Chromium path: ${execPath}`);
      } else {
        console.log('  ⚠ No default Chromium path detected. Run: npx playwright install chromium');
      }
    } else {
      console.log('✗ playwright-core chromium not available');
    }
  } catch {
    console.log('✗ playwright-core not installed');
  }

  // Check config
  try {
    const config = await loadConfig();
    const browser = config?.agents?.defaults?.browser;
    console.log(`\nConfig:`);
    console.log(`  enabled: ${browser?.enabled !== false}`);
    console.log(`  headless: ${browser?.headless === true}`);
    console.log(`  backend: ${browser?.backend ?? 'extension'}`);
    console.log(`  provider: ${browser?.cloudProvider ?? 'local'}`);
    if (browser?.cdpUrl) console.log(`  cdp: ${browser.cdpUrl}`);
    if (browser?.backend === 'extension' || browser?.extension) {
      const ext = browser?.extension;
      const port = ext?.port ?? 19820;
      const host = ext?.host ?? '127.0.0.1';
      console.log(`\nExtension Bridge:`);
      console.log(`  endpoint: ws://${host}:${port}/browser-ext`);
      try {
        const { browserExtDoctor } = await import('../../browser/providers/browser-ext-install.js');
        const artifacts = await browserExtDoctor();
        console.log(`  artifacts: ${artifacts.installed ? '✓ installed' : '✗ not installed'}`);
        if (artifacts.extensionDir) console.log(`  path: ${artifacts.extensionDir}`);
        if (artifacts.needsRefresh) console.log(`  refresh: ⚠ bundled update available`);
      } catch {
        console.log(`  artifacts: ⚠ could not check`);
      }
      // Try to ping the extension WS server
      try {
        const res = await fetch(`http://${host}:${port}/`);
        const data = await res.json() as { ok?: boolean; connected?: boolean };
        if (data.ok) {
          console.log(`  server: ✓ running`);
          console.log(`  extension: ${data.connected ? '✓ connected' : '⚠ waiting for connection'}`);
        }
      } catch {
        console.log(`  server: ✗ not running (start xopc with backend: 'extension' to enable)`);
      }
    }
  } catch {
    console.log('\n⚠ Could not load config');
  }
}
