import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { resolveCredentialsDir } from '../config/paths.js';
import { writeTextAtomic } from '../infra/write-file-atomic.js';

export const GITHUB_TOKEN_VAULT_KEY_ENV = 'XOPC_CREDENTIALS_MASTER_KEY';

export type GitHubAppToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshTokenExpiresAt: number;
  tokenType: string;
  scope: string[];
  createdAt: string;
  updatedAt: string;
};

type EncryptedTokenRecord = {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
};

export type GitHubTokenVaultOptions = {
  stateDir?: string;
  masterKey?: string;
};

function tokenPath(stateDir?: string): string {
  const credentialsDir = stateDir ? join(stateDir, 'credentials') : resolveCredentialsDir();
  return join(credentialsDir, 'github-app-token.enc.json');
}

function decodeMasterKey(value: string | undefined): Buffer {
  const raw = value?.trim() ?? '';
  if (!raw) {
    throw new Error(
      `${GITHUB_TOKEN_VAULT_KEY_ENV} is required to store GitHub credentials. ` +
        'Electron configures it automatically; remote Gateway installations must provide a 32-byte base64 key.',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== raw.replace(/=+$/, '')) {
    throw new Error(`${GITHUB_TOKEN_VAULT_KEY_ENV} must be a base64-encoded 32-byte key.`);
  }
  return key;
}

export class GitHubTokenVault {
  private readonly path: string;
  private readonly masterKey: string | undefined;

  constructor(options: GitHubTokenVaultOptions = {}) {
    this.path = tokenPath(options.stateDir);
    this.masterKey = options.masterKey;
  }

  private key(): Buffer {
    return decodeMasterKey(this.masterKey ?? process.env[GITHUB_TOKEN_VAULT_KEY_ENV]);
  }

  assertAvailable(): void {
    this.key();
  }

  async load(): Promise<GitHubAppToken | null> {
    let record: EncryptedTokenRecord;
    try {
      record = JSON.parse(await readFile(this.path, 'utf8')) as EncryptedTokenRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('GitHub credential vault could not be read.', { cause: error });
    }
    if (record.version !== 1 || record.algorithm !== 'aes-256-gcm') {
      throw new Error('Unsupported GitHub credential vault format.');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(record.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(plaintext) as GitHubAppToken;
    } catch (error) {
      throw new Error('GitHub credential vault could not be decrypted.', { cause: error });
    }
  }

  async save(token: GitHubAppToken): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(token), 'utf8'),
      cipher.final(),
    ]);
    const record: EncryptedTokenRecord = {
      version: 1,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    await mkdir(dirname(this.path), { recursive: true });
    await writeTextAtomic(this.path, JSON.stringify(record, null, 2));
    await chmod(this.path, 0o600).catch(() => {});
  }

  async delete(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

export function generateCredentialsMasterKey(): string {
  return randomBytes(32).toString('base64');
}
