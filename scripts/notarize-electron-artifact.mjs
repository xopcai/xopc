// Submit the existing signed artifact without rebuilding it or printing credentials.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadElectronSigningEnv } from './electron-signing-env.mjs';

const root = resolve(import.meta.dirname, '..');
const env = loadElectronSigningEnv(root);
const [action = 'submit', target, output = '/tmp/xopc-notary-result.json'] = process.argv.slice(2);
if (!['submit', 'info', 'log', 'history'].includes(action) || !target) throw new Error('Usage: node scripts/notarize-electron-artifact.mjs submit|info|log artifact-or-id output.json');
let auth;
if (env.APPLE_KEYCHAIN_PROFILE) auth = ['--keychain-profile', env.APPLE_KEYCHAIN_PROFILE, ...(env.APPLE_KEYCHAIN ? ['--keychain', env.APPLE_KEYCHAIN] : [])];
else if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID) auth = ['--key', env.APPLE_API_KEY, '--key-id', env.APPLE_API_KEY_ID, ...(env.APPLE_API_ISSUER ? ['--issuer', env.APPLE_API_ISSUER] : [])];
else if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) auth = ['--apple-id', env.APPLE_ID, '--password', env.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', env.APPLE_TEAM_ID];
else throw new Error('Notarization credentials are missing');
const args = ['notarytool', action, ...(action === 'history' ? [] : [target]), ...auth, ...(action === 'log' ? [output] : ['--output-format', 'json', '--no-progress'])];
const result = spawnSync('xcrun', args, { env, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
const redact = text => {
  let value = text || '';
  for (const secret of [env.APPLE_APP_SPECIFIC_PASSWORD, env.CSC_KEY_PASSWORD]) if (secret) value = value.replaceAll(secret, '[REDACTED]');
  return value;
};
if (result.status !== 0) {
  process.stderr.write(redact(result.stderr || result.stdout));
  process.exit(result.status ?? 1);
}
if (action !== 'log') {
  const data = JSON.parse(result.stdout);
  writeFileSync(output, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ id: data.id, status: data.status, message: data.message, name: data.name }));
} else console.log(`Notarization log saved: ${output}`);
