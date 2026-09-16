import { spawnSync } from 'node:child_process';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const tools = process.env.HARMONY_TOOLS_DIR;
if (!tools) throw new Error('HARMONY_TOOLS_DIR is required.');
const artifactKey = process.env.HARMONY_TEST_ARTIFACT_KEY;
if (!/^[a-f0-9]{64}$/i.test(artifactKey ?? '')) throw new Error('A 32-byte hex artifact encryption key is required.');
const temp = mkdtempSync(join(tmpdir(), 'xopc-harmony-test-sign-'));

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  // Tool errors can echo command arguments; never forward their raw output.
  if (result.error || result.status !== 0) throw new Error(`${label} failed; signer output withheld to protect credentials.`);
  return result.stdout;
}

try {
  const material = {
    keyAlias: process.env.HARMONY_TEST_KEY_ALIAS,
    storePassword: process.env.HARMONY_TEST_STORE_PASSWORD,
    keyPassword: process.env.HARMONY_TEST_KEY_PASSWORD,
  };
  for (const [field, variable, file] of [
    ['storeFile', 'HARMONY_TEST_KEYSTORE_BASE64', 'test.p12'],
    ['profile', 'HARMONY_TEST_PROFILE_BASE64', 'test.p7b'],
    ['certpath', 'HARMONY_TEST_CERT_BASE64', 'test.cer'],
  ]) {
    if (!process.env[variable]) throw new Error(`Missing ${variable}.`);
    material[field] = join(temp, file);
    writeFileSync(material[field], Buffer.from(process.env[variable], 'base64'), { mode: 0o600 });
  }
  for (const field of ['keyAlias', 'storePassword', 'keyPassword']) {
    if (!material[field]) throw new Error(`Missing signing field ${field}.`);
  }
  const provision = JSON.parse(run('openssl', ['cms', '-verify', '-noverify', '-inform', 'DER', '-in', material.profile], 'Profile inspection'));
  if (provision.type !== 'debug' || provision['bundle-info']?.['bundle-name'] !== 'ai.xopc.mobile') {
    throw new Error('Only ai.xopc.mobile debug profiles are permitted by this testing workflow.');
  }
  const now = Math.floor(Date.now() / 1000);
  if (provision.validity['not-before'] > now || provision.validity['not-after'] <= now) throw new Error('Profile is not currently valid.');
  const input = join(project, '.test/ci/debug-entry-default-unsigned.hap');
  const manifest = JSON.parse(run('unzip', ['-p', input, 'module.json'], 'HAP inspection'));
  if (manifest.app.bundleName !== 'ai.xopc.mobile' || manifest.app.minAPIVersion !== 60100023 || !manifest.app.debug) {
    throw new Error('Expected an API 23-compatible xopc debug HAP.');
  }
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/java') : 'java';
  const jar = join(tools, 'sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar');
  const signed = join(temp, 'xopc-test-signed.hap');
  run(java, ['-jar', jar, 'sign-app', '-mode', 'localSign', '-keyAlias', material.keyAlias,
    '-keyPwd', material.keyPassword, '-keystorePwd', material.storePassword, '-keystoreFile', material.storeFile,
    '-appCertFile', material.certpath, '-profileFile', material.profile, '-signAlg', 'SHA256withECDSA',
    '-inFile', input, '-outFile', signed, '-compatibleVersion', '23'], 'HAP signing');
  run(java, ['-jar', jar, 'verify-app', '-inFile', signed, '-outCertChain', join(temp, 'verified.cer'),
    '-outProfile', join(temp, 'verified.p7b')], 'HAP signature verification');
  const bytes = readFileSync(signed);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(artifactKey, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const encrypted = Buffer.concat([Buffer.from('XOPCHAP1'), iv, cipher.getAuthTag(), ciphertext]);
  writeFileSync(join(project, '.test/ci/xopc-test-signed.hap.enc'), encrypted, { mode: 0o600 });
  writeFileSync(join(project, '.test/ci/signed-build-info.json'), JSON.stringify({
    commit: process.env.GITHUB_SHA ?? 'local', bundleName: 'ai.xopc.mobile', minimumApi: 23,
    signatureVerified: true, profileType: 'debug', profileExpiresAt: provision.validity['not-after'],
    artifact: 'xopc-test-signed.hap.enc', encryption: 'AES-256-GCM (XOPCHAP1 + IV12 + tag16 + ciphertext)',
    sha256: createHash('sha256').update(encrypted).digest('hex'),
    installation: 'Restricted to devices permitted by the profile; physical-device acceptance pending.',
  }, null, 2) + '\n');
  console.log('Debug HAP signed, signature verified and artifact encrypted. No plaintext signed package is uploaded.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
