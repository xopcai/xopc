#!/usr/bin/env node
/**
 * macOS signing + notarization for local development builds.
 *
 * Prerequisites:
 *   1. Developer ID Application certificate installed in Keychain
 *      (download from developer.apple.com → Certificates)
 *   2. App-Specific Password from appleid.apple.com
 *   3. Team ID from developer.apple.com → Membership
 *
 * Setup env (recommended: copy to .env.local and fill in values):
 *
 *   XOPC_CSC_LINK=path/to/DeveloperIDApplication.p12   (or base64 string)
 *   XOPC_CSC_KEY_PASSWORD=<your-p12-password>
 *   XOPC_APPLE_ID=your@email.com
 *   XOPC_APPLE_APP_SPECIFIC_PASSWORD=<app-specific-password>
 *   XOPC_APPLE_TEAM_ID=<10-char-team-id>
 *
 * Usage:
 *   node scripts/electron-sign-local.mjs --mac          # universal
 *   node scripts/electron-sign-local.mjs --mac --x64    # Intel only
 *   node scripts/electron-sign-local.mjs --mac --arm64  # Apple Silicon only
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { config } from 'dotenv';

const __dirname = fileURLToPath(new URL('..', import.meta.url));

// Load .env.local for local credentials (gitignored)
const envLocalPath = join(__dirname, '..', '.env.local');
if (existsSync(envLocalPath)) {
  config({ path: envLocalPath });
}

const root = join(__dirname, '..');
const require = createRequire(join(root, 'package.json'));
const cli = require.resolve('electron-builder/cli.js');

const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'];
const LOCAL_PROXY = /127\.0\.0\.1|localhost|\[::1\]/i;

function shouldStripProxy(value) {
  return typeof value === 'string' && LOCAL_PROXY.test(value);
}

const env = { ...process.env };

// Strip local proxies (Clash/V2Ray) to avoid download failures
if (process.env['ELECTRON_BUILDER_KEEP_PROXY'] !== '1') {
  for (const k of PROXY_KEYS) {
    if (shouldStripProxy(env[k])) delete env[k];
  }
}

// --- Certificate config ---
// CSC_LINK: can be a file path (file:///path/to/cert.p12) or base64-encoded string
// For local builds, use file path
const cscLink = process.env['XOPC_CSC_LINK'];
const cscKeyPassword = process.env['XOPC_CSC_KEY_PASSWORD'];

if (cscLink && cscKeyPassword) {
  // If it's a base64 string, decode to a temp file
  if (cscLink.startsWith('/') || cscLink.startsWith('file://')) {
    env['CSC_LINK'] = cscLink;
  } else {
    // base64 encoded p12 — write to temp file
    const tmpFile = join(__dirname, '.tmp-cert.p12');
    require('fs').writeFileSync(tmpFile, Buffer.from(cscLink, 'base64'));
    env['CSC_LINK'] = tmpFile;
  }
  env['CSC_KEY_PASSWORD'] = cscKeyPassword;
} else {
  console.warn('⚠️  Missing XOPC_CSC_LINK or XOPC_CSC_KEY_PASSWORD — signing skipped.');
  console.warn('   Set these in .env.local (see scripts/electron-sign-local.mjs header).');
}

// --- Notarization config ---
const appleId = process.env['XOPC_APPLE_ID'];
const appleAppSpecificPassword = process.env['XOPC_APPLE_APP_SPECIFIC_PASSWORD'];
const appleTeamId = process.env['XOPC_APPLE_TEAM_ID'];

if (appleId && appleAppSpecificPassword && appleTeamId) {
  env['APPLE_ID'] = appleId;
  env['APPLE_APP_SPECIFIC_PASSWORD'] = appleAppSpecificPassword;
  env['APPLE_TEAM_ID'] = appleTeamId;
} else {
  console.warn('⚠️  Missing Apple notarization credentials — notarization skipped.');
  console.warn('   Set XOPC_APPLE_ID, XOPC_APPLE_APP_SPECIFIC_PASSWORD, XOPC_APPLE_TEAM_ID in .env.local.');
}

// Extra CLI args
const extra = process.argv.slice(2);
const hasPublishFlag = extra.some((a) => a === '--publish' || a.startsWith('--publish='));
const publishArgs = process.env['ELECTRON_PUBLISH'] === '1' || hasPublishFlag ? [] : ['--publish', 'never'];

console.log('🔐 Signing config:');
console.log(`   CSC_LINK: ${env['CSC_LINK'] ? (env['CSC_LINK'].includes('base64') ? '<base64-encoded>' : env['CSC_LINK']) : '<not set>'}`);
console.log(`   APPLE_ID: ${env['APPLE_ID'] || '<not set>'}`);
console.log(`   APPLE_TEAM_ID: ${env['APPLE_TEAM_ID'] || '<not set>'}`);
console.log('');

const r = spawnSync(process.execPath, [cli, ...publishArgs, ...extra], { stdio: 'inherit', env, cwd: root });
process.exit(r.status ?? 1);
