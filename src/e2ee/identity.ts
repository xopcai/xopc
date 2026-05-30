import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  exportIdentityKeyPair,
  fingerprintPublicKey,
  generateX25519KeyPair,
  loadIdentityKeyPair,
  type ExportedIdentity,
  type X25519KeyPair,
} from '@xopcai/xopc-e2ee';

import { resolveStateDir } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('E2EEIdentity');

const IDENTITY_PATH = join(resolveStateDir(), 'e2ee', 'identity.json');

let cached: X25519KeyPair | null = null;

function readIdentityFile(): ExportedIdentity | null {
  try {
    const raw = readFileSync(IDENTITY_PATH, 'utf8');
    return JSON.parse(raw) as ExportedIdentity;
  } catch {
    return null;
  }
}

async function writeIdentityFile(identity: ExportedIdentity): Promise<void> {
  mkdirSync(join(resolveStateDir(), 'e2ee'), { recursive: true });
  writeFileSync(IDENTITY_PATH, JSON.stringify(identity, null, 2), { mode: 0o600 });
}

export async function getGatewayE2eeIdentity(): Promise<X25519KeyPair> {
  if (cached) return cached;
  const existing = readIdentityFile();
  if (existing) {
    cached = await loadIdentityKeyPair(existing);
    return cached;
  }
  const pair = await generateX25519KeyPair();
  await writeIdentityFile(await exportIdentityKeyPair(pair));
  log.info({ fingerprint: fingerprintPublicKey(pair.publicKey) }, 'Generated gateway E2EE identity');
  cached = pair;
  return pair;
}

export async function getGatewayE2eePublicMeta(): Promise<{ publicKey: string; fingerprint: string }> {
  const identity = await getGatewayE2eeIdentity();
  return {
    publicKey: Buffer.from(identity.publicKey).toString('base64url'),
    fingerprint: fingerprintPublicKey(identity.publicKey),
  };
}
