import { createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const key = process.env.HARMONY_TEST_ARTIFACT_KEY
  ?? readFileSync(join(project, 'signing/artifact-key'), 'utf8').trim();
if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('A 32-byte hex artifact encryption key is required.');
const encrypted = readFileSync(process.argv[2] ?? join(project, '.test/ci/xopc-test-signed.hap.enc'));
if (encrypted.length <= 36 || encrypted.subarray(0, 8).toString() !== 'XOPCHAP1') {
  throw new Error('Not an encrypted xopc test package.');
}
const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), encrypted.subarray(8, 20));
decipher.setAuthTag(encrypted.subarray(20, 36));
const bytes = Buffer.concat([decipher.update(encrypted.subarray(36)), decipher.final()]);
// Exclusive creation prevents overwriting an existing test package.
const output = join(project, '.test/ci/xopc-test-signed.hap');
writeFileSync(output, bytes, { mode: 0o600, flag: 'wx' });
console.log(`Decrypted test package: ${output}`);
