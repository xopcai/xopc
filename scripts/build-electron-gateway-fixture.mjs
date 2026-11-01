// Text-only Linux Gateway fixture from the same bundle shipped in the desktop app.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { buildMinimalElectronPackageJson } from './electron-runtime-externals.mjs';
import { createAcceptanceOutput } from './electron-local-connection-support.mjs';

const root = resolve(import.meta.dirname, '..');
const output = await createAcceptanceOutput(join(root, 'reports/s4-gateway-fixture-build.json'));
const imageIndex = process.argv.indexOf('--image');
const image = imageIndex < 0 ? 'xopc:s4-bundled-gateway' : process.argv[imageIndex + 1];
assert(image && /^[a-z0-9][a-z0-9/_.:-]*$/.test(image), 'Invalid fixture image name');
const context = mkdtempSync(join(tmpdir(), 'xopc-s4-gateway-build-'));
const report = { passed: false, image, startedAt: new Date().toISOString(), scope: 'Linux text-only bundled Gateway fixture; lifecycle scripts disabled, no native PTY/browser/Host coverage; not the standalone production Docker image' };
try {
  const pkg = buildMinimalElectronPackageJson(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), root);
  writeFileSync(join(context, 'package.json'), JSON.stringify({ name: 'xopc-s4-server-fixture', private: true, type: 'module', version: pkg.version, dependencies: pkg.dependencies }));
  const pnpmCommand = execFileSync('sh', ['-c', 'command -v pnpm'], { encoding: 'utf8' }).trim();
  const pnpmRoot = dirname(dirname(realpathSync(pnpmCommand)));
  report.pnpm = JSON.parse(readFileSync(join(pnpmRoot, 'package.json'), 'utf8')).version;
  assert.equal(report.pnpm, '11.9.0');
  cpSync(pnpmRoot, join(context, 'pnpm'), { recursive: true, dereference: true });
  for (const path of ['out/server', 'dist/gateway/static/root', 'dist/electron/extensions', 'skills']) cpSync(join(root, path), join(context, path), { recursive: true, dereference: true });
  cpSync(join(root, 'scripts/fixtures/electron-gateway/Dockerfile'), join(context, 'Dockerfile'));
  report.serverSha256 = createHash('sha256').update(readFileSync(join(context, 'out/server/index.js'))).digest('hex');
  report.dependencies = pkg.dependencies;
  const built = spawnSync('docker', ['build', '-t', image, context], { stdio: 'inherit' });
  assert.equal(built.status, 0, 'Gateway fixture image build failed');
  report.imageId = JSON.parse(execFileSync('docker', ['image', 'inspect', image, '--format', '{{json .Id}}'], { encoding: 'utf8' }));
  report.passed = true;
} catch (error) { report.error = String(error?.stack ?? error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); rmSync(context, { recursive: true, force: true }); }
