import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { app, safeStorage } from 'electron';

const MASTER_KEY_FILE = 'credentials-master-key.enc';

export function getOrCreateCredentialsMasterKey(): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) {
    return undefined;
  }
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    return undefined;
  }
  const path = join(app.getPath('userData'), MASTER_KEY_FILE);
  if (existsSync(path)) {
    return safeStorage.decryptString(readFileSync(path));
  }
  const masterKey = randomBytes(32).toString('base64');
  const encrypted = safeStorage.encryptString(masterKey);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encrypted, { mode: 0o600 });
  chmodSync(path, 0o600);
  return masterKey;
}
