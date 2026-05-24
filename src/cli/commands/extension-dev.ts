import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  watch,
  type FSWatcher,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { Command } from 'commander';

import { loadConfig } from '../../config/loader.js';
import { resolveConfigPath, resolveExtensionsDir } from '../../config/paths.js';
import { checkEngineCompatibility } from '../../extensions/engine-check.js';
import type { ExtensionManifest } from '../../extensions/types/index.js';
import { normalizeExtensionManifest } from '../../extensions/normalize-manifest.js';
import { GatewayServer } from '../../gateway/index.js';
import { runGatewayLoop } from '../../gateway/run-loop.js';
import { PACKAGE_VERSION } from '../../package-version.js';
import { createLogger } from '../../utils/logger.js';
import { colors } from '../utils/colors.js';
import { getContextWithOpts } from '../index.js';
import { initWorkspace } from '../utils/init-workspace.js';
import { seedMainAgentProfileMarkdown } from '../../agent/context/workspace-seed.js';

const log = createLogger('ExtensionDev');
const MANIFEST = 'xopc.extension.json';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

async function ensureGatewayReady(
  configPath: string,
  workspacePath: string,
  gatewayPort: number,
): Promise<void> {
  const result = await initWorkspace({
    configPath,
    workspacePath,
    gatewayPort,
  });

  if (result.configCreated || result.workspaceCreated) {
    console.log('');
    console.log('👋 First-time setup before starting the gateway...');
    console.log('');
    console.log('✅ Setup complete.');
    console.log(`   Config:    ${configPath}`);
    console.log(`   Workspace: ${workspacePath}`);
    console.log('');
    seedMainAgentProfileMarkdown(result.config);
  }
}

function loadAndValidateManifest(extensionDir: string): ExtensionManifest | null {
  const manifestPath = join(extensionDir, MANIFEST);
  if (!existsSync(manifestPath)) {
    console.error(colors.red('error:'), `Missing ${MANIFEST} in ${extensionDir}`);
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8') as string) as unknown;
    if (!isRecord(raw)) {
      console.error(colors.red('error:'), 'Manifest must be a JSON object');
      return null;
    }
    const manifest = normalizeExtensionManifest(raw);
    if (!manifest.id?.trim()) {
      console.error(colors.red('error:'), 'Manifest "id" is required');
      return null;
    }
    if (manifest.engines?.xopc) {
      const r = checkEngineCompatibility(PACKAGE_VERSION, manifest.engines.xopc);
      if (r.parseWarning) {
        console.log(
          colors.yellow('warning:'),
          r.reason ?? 'engines.xopc could not be fully parsed — continuing',
        );
      } else if (!r.compatible) {
        console.log(
          colors.yellow('warning:'),
          r.reason ?? `engines.xopc may not match xopc ${PACKAGE_VERSION} — continuing`,
        );
      }
    }
    return manifest;
  } catch (e) {
    log.error({ err: e }, 'Failed to read manifest');
    console.error(
      colors.red('error:'),
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

function setupDevSymlink(extensionDir: string, extensionsDir: string, extensionId: string): string {
  mkdirSync(extensionsDir, { recursive: true });
  const symlinkPath = join(extensionsDir, extensionId);
  if (existsSync(symlinkPath)) {
    unlinkSync(symlinkPath);
  }
  symlinkSync(extensionDir, symlinkPath, 'dir');
  return symlinkPath;
}

function cleanupSymlink(symlinkPath: string | null): void {
  if (!symlinkPath) return;
  try {
    if (existsSync(symlinkPath)) {
      unlinkSync(symlinkPath);
    }
  } catch (e) {
    log.warn({ err: e, symlinkPath }, 'Failed to remove dev symlink');
  }
}

function shouldIgnorePath(relativePath: string): boolean {
  const parts = relativePath.split(/[/\\]/);
  if (parts.some((p) => p === 'node_modules')) return true;
  if (parts.some((p) => p.startsWith('.'))) return true;
  return false;
}

export function createExtensionDevCommand(): Command {
  return new Command('dev')
    .description('Symlink an extension into the workspace for live development (optional file watch + gateway)')
    .argument('[dir]', 'Extension directory (default: current working directory)', '.')
    .option('--port <number>', 'Gateway port', '18790')
    .option('--bind <mode>', 'Gateway bind mode', 'loopback')
    .option('--no-gateway', 'Do not start the gateway (symlink only)')
    .option('--no-watch', 'Do not watch files for changes')
    .action(
      async (
        dir: string,
        options: { port: string; bind: string; gateway: boolean; watch: boolean },
      ) => {
        const extensionDir = resolve(dir || '.');
        const manifest = loadAndValidateManifest(extensionDir);
        if (!manifest) {
          process.exit(1);
        }

        const ctx = getContextWithOpts();
        loadConfig(ctx.configPath);
        const extensionsDir = resolveExtensionsDir();
        const symlinkPath = setupDevSymlink(extensionDir, extensionsDir, manifest.id);

        console.log(
          colors.green('✓'),
          `Dev symlink: ${symlinkPath} → ${extensionDir}`,
        );
        console.log(
          colors.cyan('Note:'),
          'restart the gateway or trigger config hot-reload so the extension reload picks up changes.',
        );

        let debounce: ReturnType<typeof setTimeout> | null = null;
        let watcher: FSWatcher | null = null;

        if (options.watch) {
          try {
            watcher = watch(
              extensionDir,
              { recursive: true },
              (_event, filename) => {
                const rel = filename ? String(filename) : '';
                if (rel && shouldIgnorePath(rel)) return;
                if (debounce) clearTimeout(debounce);
                debounce = setTimeout(() => {
                  const label = rel || '(unknown)';
                  if (/(^|[\\/])xopc\.extension\.json$/.test(rel) || rel === MANIFEST) {
                    console.log(colors.cyan('[watch]'), `manifest: ${label}`);
                  } else if (/\.(html?|css|mjs|js|tsx?|jsx|json)$/i.test(label)) {
                    if (/^ui[\\/]/.test(rel) || /[\\/]ui[\\/]/.test(label)) {
                      console.log(colors.cyan('[watch]'), `ui: ${label}`);
                    } else {
                      console.log(colors.cyan('[watch]'), `source: ${label}`);
                    }
                  } else {
                    console.log(colors.cyan('[watch]'), `changed: ${label}`);
                  }
                }, 300);
              },
            );
          } catch (e) {
            log.warn({ err: e }, 'fs.watch failed; continuing without watch');
          }
        }

        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          if (debounce) clearTimeout(debounce);
          if (watcher) {
            try {
              watcher.close();
            } catch (e) {
              log.warn({ err: e }, 'watcher close failed');
            }
          }
          cleanupSymlink(symlinkPath);
        };

        for (const sig of ['SIGINT', 'SIGTERM'] as const) {
          process.on(sig, () => {
            cleanup();
            process.exit(0);
          });
        }

        if (!options.gateway) {
          if (options.watch) {
            console.log(colors.cyan('Watching…'), 'Ctrl+C to stop and remove symlink');
          } else {
            console.log(
              colors.cyan('Holding process…'),
              'Ctrl+C to stop and remove symlink (no file watch)',
            );
          }
          await new Promise(() => {
            /* until SIGINT / SIGTERM */
          });
          return;
        }

        const port = parseInt(options.port, 10);
        const bindModes = new Set(['auto', 'loopback', 'lan', 'tailnet', 'custom']);
        const bindRaw = options.bind.trim().toLowerCase();
        if (!bindModes.has(bindRaw)) {
          console.error(colors.red('error:'), 'Invalid --bind mode');
          cleanup();
          process.exit(1);
        }
        const bind = bindRaw as import('../../config/schema.js').GatewayBindMode;
        await ensureGatewayReady(ctx.configPath, ctx.workspacePath, port);
        const cfg = loadConfig(ctx.configPath);
        const { resolveGatewayListenPlan } = await import('../../gateway/listen.js');
        const listenPlan = resolveGatewayListenPlan({ cfg, bindOverride: bind });

        if (Number.isNaN(port)) {
          console.error(colors.red('error:'), 'Invalid --port');
          cleanup();
          process.exit(1);
        }

        console.log('🚀 Starting gateway (extension dev)…');
        console.log(`   Bind: ${bind} (${listenPlan.bindHost})`);
        console.log(`   Port: ${port}`);
        console.log('');

        try {
          await runGatewayLoop({
            configPath: ctx.configPath || resolveConfigPath(),
            port,
            start: async () => {
              const server = new GatewayServer({
                bindHost: listenPlan.bindHost,
                bind: listenPlan.bindMode,
                customBindHost: listenPlan.customBindHost,
                port,
                token: cfg?.gateway?.auth?.token,
                verbose: ctx.isVerbose,
                configPath: ctx.configPath,
                enableHotReload: true,
              });
              await server.start();
              const displayHost = listenPlan.bindHost === '0.0.0.0' ? 'localhost' : listenPlan.bindHost;
              const token = cfg?.gateway?.auth?.token;
              console.log('✅ Gateway started');
              console.log(`   URL: http://${displayHost}:${port}`);
              if (token) {
                console.log(
                  `   Token: ${String(token).slice(0, 8)}...${String(token).slice(-8)}`,
                );
              }
              console.log('');
              return server;
            },
          });
        } finally {
          cleanup();
        }
      },
    );
}
