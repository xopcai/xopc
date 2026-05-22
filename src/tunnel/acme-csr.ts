import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Generate EC P-256 CSR + private key PEM via openssl (no extra npm deps). */
export function generateDomainCsr(domain: string): { csrDer: Buffer; keyPem: string } {
  const workDir = mkdtempSync(join(tmpdir(), 'xopc-acme-csr-'));
  const keyPath = join(workDir, 'domain.key.pem');
  const csrPath = join(workDir, 'domain.csr.pem');
  try {
    // Two-step CSR: avoid OpenSSL `-newkey ec` embedding explicit EC parameters (LE rejects those).
    execFileSync(
      'openssl',
      ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', keyPath],
      { stdio: 'ignore' },
    );
    execFileSync(
      'openssl',
      ['req', '-new', '-key', keyPath, '-out', csrPath, '-subj', `/CN=${domain}`],
      { stdio: 'ignore' },
    );
    const keyPem = readFileSync(keyPath, 'utf8');
    const csrPem = readFileSync(csrPath, 'utf8');
    const match = csrPem.match(/-----BEGIN CERTIFICATE REQUEST-----[\s\S]+?-----END CERTIFICATE REQUEST-----/);
    if (!match) throw new Error('Failed to parse CSR PEM');
    const der = Buffer.from(
      match[0].replace(/-----(BEGIN|END) CERTIFICATE REQUEST-----/g, '').replace(/\s+/g, ''),
      'base64',
    );
    return { csrDer: der, keyPem };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
