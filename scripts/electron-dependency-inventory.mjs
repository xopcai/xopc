import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const licenseName = /^(licen[sc]e|copying|notice|copyright)([._-].*)?$/i;
const slash = path => path.split(sep).join('/');

export function dependencyRecords(inputs, root) {
  const records = new Map();
  for (const input of inputs) {
    if (!input || input.startsWith('\0') || !input.includes('node_modules')) continue;
    let directory = dirname(resolve(root, input.split('?')[0]));
    while (dirname(directory) !== directory) {
      const manifest = join(directory, 'package.json');
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        if (pkg.name && pkg.version) {
          const notices = readdirSync(directory, { withFileTypes: true }).filter(e => e.isFile() && licenseName.test(e.name))
            .map(e => ({ file: e.name, text: readFileSync(join(directory, e.name), 'utf8') }));
          const record = { name: pkg.name, version: pkg.version, license: pkg.license ?? 'UNKNOWN',
            repository: pkg.repository ?? pkg.homepage ?? null, notices };
          records.set(`${pkg.name}@${pkg.version}`, record); break;
        }
      }
      directory = dirname(directory);
    }
  }
  return [...records.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

/** Capture the actual modules consumed by Vite, including font and artwork packages. */
export function dependencyInventoryPlugin(root) {
  return { name: 'xopc:dependency-inventory', generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'dependency-records.json', source: JSON.stringify({
      schemaVersion: 1, scope: 'bundled-module-inputs', packages: dependencyRecords([...this.getModuleIds()], root),
    }, null, 2) + '\n' });
  } };
}

export function writeDependencyRecords(path, inputs, root) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, scope: 'bundled-module-inputs', packages: dependencyRecords(inputs, root) }, null, 2) + '\n');
}

export function windowsSigningBoundary(path, kind = 'payload') {
  const value = path.replaceAll('\\', '/');
  if (value.includes('..') || value.startsWith('/') || value.includes(':')) return 'reject';
  if (kind === 'installer' && /^xopc-\d+\.\d+\.\d+-(x64|arm64)\.exe$/.test(value)) return 'project-installer-requires-approval';
  if (value === 'xopc.exe') return 'electron-launcher-requires-approval';
  if (value === 'resources/bin/voice-hotkey-helper.exe') return 'project-built-helper';
  if (/^Uninstall xopc\.exe$/i.test(value)) return 'generated-uninstaller-requires-approval';
  return 'third-party-do-not-resign';
}

/** Inventory the exact staging closure, embedded inputs and resources for this target. */
export function createDesktopInventory(packDir, root, target) {
  const files = {}, packages = new Map(), binaries = [], embeddedManifests = [];
  const visited = new Set();
  function add(record, source) {
    const key = `${record.name}@${record.version}`;
    const old = packages.get(key);
    packages.set(key, { ...record, sources: [...new Set([...(old?.sources ?? []), source])] });
  }
  function walk(directory, insideNodeModules = false) {
    const real = realpathSync(directory);
    if (visited.has(real)) return;
    visited.add(real);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), rel = slash(relative(packDir, path));
      if (rel.startsWith('_pack-resources/compliance')) continue;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        const target = realpathSync(path);
        if (!target.startsWith(realpathSync(packDir) + sep)) throw new Error(`Staging symlink escapes package: ${rel}`);
        files[rel] = { linkTarget: slash(relative(realpathSync(packDir), target)) }; continue;
      }
      if (entry.isDirectory()) { walk(path, insideNodeModules || entry.name === 'node_modules'); continue; }
      if (!entry.isFile()) continue;
      const bytes = readFileSync(path);
      files[rel] = { sha256: digest(bytes), bytes: bytes.length };
      if (entry.name.endsWith('dependency-records.json')) {
        const body = JSON.parse(bytes.toString('utf8'));
        if (body.schemaVersion !== 1 || !Array.isArray(body.packages)) throw new Error(`Invalid bundled inventory: ${rel}`);
        embeddedManifests.push(rel);
        for (const record of body.packages) add(record, rel);
      }
      if (entry.name === 'package.json' && insideNodeModules) {
        for (const record of dependencyRecords([join(directory, 'index.js')], root)) add(record, rel);
      }
      if (/\.(exe|dll|node)$/i.test(entry.name)) {
        // extraResources paths become resources/bin in the installed application.
        const installed = rel.startsWith('_pack-resources/voice-hotkey/') ? rel.replace('_pack-resources/voice-hotkey/', 'resources/bin/')
          : rel.startsWith('_pack-resources/computer-driver/') ? rel.replace('_pack-resources/computer-driver/', 'resources/bin/') : rel;
        binaries.push({ file: rel, installedPath: installed, sha256: digest(bytes), signing: windowsSigningBoundary(installed) });
      }
    }
  }
  walk(packDir);
  for (const name of ['electron', 'playwright-core', '@vscode/ripgrep']) {
    const directory = join(root, 'node_modules', ...name.split('/'));
    if (existsSync(directory)) for (const record of dependencyRecords([join(directory, 'index.js')], root)) add(record, 'upstream-extra-resource-or-runtime');
  }
  for (const path of ['out/main/dependency-records.json', 'out/preload/dependency-records.json', 'out/server/dependency-records.json',
    'dist/gateway/static/root/dependency-records.json', 'dist/electron/extensions/dependency-records.json']) {
    if (!embeddedManifests.includes(path)) throw new Error(`Build inventory missing: ${path}`);
  }
  const list = [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  const reviewRequired = list.filter(p => p.license === 'UNKNOWN' || !p.notices?.length || /MPL|LGPL|EPL|CC-BY|OFL|SEE LICENSE|UNLICENSED|LicenseRef/i.test(String(p.license)))
    .map(p => ({ package: `${p.name}@${p.version}`, license: p.license, missingNotice: !p.notices?.length }));
  const inventory = { schemaVersion: 1, target, version: JSON.parse(readFileSync(join(root, 'package.json'))).version,
    scope: 'Exact pre-builder staging bytes and observed bundle inputs; upstream prebundles may contain further dependencies requiring review',
    embeddedManifests, packages: list, files, binaries, reviewRequired, signPathReady: false,
    unresolved: ['Review upstream prebundled workers/Electron and their bundled notices', 'Approve exact Electron/NSIS signing scope with SignPath',
      'Resolve license/source obligations and missing notices before production Foundation signing'] };
  const output = join(packDir, '_pack-resources/compliance'); mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'dependency-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
  writeFileSync(join(output, 'THIRD-PARTY-NOTICES.txt'), list.map(p => `${p.name}@${p.version}\nDeclared license: ${p.license}\nSource: ${JSON.stringify(p.repository)}\n${p.notices.map(n => `${n.file}\n${n.text}`).join('\n')}\n`).join('\n----------------\n'));
  writeFileSync(join(output, 'signing-boundary.json'), JSON.stringify({ schemaVersion: 1, signPathEnabled: false, signPathReady: false,
    ownFiles: ['xopc.exe (approval required)', 'resources/bin/voice-hotkey-helper.exe', 'generated NSIS installer/uninstaller (approval required)'],
    thirdPartyPolicy: 'Preserve upstream bytes and signatures; never blanket-sign DLLs, Node addons or upstream helpers', binaries }, null, 2) + '\n');
  // Retain the actual isolated install resolution without machine paths or registry credentials.
  const lock = join(packDir, 'pnpm-lock.yaml');
  if (existsSync(lock)) writeFileSync(join(output, 'runtime-pnpm-lock.yaml'), readFileSync(lock));
  return inventory;
}
