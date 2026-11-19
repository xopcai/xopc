#!/usr/bin/env node
// Upload a signed HarmonyOS APP through the documented AppGallery Connect API.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { AGC_ORIGIN, agcAuthHeaders } from './agc-auth.mjs';

const appId = process.env.HUAWEI_AGC_APP_ID || '6917618744771171142';
const packagePath = process.argv[2] && resolve(process.argv[2]);
const maxAttempts = 5;

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function uploadWithCurl(url, headers, path, size) {
  return new Promise((resolveUpload, rejectUpload) => {
    const args = ['--silent', '--show-error', '--max-time', '600', '--connect-timeout', '30', '--request', 'PUT', '--output', '/dev/null', '--write-out', '%{http_code}', '--upload-file', path];
    for (const [name, value] of Object.entries(headers)) args.push('--header', `${name}: ${value}`);
    args.push('--header', `Content-Length: ${size}`, url);
    const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let status = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { status += chunk; });
    child.stderr.resume();
    child.on('error', rejectUpload);
    child.on('close', (code) => {
      if (code !== 0) return rejectUpload(new Error(`curl failed (${code}).`));
      resolveUpload(Number(status.trim()));
    });
  });
}

async function main() {
  if (!packagePath || !packagePath.endsWith('.app')) throw new Error('Usage: node upload-agc-app.mjs /absolute/path/to/signed.app');
  const headers = { ...agcAuthHeaders(), Accept: 'application/json' };
  const file = await stat(packagePath);
  if (!file.isFile() || file.size === 0 || file.size > 4 * 1024 ** 3) throw new Error('Expected a nonempty .app file no larger than 4 GB');
  const checksum = await sha256(packagePath);
  const fileName = basename(packagePath);
  console.log(`Uploading ${fileName} (${file.size} bytes, SHA-256 ${checksum})`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const endpoint = new URL('/api/publish/v2/upload-url/for-obs', AGC_ORIGIN);
      for (const [key, value] of Object.entries({ appId, fileName, contentLength: String(file.size), sha256: checksum, releaseType: '6' })) endpoint.searchParams.set(key, value);
      const response = await fetch(endpoint, { headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (response.status === 401 || response.status === 403) throw new Error(`Huawei authentication or permission failed: HTTP ${response.status}`);
      if (!response.ok) throw new Error(`Upload URL request failed: HTTP ${response.status}`);
      const data = await response.json();
      if (data.ret?.code !== 0) throw new Error(`Upload URL request failed (service code ${/^\d+$/.test(data.ret?.code) ? data.ret.code : 'unknown'}).`);
      const info = data.urlInfo;
      if (!info?.objectId || !info?.url || info.method !== 'PUT' || !info.headers || new URL(info.url).protocol !== 'https:') {
        throw new Error('Huawei returned incomplete upload information');
      }
      const status = await uploadWithCurl(info.url, info.headers, packagePath, file.size);
      if (status !== 200) throw new Error(`APP upload failed: HTTP ${status}`);
      console.log(JSON.stringify({ appId, fileName, sha256: checksum, objectId: info.objectId, uploaded: true }, null, 2));
      console.log('File upload complete. Register this objectId as a test package and check parsing before submitting an internal test.');
      return;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      const waitMs = Math.min(30_000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
      console.error(`Attempt ${attempt}/${maxAttempts} failed: ${error.message}; retrying in ${Math.round(waitMs / 1000)}s`);
      await delay(waitMs);
    }
  }
}

main().catch((error) => fail(error.message));
