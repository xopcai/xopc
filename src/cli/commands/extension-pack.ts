import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import AdmZip from 'adm-zip';
import { Command } from 'commander';

import { checkEngineCompatibility } from '../../extensions/engine-check.js';
import type { ExtensionManifest } from '../../extensions/types/index.js';
import { normalizeExtensionManifest } from '../../extensions/normalize-manifest.js';
import { collectExtensionPackageDependencyIssues } from '../../extensions/package-contract.js';
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

export interface PackDiagnostic {
  level: 'error' | 'warning' | 'info';
  message: string;
}

export interface ExtensionPackageValidationResult {
  extensionDir: string;
  manifest: ExtensionManifest | null;
  packageJson: Record<string, unknown> | null;
  diagnostics: PackDiagnostic[];
  ok: boolean;
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

function resolveMainFile(root: string, main: string): string | null {
  const p = join(root, main);
  return existsSync(p) ? p : null;
}

function validateManifest(ctx: PackContext): void {
  const { manifest, extensionDir, diagnostics } = ctx;
  if (!manifest.id || !String(manifest.id).trim()) {
    diagnostics.push({ level: 'error', message: 'Manifest "id" is required' });
  }
  if (!manifest.main) {
    diagnostics.push({ level: 'error', message: 'Manifest "main" is required and must point at built JavaScript' });
  }
  const mainFile = manifest.main ? resolveMainFile(extensionDir, manifest.main) : null;
  if (!mainFile) {
    diagnostics.push({
      level: 'error',
      message: `Main entry not found: ${manifest.main ?? '(missing)'}`,
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

  if (manifest.main && !/\.(mjs|cjs|js)$/i.test(manifest.main)) {
    diagnostics.push({
      level: 'error',
      message: `Strict package contract requires manifest.main to point at built JavaScript, got "${manifest.main}"`,
    });
  }

  if (!manifest.engines?.xopc) {
    diagnostics.push({
      level: 'error',
      message: 'manifest engines.xopc is required for independent extension packages',
    });
  } else {
    const r = checkEngineCompatibility(PACKAGE_VERSION, manifest.engines.xopc);
    if (r.parseWarning) {
      diagnostics.push({
        level: 'error',
        message: `engines.xopc parse issue — ${r.reason ?? 'unknown'}`,
      });
    } else if (!r.compatible) {
      diagnostics.push({
        level: 'error',
        message: `engines.xopc not satisfied by current xopc ${PACKAGE_VERSION}: ${r.reason ?? manifest.engines.xopc}`,
      });
    }
  }
}

function validatePackageJson(ctx: PackContext): void {
  const { packageJson, diagnostics, extensionDir } = ctx;
  for (const issue of collectExtensionPackageDependencyIssues(packageJson, {
    strictRuntimeSdkDeps: true,
  })) {
    diagnostics.push({
      level: 'error',
      message: issue.message,
    });
  }

  const files = packageJson.files;
  if (Array.isArray(files)) {
    if (!files.some((f) => f === MANIFEST || f === '**/xopc.extension.json')) {
      diagnostics.push({
        level: 'error',
        message: `package.json "files" must include "${MANIFEST}" so the archive ships the manifest`,
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

const SECRET_FILE_RE = /(^|\/)(\.env(?:\..*)?|\.npmrc|\.yarnrc|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/i;
const SECRET_TEXT_RE = /(sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----)/;

function scanUnsafeFiles(root: string, diagnostics: PackDiagnostic[]): void {
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).replace(/\\/g, '/');
      if (shouldExcludeFromArtifact(rel)) continue;
      if (SECRET_FILE_RE.test(rel)) {
        diagnostics.push({ level: 'error', message: `Unsafe secret-like file would be packaged: ${rel}` });
        continue;
      }
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const size = statSync(full).size;
        if (size <= 1024 * 1024 && /\.(?:js|mjs|cjs|json|html|css|md|txt|map)$/i.test(entry.name)) {
          const text = readFileSync(full, 'utf-8');
          if (SECRET_TEXT_RE.test(text)) {
            diagnostics.push({ level: 'error', message: `Potential secret token found in packaged file: ${rel}` });
          }
        }
      }
    }
  };
  walk(root);
}

export function validateExtensionPackageDirectory(dir: string): ExtensionPackageValidationResult {
  const extensionDir = resolve(dir || '.');
  const diagnostics: PackDiagnostic[] = [];
  if (!existsSync(extensionDir) || !existsSync(join(extensionDir, 'package.json'))) {
    diagnostics.push({ level: 'error', message: `Not an extension project (no package.json): ${extensionDir}` });
    return { extensionDir, manifest: null, packageJson: null, diagnostics, ok: false };
  }
  const manifest = loadManifestAtRoot(extensionDir, diagnostics);
  let packageJson: Record<string, unknown> | null = null;
  try {
    packageJson = loadJson(join(extensionDir, 'package.json')) as Record<string, unknown>;
    if (!isRecord(packageJson)) throw new Error('package.json must be an object');
  } catch (e) {
    diagnostics.push({ level: 'error', message: e instanceof Error ? e.message : String(e) });
  }
  if (manifest && packageJson) {
    const ctx: PackContext = { extensionDir, manifest, packageJson, diagnostics };
    validateManifest(ctx);
    validatePackageJson(ctx);
    scanUnsafeFiles(extensionDir, diagnostics);
  }
  return {
    extensionDir,
    manifest,
    packageJson,
    diagnostics,
    ok: !diagnostics.some((d) => d.level === 'error'),
  };
}

function shouldExcludeFromArtifact(rel: string): boolean {
  const parts = rel.split(/[\\/]+/);
  if (parts.some((p) => p === 'node_modules' || p === '.git' || p === '.turbo' || p === '.cache')) return true;
  const name = parts.at(-1) ?? rel;
  if (name === '.DS_Store') return true;
  if (name.endsWith('.tgz') || name.endsWith('.zip') || name.endsWith('.sha256') || name.endsWith('.manifest.json')) return true;
  if (name.endsWith('.tsbuildinfo')) return true;
  return false;
}

function addDirectoryToZip(zip: AdmZip, root: string, dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(root, full).replace(/\\/g, '/');
    if (shouldExcludeFromArtifact(rel)) continue;
    if (entry.isDirectory()) {
      addDirectoryToZip(zip, root, full);
    } else if (entry.isFile()) {
      zip.addFile(rel, readFileSync(full));
    }
  }
}

function writeStoreReadyArtifact(params: {
  extensionDir: string;
  outDir: string;
  manifest: ExtensionManifest;
  packageJson: Record<string, unknown>;
}): string {
  mkdirSync(params.outDir, { recursive: true });
  const name = String(params.packageJson.name ?? params.manifest.id)
    .replace(/^@/, '')
    .replace(/[\\/]+/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-');
  const version = String(params.manifest.version ?? params.packageJson.version ?? '0.0.0');
  const base = `${name}-${version}`;
  const zipPath = join(params.outDir, `${base}.zip`);
  const zip = new AdmZip();
  addDirectoryToZip(zip, params.extensionDir, params.extensionDir);
  zip.writeZip(zipPath);

  const buffer = readFileSync(zipPath);
  const sha256Hex = createHash('sha256').update(buffer).digest('hex');
  const integrity = `sha256-${createHash('sha256').update(buffer).digest('base64')}`;
  writeFileSync(join(params.outDir, `${base}.sha256`), `${sha256Hex}  ${basename(zipPath)}\n`);
  writeFileSync(
    join(params.outDir, `${base}.manifest.json`),
    JSON.stringify(
      {
        id: params.manifest.id,
        name: params.manifest.name,
        version,
        artifact: basename(zipPath),
        integrity,
        manifest: params.manifest,
        packageJson: params.packageJson,
      },
      null,
      2,
    ),
  );
  return zipPath;
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
  return new Command('pack')
    .description('Package an extension as a .tgz archive for distribution')
    .argument('[dir]', 'Extension directory (default: current working directory)', '.')
    .option('--out <dir>', 'Output directory for the .tgz (default: extension directory)', '')
    .option('--no-build-ui', 'Skip automatic "npm run build:ui" when defined')
    .option('--dry-run', 'Validate only; do not create an archive', false)
    .action((dir: string, opts: { out?: string; buildUi: boolean; dryRun: boolean }) => {
      const validation = validateExtensionPackageDirectory(dir || '.');
      const { extensionDir, manifest, packageJson, diagnostics } = validation;
      const outDir = opts.out && opts.out.length > 0 ? resolve(opts.out) : extensionDir;
      printDiagnostics(diagnostics);

      if (!validation.ok || !manifest || !packageJson) {
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

      let artifactPath: string;
      try {
        artifactPath = writeStoreReadyArtifact({ extensionDir, outDir, manifest, packageJson });
      } catch (e) {
        log.error({ err: e }, 'pack failed');
        console.error(colors.red('error:'), e instanceof Error ? e.message : String(e));
        process.exit(1);
      }

      console.log('');
      console.log(colors.green('Pack complete:'), artifactPath);
      console.log(colors.cyan('Generated:'), '.zip artifact, .sha256 checksum, .manifest.json metadata');
      console.log(colors.cyan('Next:'), 'upload the generated artifact set to store.xopc.ai or install the zip via the store pipeline.');
    });
}
