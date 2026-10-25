import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { windowsPublishers, windowsSignatureFailure } from '../windows-signature.js';

const publisher = 'CN=Fixture, O=Fixture Ltd';
const valid = { status: 'Valid', subject: publisher, issuer: 'Fixture CA', thumbprint: 'fixture', codeSigning: true, timestamped: true };
it('requires trust, exact publisher, code-signing EKU and timestamp', () => {
  expect(windowsSignatureFailure(valid, [publisher])).toBeNull();
  for (const patch of [{ status: 'NotSigned' }, { status: 'HashMismatch' }, { timestamped: false }, { codeSigning: false }, { subject: 'CN=Other' }, { issuer: 'Apple CA' }]) {
    expect(windowsSignatureFailure({ ...valid, ...patch }, [publisher])).not.toBeNull();
  }
  expect(windowsSignatureFailure(valid, [])).not.toBeNull();
});
it('rejects missing or malformed publisher metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'xopc-windows-publisher-'));
  try {
    const path = join(root, 'app-update.yml');
    for (const yaml of ['provider: generic', 'publisherName: []', 'publisherName: Fixture', 'publisherName: "CN=Developer ID Application"']) {
      writeFileSync(path, yaml); expect(() => windowsPublishers(path)).toThrow();
    }
    writeFileSync(path, `publisherName:\n  - "${publisher}"`);
    expect(windowsPublishers(path)).toEqual([publisher]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
