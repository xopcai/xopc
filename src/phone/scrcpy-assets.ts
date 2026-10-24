import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { managedScrcpyServerPath, SCRCPY_SHA256, SCRCPY_VERSION } from '../runtime-tools/phone-dependency-catalog.js';
import { PhoneError } from './contracts.js';

export { SCRCPY_SHA256, SCRCPY_VERSION };
export const scrcpyServerPath = managedScrcpyServerPath;

export async function readScrcpyServer(): Promise<Buffer> {
  const binary = await readFile(scrcpyServerPath()).catch(() => { throw new PhoneError('PHONE_VIDEO_SETUP_REQUIRED', 'Install scrcpy server in Settings → Phone Use → Dependencies'); });
  if (createHash('sha256').update(binary).digest('hex') !== SCRCPY_SHA256) throw new PhoneError('PHONE_VIDEO_HASH_MISMATCH', 'Phone video server checksum mismatch');
  return binary;
}

