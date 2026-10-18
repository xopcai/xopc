// Run after workspace-e2e-server.mjs and build-browser-e2e.mjs. UI input uses CUA.
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
let executable = require('electron');
let application;
let bundleId;
if (process.platform === 'darwin') {
  const parent = mkdtempSync(join(tmpdir(), 'xopc-workspace-desktop-'));
  application = join(parent, 'XOPC Workspace Acceptance.app');
  cpSync(resolve(dirname(executable), '../..'), application, { recursive: true, verbatimSymlinks: true });
  bundleId = `ai.xopc.workspace.acceptance.${randomUUID()}`;
  const plist = join(application, 'Contents/Info.plist');
  for (const [key, value] of [['CFBundleIdentifier', bundleId], ['CFBundleName', 'XOPC Workspace Acceptance'], ['CFBundleDisplayName', 'XOPC Workspace Acceptance']]) {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
  }
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', application]);
  executable = join(application, 'Contents/MacOS/Electron');
}
const child = spawn(executable, [resolve('out/browser-e2e/index.mjs')], { stdio: 'inherit' });
const metadata = { application, bundleId, pid: child.pid };
writeFileSync('/tmp/xopc-workspace-desktop-e2e.json', JSON.stringify(metadata, null, 2));
console.log(JSON.stringify(metadata, null, 2));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
