/** Real signed-update download probe; installation is deliberately outside this tool. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { verifyWindowsUpdateSignature, readWindowsSignature, windowsPublishers } from '../electron/windows-signature.js';

async function main() {
  const root = process.env.XOPC_UPDATE_TEST_ROOT!, feed = process.env.XOPC_UPDATE_TEST_FEED!;
  const current = process.env.XOPC_UPDATE_TEST_CURRENT!, expected = process.env.XOPC_UPDATE_TEST_EXPECTED!;
  const publisher = process.env.XOPC_UPDATE_TEST_PUBLISHER!;
  await mkdir(join(root, 'electron'), { recursive: true }); app.setPath('userData', join(root, 'electron'));
  await app.whenReady();
  const requireRuntime = createRequire(import.meta.url);
  const { NsisUpdater } = requireRuntime('electron-updater');
  const { ElectronHttpExecutor } = requireRuntime('electron-updater/out/electronHttpExecutor');
  const config = join(root, 'app-update.yml');
  await writeFile(config, `publisherName: ${JSON.stringify([publisher])}\nupdaterCacheDirName: isolated-signed-validation\n`);
  let installationAttempted = false, downloadedEvent = false;
  const adapter = { version: current, name: 'xopc-signed-update-validation', isPackaged: true, appUpdateConfigPath: config,
    userDataPath: root, baseCachePath: root, whenReady: () => app.whenReady(), relaunch: () => { installationAttempted = true; },
    quit: () => { installationAttempted = true; }, onQuit: () => {} };
  const evidence: any = { passed: false, scope: 'real HTTPS metadata/download/checksum/Authenticode; no installation', current, expected };
  try {
    const updater = new NsisUpdater(undefined, adapter); updater.httpExecutor = new ElectronHttpExecutor();
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.disableDifferentialDownload = true; updater.disableWebInstaller = true;
    updater.logger = null; updater.on('error', () => {});
    updater.on('update-downloaded', () => { downloadedEvent = true; });
    const publishers = windowsPublishers(config);
    updater.verifyUpdateCodeSignature = (_names: string[], file: string) => verifyWindowsUpdateSignature(publishers, file);
    updater.setFeedURL({ provider: 'generic', url: feed });
    const available = await updater.checkForUpdates(); assert.equal(available?.updateInfo.version, expected);
    const files: string[] = await updater.downloadUpdate(); assert.equal(files.length, 1);
    assert.equal(downloadedEvent, true); assert.equal(installationAttempted, false);
    evidence.signature = await readWindowsSignature(files[0]);
    evidence.sha256 = createHash('sha256').update(await readFile(files[0])).digest('hex');
    evidence.downloadedEvent = true; evidence.installationAttempted = false; evidence.passed = true;
  } catch (error) { evidence.failureCode = (error as any).code ?? 'VALIDATION_FAILED'; console.error(evidence.failureCode); }
  finally { await writeFile(join(root, 'result.json'), JSON.stringify(evidence, null, 2) + '\n'); app.exit(evidence.passed ? 0 : 1); }
}
void main().catch(error => { console.error(error.message); app.exit(1); });
