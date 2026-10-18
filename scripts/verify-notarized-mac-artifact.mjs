import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import yaml from 'js-yaml';

const [rawDmg, rawApp] = process.argv.slice(2);
if (!rawDmg || !rawApp) throw new Error('Usage: node scripts/verify-notarized-mac-artifact.mjs artifact.dmg installed.app');
const dmg = resolve(rawDmg), app = resolve(rawApp);
const checks = [];
function command(label, executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  checks.push({ label, passed: result.status === 0, status: result.status, output: (result.stdout + result.stderr).trim() });
  if (result.status !== 0) throw new Error(`${label} failed: ${(result.stdout + result.stderr).trim()}`);
  return result.stdout + result.stderr;
}
try {
  const policy = command('Gatekeeper assessments enabled', '/usr/sbin/spctl', ['--status']);
  if (!policy.includes('assessments enabled')) throw new Error('Gatekeeper assessments are not enabled');
  command('DMG code signature', '/usr/bin/codesign', ['--verify', '--strict', dmg]);
  command('Application code signature', '/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  command('DMG stapled ticket', '/usr/bin/xcrun', ['stapler', 'validate', dmg]);
  command('Application stapled ticket', '/usr/bin/xcrun', ['stapler', 'validate', app]);
  command('DMG uncached Gatekeeper assessment', '/usr/sbin/spctl', ['--assess', '--ignore-cache', '--no-cache', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg]);
  command('Application uncached Gatekeeper assessment', '/usr/sbin/spctl', ['--assess', '--ignore-cache', '--no-cache', '--type', 'execute', '--verbose=2', app]);
  command('Application distribution policy', '/usr/bin/syspolicy_check', ['distribution', app, '--json']);
  const metadata = yaml.load(readFileSync(join(dirname(dmg), 'latest-mac.yml'), 'utf8'));
  for (const file of metadata.files) {
    const path = join(dirname(dmg), file.url);
    const hash = createHash('sha512');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (hash.digest('base64') !== file.sha512 || statSync(path).size !== file.size) throw new Error(`Updater hash/size mismatch: ${file.url}`);
    const blockmap = JSON.parse(gunzipSync(readFileSync(path + '.blockmap')).toString());
    const total = blockmap.files.reduce((sum, item) => sum + item.sizes.reduce((a, b) => a + b, 0), 0);
    if (total !== file.size) throw new Error(`Blockmap size mismatch: ${file.url}`);
    checks.push({ label: `Final updater metadata and blockmap: ${basename(path)}`, passed: true });
  }
  const primary = metadata.files.find(file => file.url === metadata.path);
  if (primary?.sha512 !== metadata.sha512) throw new Error('Primary updater hash mismatch');
} finally {
  writeFileSync('/tmp/xopc-notary-gatekeeper-results.json', JSON.stringify({ dmg, app, checks }, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: checks.length, checks: checks.map(check => check.label) }));
