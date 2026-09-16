import { readFileSync, rmSync } from 'node:fs';
import { safeStorage } from 'electron';
import { writeTextAtomicSync } from '../../src/infra/write-file-atomic.js';

/** Local consent only: never load this policy from Gateway config or tool arguments. */
export function readFullControl(path: string): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return safeStorage.decryptString(Buffer.from(readFileSync(path, 'utf8'), 'base64')) === 'xopc-computer-full-control-v1';
  } catch { return false; }
}

export function writeFullControl(path: string, enabled: boolean): void {
  if (!enabled) { rmSync(path, { force: true }); return; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Computer control preferences require the OS keychain');
  // The atomic writer accepts text; base64 preserves encrypted bytes on disk.
  writeTextAtomicSync(path, safeStorage.encryptString('xopc-computer-full-control-v1').toString('base64'), { mode: 0o600 });
}
