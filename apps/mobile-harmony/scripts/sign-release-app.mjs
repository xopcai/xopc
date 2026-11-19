import { spawnSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const bundleName = 'ai.xopc.xopc';
const unsignedHap = 'release-entry-default-unsigned.hap';
const unsignedApp = 'release-mobile-harmony-default-unsigned.app';

function run(command, args, label, cwd) {
  const env = { ...process.env };
  delete env.HARMONY_RELEASE_SIGNING_JSON;
  const result = spawnSync(command, args, { cwd, env, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0 || result.error) {
    throw new Error(`${label} failed (${result.status ?? result.error?.code ?? result.signal}).`);
  }
  return result.stdout;
}

function readMaterial(temp) {
  let material;
  try {
    material = JSON.parse(process.env.HARMONY_RELEASE_SIGNING_JSON ?? 'null');
  } catch {
    throw new Error('Invalid HARMONY_RELEASE_SIGNING_JSON.');
  }
  for (const field of ['keyAlias', 'storePassword', 'keyPassword', 'keystore', 'certificate', 'profile']) {
    if (typeof material?.[field] !== 'string' || !material[field]) throw new Error(`Missing release signing field: ${field}.`);
  }
  const files = {};
  for (const [field, name] of [['keystore', 'release.p12'], ['certificate', 'release.cer'], ['profile', 'release.p7b']]) {
    files[field] = join(temp, name);
    writeFileSync(files[field], Buffer.from(material[field], 'base64'), { mode: 0o600 });
  }
  const json = run('openssl', ['cms', '-verify', '-noverify', '-inform', 'DER', '-in', files.profile], 'Read signing profile');
  const provision = JSON.parse(json);
  const bundle = provision['bundle-info'];
  const now = Math.floor(Date.now() / 1000);
  if (provision.type !== 'release' || bundle?.['bundle-name'] !== bundleName ||
    !(provision.validity?.['not-before'] <= now && now < provision.validity?.['not-after'])) {
    throw new Error(`Expected a valid release profile for ${bundleName}.`);
  }
  const certFile = readFileSync(files.certificate);
  const chain = certFile.toString('utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [certFile];
  const fingerprint = new X509Certificate(bundle['distribution-certificate']).fingerprint256;
  if (!chain.some((cert) => new X509Certificate(cert).fingerprint256 === fingerprint)) {
    throw new Error('Release certificate does not match the signing profile.');
  }
  return { ...files, keyAlias: material.keyAlias, storePassword: material.storePassword, keyPassword: material.keyPassword };
}

function signApp(buildDir, destination) {
  const tools = process.env.HARMONY_TOOLS_DIR;
  if (!tools) throw new Error('HARMONY_TOOLS_DIR is required.');
  const recorded = JSON.parse(readFileSync(join(buildDir, 'build-info.json'), 'utf8'));
  if (recorded.bundleName !== bundleName || recorded.minimumApi !== 23 || recorded.targetApi !== 26 ||
    recorded.signed !== false || (process.env.GITHUB_SHA && recorded.commit !== process.env.GITHUB_SHA)) {
    throw new Error('Unexpected release build metadata.');
  }
  for (const name of [unsignedApp, unsignedHap]) {
    const sha = createHash('sha256').update(readFileSync(join(buildDir, name))).digest('hex');
    if (sha !== recorded.artifacts?.find((artifact) => artifact.name === name)?.sha256) {
      throw new Error(`Build checksum mismatch: ${name}.`);
    }
  }
  const hap = join(buildDir, unsignedHap);
  const app = join(buildDir, unsignedApp);
  const manifest = JSON.parse(run('unzip', ['-p', hap, 'module.json'], 'Read HAP manifest')).app;
  const pack = JSON.parse(run('unzip', ['-p', app, 'pack.info'], 'Read APP manifest'));
  const packedApp = pack.summary?.app;
  if (manifest.bundleName !== bundleName || manifest.debug !== false || manifest.minAPIVersion !== 60100023 ||
    manifest.targetAPIVersion !== 260000026 || manifest.apiReleaseType !== 'Release' ||
    manifest.versionName !== recorded.versionName || manifest.versionCode !== recorded.versionCode ||
    packedApp?.bundleName !== bundleName || packedApp.version?.name !== recorded.versionName ||
    packedApp.version?.code !== recorded.versionCode || pack.packages?.length !== 1 ||
    pack.packages[0].name !== 'entry-default') {
    throw new Error('Expected matching xopc release manifests with exactly one entry HAP.');
  }
  const temp = mkdtempSync(join(tmpdir(), 'xopc-harmony-release-sign-'));
  try {
    const material = readMaterial(temp);
    const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/java') : 'java';
    const jar = join(tools, 'sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar');
    const signer = (args, label) => run(java, ['-jar', jar, ...args], label, temp);
    const signArgs = ['-mode', 'localSign', '-keyAlias', material.keyAlias, '-keyPwd', material.keyPassword,
      '-keystorePwd', material.storePassword, '-keystoreFile', material.keystore, '-appCertFile', material.certificate,
      '-profileFile', material.profile, '-signAlg', 'SHA256withECDSA'];
    const verify = (path, format, label) => {
      const extracted = join(temp, 'verified.p7b');
      rmSync(extracted, { force: true });
      signer(['verify-app', '-inFile', path, ...format, '-outCertChain', join(temp, 'verified.cer'),
        '-outProfile', extracted], label);
      if (!readFileSync(extracted).equals(readFileSync(material.profile))) {
        throw new Error(`${label} returned a different signing profile.`);
      }
    };
    const signedHap = join(temp, 'entry-default.hap');
    signer(['sign-app', ...signArgs, '-inFile', hap, '-outFile', signedHap, '-compatibleVersion', '23'], 'Sign release HAP');
    verify(signedHap, [], 'Verify release HAP');
    for (const name of ['pac.json', 'pack.info']) {
      writeFileSync(join(temp, name), run('unzip', ['-p', app, name], `Read ${name}`));
    }
    const packed = join(temp, 'release-unsigned.app');
    run('zip', ['-X', '-q', packed, 'pac.json', 'pack.info', 'entry-default.hap'], 'Repack APP', temp);
    const signedApp = join(temp, 'release-signed.app');
    const zipFormat = ['-inForm', 'zip'];
    signer(['sign-app', ...signArgs, '-inFile', packed, ...zipFormat, '-outFile', signedApp], 'Sign release APP');
    verify(signedApp, zipFormat, 'Verify release APP');
    writeFileSync(destination, readFileSync(signedApp), { mode: 0o600, flag: 'wx' });
    console.log(`Verified xopc ${recorded.versionName} (${recorded.versionCode}) HAP and APP release signatures.`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

try {
  const [input, output] = process.argv.slice(2);
  if (!input || !output?.endsWith('.app')) throw new Error('Usage: sign-release-app.mjs BUILD_DIR OUTPUT.app');
  signApp(resolve(input), resolve(output));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
