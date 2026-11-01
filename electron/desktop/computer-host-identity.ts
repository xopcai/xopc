import { execFile } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Read the installed host identity, including separately signed acceptance copies. Never accept a remote bundle identifier. */
export async function computerHostBundleId(options: { packaged: boolean; resourcesPath: string; platform?: NodeJS.Platform }): Promise<string> {
  if (!options.packaged) return 'com.github.Electron';
  if ((options.platform ?? process.platform) !== 'darwin' || !isAbsolute(options.resourcesPath)) throw new Error('DESKTOP_COMPUTER_UNSUPPORTED');
  try {
    const { stdout } = await exec('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(options.resourcesPath, '..', 'Info.plist')],
      { encoding: 'utf8', timeout: 1000, maxBuffer: 1024 });
    const identity = stdout.trim();
    if (identity.length > 255 || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(identity)) throw new Error('Invalid bundle identity');
    return identity;
  } catch { throw new Error('DESKTOP_COMPUTER_HOST_IDENTITY_UNAVAILABLE'); }
}
