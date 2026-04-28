import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { Command } from 'commander';

import { checkEngineCompatibility } from '../../extensions/engine-check.js';
import type { ExtensionManifest } from '../../extensions/types/index.js';
import { normalizeExtensionManifest } from '../../extensions/normalize-manifest.js';
import { PACKAGE_VERSION } from '../../package-version.js';
import { createLogger } from '../../utils/logger.js';
import { colors } from '../utils/colors.js';

const log = createLogger('ExtensionPack');
const MANIFEST = 'xopc.extension.json';

interface PackContext {
  extensionDir: string;
  manifest: ExtensionManifest;
  packageJson: Record<string, unknown>;
  diagnostics: PackDiagnostic[];
}

interface PackDiagnostic {
  level: 'error' | 'warning' | 'info';
  message: string;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8') as string) as unknown;
}

function loadManifestAtRoot(
  root: string,
  diagnostics: PackDiagnostic[],
): ExtensionManifest | null {
  const manifestPath = join(root, MANIFEST);
  if (!existsSync(manifestPath)) {
    diagnostics.push({ level: 'error', message: `Missing ${MANIFEST} in ${root}` });
    return null;
  }
  try {
    const raw = loadJson(manifestPath);
    if (!isRecord(raw)) {
      diagnostics.push({ level: 'error', message: `${MANIFEST} must be a JSON object` });
      return null;
    }
    return normalizeExtensionManifest(raw);
  } catch (e) {
    diagnostics.push({
      level: 'error',
      message: `Failed to parse ${MANIFEST}: ${e instanceof Error ? e.message : String(e)}`,
    });
    return null;
  }
}

function collectContributionPaths(manifest: ExtensionManifest, extRoot: string): string[] {
  const out: string[] = [];
  const ui = manifest.ui;
  if (ui?.main) out.push(join(extRoot, ui.main));
  if (ui?.icon) out.push(join(extRoot, ui.icon));
  const c = ui?.contributions;
  if (!c) return out;
  for (const p of c.sidebarPanels ?? []) {
    if (p.entrypoint) out.push(join(extRoot, p.entrypoint));
  }
  for (const p of c.settingsPanels ?? []) {
    if (p.entrypoint) out.push(join(extRoot, p.entrypoint));
  }
  for (const p of c.chatWidgets ?? []) {
    if (p.entrypoint) out.push(join(extRoot, p.entrypoint));
  }
  for (const p of c.pages ?? []) {
    if (p.entrypoint) out.push(join(extRoot, p.entrypoint));
  }
  for (const p of c.statusBarItems ?? []) {
    if (p.entrypoint) out.push(join(extRoot, p.entrypoint));
  }
  return out;
}

function resolveMainFile(root: string, main?: string): string | null {
  const cands = [main, 'index.ts', 'index.js', 'extension.ts', 'extension.js'].filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
  for (const c of cands) {
    const p = join(root, c);
    if (existsSync(p)) return p;
  }
  return null;
}

function validateManifest(ctx: PackContext): void {
  const { manifest, extensionDir, diagnostics } = ctx;
  if (!manifest.id || !String(manifest.id).trim()) {
    diagnostics.push({ level: 'error', message: 'Manifest "id" is required' });
  }
  const mainFile = resolveMainFile(extensionDir, manifest.main);
  if (!mainFile) {
    diagnostics.push({
      level: 'error',
      message: `Main entry not found (expected main, index.ts, index.js, etc. in ${extensionDir})`,
    });
  }

  if (manifest.ui?.main) {
    const p = join(extensionDir, manifest.ui.main);
    if (!existsSync(p)) {
      diagnostics.push({ level: 'error', message: `ui.main missing: ${manifest.ui.main}` });
    }
  }

  for (const p of collectContributionPaths(manifest, extensionDir)) {
    if (!existsSync(p)) {
      diagnostics.push({ level: 'error', message: `UI contribution entry missing: ${p}` });
    }
  }

  if (manifest.engines?.xopc) {
    const r = checkEngineCompatibility(PACKAGE_VERSION, manifest.engines.xopc);
    if (r.parseWarning) {
      diagnostics.push({
        level: 'warning',
        message: `engines.xopc parse issue — ${r.reason ?? 'unknown'} (continuing)`,
      });
    } else if (!r.compatible) {
      diagnostics.push({
        level: 'warning',
        message: `engines.xopc not satisfied by current xopc ${PACKAGE_VERSION}: ${r.reason ?? manifest.engines.xopc}`,
      });
    }
  }
}

function validatePackageJson(ctx: PackContext): void {
  const { packageJson, diagnostics, extensionDir } = ctx;
  const deps = packageJson.dependencies;
  if (isRecord(deps)) {
    for (const [name, v] of Object.entries(deps)) {
      if (typeof v === 'string' && v.startsWith('workspace:')) {
        diagnostics.push({
          level: 'warning',
          message: `dependency "${name}": ${v} — will be replaced when packing from a pnpm workspace`,
        });
      }
    }
  }

  const files = packageJson.files;
  if (Array.isArray(files)) {
    if (!files.some((f) => f === MANIFEST || f === '**/xopc.extension.json')) {
      diagnostics.push({
        level: 'warning',
        message: `package.json "files" should include "${MANIFEST}" so the archive ships the manifest`,
      });
    }
  }

  const keywords = packageJson.keywords;
  if (Array.isArray(keywords) && !keywords.includes('xopc-extension')) {
    diagnostics.push({
      level: 'info',
      message: 'Consider adding "xopc-extension" to package.json keywords for discoverability',
    });
  } else if (!Array.isArray(keywords)) {
    diagnostics.push({ level: 'info', message: 'Consider adding keywords: ["xopc-extension", ...]' });
  }

  if (!existsSync(join(extensionDir, 'package.json'))) {
    diagnostics.push({ level: 'error', message: 'package.json is missing' });
  }
}

function pnpmAvailable(): boolean {
  try {
    execSync('pnpm --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function printDiagnostics(d: PackDiagnostic[]): void {
  for (const x of d) {
    if (x.level === 'error') {
      console.error(`${colors.red('error')}:`, x.message);
    } else if (x.level === 'warning') {
      console.log(`${colors.yellow('warning')}:`, x.message);
    } else {
      console.log(`${colors.cyan('info')}:`, x.message);
    }
  }
}

export function createExtensionPackCommand(): Command {
  return new Command('extension:pack')
    .alias('ext:pack')
    .description('Package an extension as a .tgz archive for distribution')
    .argument('[dir]', 'Extension directory (default: current working directory)', '.')
    .option('--out <dir>', 'Output directory for the .tgz (default: extension directory)', '')
    .option('--no-build-ui', 'Skip automatic "npm run build:ui" when defined')
    .option('--dry-run', 'Validate only; do not create an archive', false)
    .action((dir: string, opts: { out?: string; buildUi: boolean; dryRun: boolean }) => {
      const extensionDir = resolve(dir || '.');
      const outDir = opts.out && opts.out.length > 0 ? resolve(opts.out) : extensionDir;
      const diagnostics: PackDiagnostic[] = [];
      if (!existsSync(extensionDir) || !existsSync(join(extensionDir, 'package.json'))) {
        console.error(
          colors.red('error:'),
          `Not an extension project (no package.json): ${extensionDir}`,
        );
        process.exit(1);
      }
      const manifest = loadManifestAtRoot(extensionDir, diagnostics);
      if (!manifest) {
        printDiagnostics(diagnostics);
        process.exit(1);
      }

      let packageJson: Record<string, unknown>;
      try {
        packageJson = loadJson(join(extensionDir, 'package.json')) as Record<string, unknown>;
        if (!isRecord(packageJson)) {
          throw new Error('package.json must be an object');
        }
      } catch (e) {
        log.error({ err: e }, 'Failed to read package.json');
        console.error(
          colors.red('error:'),
          e instanceof Error ? e.message : String(e),
        );
        process.exit(1);
      }

      const ctx: PackContext = { extensionDir, manifest, packageJson, diagnostics };
      validateManifest(ctx);
      validatePackageJson(ctx);

      printDiagnostics(diagnostics);

      const hasError = diagnostics.some((d) => d.level === 'error');
      if (hasError) {
        console.error(colors.red('Pack validation failed (fix errors above).'));
        process.exit(1);
      }

      if (opts.dryRun) {
        console.log(colors.green('OK'), ' — dry run; no archive created');
        return;
      }

      const scripts = isRecord(packageJson.scripts) ? (packageJson.scripts as Record<string, unknown>) : null;
      if (opts.buildUi && scripts && typeof scripts['build:ui'] === 'string') {
        try {
          console.log(colors.cyan('Running'), 'npm run build:ui …');
          execSync('npm run build:ui', { cwd: extensionDir, stdio: 'inherit' });
        } catch (e) {
          console.error(
            colors.red('error:'),
            `UI build failed: ${e instanceof Error ? e.message : String(e)}`,
          );
          process.exit(1);
        }
      }

      let tarball: string;
      try {
        const cmd = pnpmAvailable() ? 'pnpm pack' : 'npm pack';
        const out = execSync(cmd, { cwd: extensionDir, encoding: 'utf-8' });
        const lines = out
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const line = lines
          .slice()
          .reverse()
          .find((l) => l.endsWith('.tgz') && !l.startsWith('WARN')) ?? lines.at(-1) ?? '';
        if (line.endsWith('.tgz')) {
          tarball = isAbsolute(line) || line.startsWith('file:') ? resolve(line.replace(/^file:/, '')) : join(extensionDir, line);
        } else {
          tarball = '';
        }
        if (!tarball) {
          const tgzs = readdirSync(extensionDir).filter((f) => f.endsWith('.tgz'));
          tgzs.sort(
            (a, b) => statSync(join(extensionDir, b)).mtimeMs - statSync(join(extensionDir, a)).mtimeMs,
          );
          const last = tgzs[0];
          tarball = last ? join(extensionDir, last) : '';
        }
        if (!tarball || !existsSync(tarball)) {
          throw new Error('Could not locate .tgz after pack; check pnpm/npm output');
        }
      } catch (e) {
        log.error({ err: e }, 'pack failed');
        console.error(
          colors.red('error:'),
          e instanceof Error ? e.message : String(e),
        );
        process.exit(1);
      }

      if (outDir !== extensionDir) {
        try {
          mkdirSync(outDir, { recursive: true });
          const base = tarball.includes('/') ? tarball.slice(tarball.lastIndexOf('/') + 1) : tarball;
          const dest = join(outDir, base);
          renameSync(tarball, dest);
          tarball = dest;
        } catch (e) {
          console.error(
            colors.red('error:'),
            `Failed to move archive to --out: ${e instanceof Error ? e.message : String(e)}`,
          );
          process.exit(1);
        }
      }

      const displayPath = tarball;
      console.log('');
      console.log(colors.green('Pack complete:'), displayPath);
      console.log(
        colors.cyan('Next:'),
        'install the .tgz with your extension workflow, or extract into the global / workspace extensions directory.',
      );
    });
}
