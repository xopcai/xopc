import { chmod, copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';

import type { RuntimeToolsConfig } from '../config/schema.js';
import { downloadVerifiedArchive, sha256File } from './downloader.js';
import { RuntimeError } from './errors.js';
import { HDC_DISTRIBUTION } from './hdc-dependency-catalog.js';
import type { PhoneDependencyAsset, PhoneDependencyFile } from './phone-dependency-catalog.js';
import type { PhoneDependencyProgress } from './phone-dependencies.js';
import { runtimeDownloadPath } from './paths.js';

async function verifyFile(path: string, file: PhoneDependencyFile): Promise<void> {
  const info = await stat(path);
  if (!info.isFile() || info.size !== file.sizeBytes || await sha256File(path) !== file.sha256)
    throw new RuntimeError(`HDC file checksum mismatch: ${file.targetName}`, 'RUNTIME_CHECKSUM_MISMATCH', 'hdc', 'verify', true);
}

function hdcFiles(asset: PhoneDependencyAsset): readonly PhoneDependencyFile[] {
  if (asset.files?.length !== 2 || asset.archive) throw new Error('A pinned standalone HDC file catalog is required');
  for (const file of asset.files) if (basename(file.targetName) !== file.targetName || file.targetName === '.' || file.targetName === '..' || file.targetName.includes('\\')) throw new Error('Invalid HDC target name');
  return asset.files;
}

export async function verifyHdcFiles(root: string, asset: PhoneDependencyAsset): Promise<void> {
  for (const file of hdcFiles(asset)) await verifyFile(join(root, file.targetName), file);
}

/** Fetch only the host executable and USB library; never download npm packages or SDK archives. */
export async function stageHdcFiles(params: {
  asset: PhoneDependencyAsset; stateDir: string; config: RuntimeToolsConfig; root: string;
  signal?: AbortSignal; check: () => void; progress: (event: PhoneDependencyProgress) => void;
}): Promise<string> {
  const files = hdcFiles(params.asset);
  const bundle = params.config.download.bundleDir;
  if (bundle && !isAbsolute(bundle)) throw new Error('Offline bundle directory must be an absolute path on the Gateway host');
  if (!bundle && params.config.download.source === 'website-only') throw new Error('Select Auto or Direct downloads, or configure an offline bundle directory');
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  let completedBytes = 0;
  await mkdir(params.root, { recursive: true });
  for (const file of files) {
    params.check();
    let source: string | undefined;
    if (bundle) source = join(bundle, file.filename);
    else {
      params.progress({ kind: 'hdc', phase: 'download', downloadedBytes: completedBytes, totalBytes });
      for (const url of [file.url, ...(file.fallbackUrls ?? [])]) {
        params.check();
        try {
          source = await downloadVerifiedArchive({ runtime: 'hdc', url, expectedSha256: file.sha256,
            targetPath: runtimeDownloadPath(params.stateDir, file.filename), expectedBytes: file.sizeBytes, timeoutMs: params.config.download.timeoutMs,
            proxy: params.config.download.proxy, signal: params.signal,
            onProgress: downloadedBytes => params.progress({ kind: 'hdc', phase: 'download', downloadedBytes: completedBytes + downloadedBytes, totalBytes }) });
          break;
        } catch (error) {
          params.check();
          if (!(error instanceof RuntimeError) || error.code !== 'RUNTIME_DOWNLOAD_FAILED' || url === file.fallbackUrls?.at(-1) || !file.fallbackUrls?.length) throw error;
        }
      }
    }
    if (!source) throw new Error('No standalone HDC file source is available');
    params.check();
    params.progress({ kind: 'hdc', phase: 'verify' });
    await verifyFile(source, file);
    const target = join(params.root, file.targetName);
    await copyFile(source, target);
    if (process.platform !== 'win32') await chmod(target, 0o755);
    completedBytes += file.sizeBytes;
  }
  await writeFile(join(params.root, 'source.json'), JSON.stringify({ distribution: HDC_DISTRIBUTION, version: params.asset.version, files }, null, 2) + '\n', { mode: 0o600 });
  params.check();
  return params.root;
}
