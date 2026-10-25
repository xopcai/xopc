/** Real Electron HTTP + NSIS updater; never installs or bypasses Authenticode. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { X509Certificate } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, session } from 'electron';
import { verifyWindowsUpdateSignature, windowsPublishers } from '../electron/windows-signature.js';

const requireRuntime = createRequire(import.meta.url);
process.on('uncaughtException', error => { writeFileSync(join(process.env.XOPC_UPDATE_TEST_ROOT!, 'bootstrap-error.txt'), error.stack ?? error.message); app.exit(1); });
const { NsisUpdater } = requireRuntime('electron-updater');
const { ElectronHttpExecutor } = requireRuntime('electron-updater/out/electronHttpExecutor');
async function main() {
const root = process.env.XOPC_UPDATE_TEST_ROOT!, feed = process.env.XOPC_UPDATE_TEST_FEED!, fingerprint = process.env.XOPC_UPDATE_TEST_FINGERPRINT!;
await mkdir(join(root, 'electron'), { recursive: true });
app.setPath('userData', join(root, 'electron'));
await app.whenReady();
// Trust only this harness's ephemeral loopback HTTPS leaf, only in the updater session.
session.fromPartition('electron-updater', { cache: false }).setCertificateVerifyProc((request, callback) => {
  const pinned = request.hostname === '127.0.0.1' && new X509Certificate(request.certificate.data).fingerprint256 === fingerprint;
  callback(pinned ? 0 : -3);
});
let installed = false;
const evidence: any = { passed: false, scope: 'negative-only; real HTTPS download and NSIS signature/hash rejection; no installation', cases: [] };
try {
  for (const test of ['unsigned', 'checksum']) {
    const dir = join(root, test); await mkdir(dir, { recursive: true });
    const config = join(dir, 'app-update.yml');
    await writeFile(config, 'publisherName:\n  - "CN=XOPC Negative Validation, O=XOPC Negative Validation"\nupdaterCacheDirName: isolated-negative\n');
    const adapter = { version: '0.0.1', name: 'xopc-negative-validation', isPackaged: true, appUpdateConfigPath: config,
      userDataPath: dir, baseCachePath: dir, whenReady: () => app.whenReady(), relaunch: () => { installed = true; },
      quit: () => { installed = true; }, onQuit: () => {} };
    const updater = new NsisUpdater(undefined, adapter);
    updater.httpExecutor = new ElectronHttpExecutor();
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false;
    updater.disableDifferentialDownload = true; updater.disableWebInstaller = true;
    const publishers = windowsPublishers(config);
    updater.verifyUpdateCodeSignature = (_names: string[], file: string) => verifyWindowsUpdateSignature(publishers, file);
    updater.logger = null;
    let downloaded = false;
    updater.on('update-downloaded', () => { downloaded = true; });
    updater.on('error', () => {});
    updater.setFeedURL({ provider: 'generic', url: `${feed}/${test}` });
    const available = await updater.checkForUpdates(); assert.equal(available.updateInfo.version, '0.0.416');
    let code: string | undefined;
    try { await updater.downloadUpdate(); } catch (error) { code = (error as any).code; }
    assert.equal(code, test === 'unsigned' ? 'ERR_UPDATER_INVALID_SIGNATURE' : 'ERR_CHECKSUM_MISMATCH');
    assert.equal(downloaded, false); assert.equal(installed, false);
    evidence.cases.push({ test, rejectedWith: code, downloadedEvent: false, installationAttempted: false });
  }
  evidence.passed = true;
} catch (error) {
  evidence.failure = error instanceof Error ? error.message : String(error);
  console.error(evidence.failure);
} finally {
  await writeFile(join(root, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  app.exit(evidence.passed ? 0 : 1);
}
}
void main().catch(error => { console.error(error); app.exit(1); });
