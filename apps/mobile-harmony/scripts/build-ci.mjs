import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const tools = process.env.HARMONY_TOOLS_DIR;
if (!tools) throw new Error('HARMONY_TOOLS_DIR must point to command-line-tools 26.0.0.821.');
const output = join(project, '.test/ci');
mkdirSync(output, { recursive: true });
const profile = JSON.parse(readFileSync(join(project, 'build-profile.json5'), 'utf8'));
const product = profile.app.products.find((item) => item.name === 'default');
if (product?.compatibleSdkVersion !== '6.1.0(23)' || product?.targetSdkVersion !== '26.0.0') {
  throw new Error('Expected minimum HarmonyOS 6.1 / API 23 with target API 26. Review compatibility before changing this gate.');
}
if (profile.app.signingConfigs.length) {
  throw new Error('Unsigned CI must not load local signing material.');
}

function run(name, args) {
  console.log(`Running ${name} ${args.join(' ')}`);
  const result = spawnSync(join(tools, 'bin', name), args, { cwd: project, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} failed (${result.status ?? result.signal}).`);
}

const artifacts = [];
function collect(root, extension, mode) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) collect(path, extension, mode);
    else if (entry.isFile() && entry.name.endsWith(`-unsigned${extension}`)) {
      if (extension === '.hap') {
        const result = spawnSync('unzip', ['-p', path, 'module.json'], { encoding: 'utf8' });
        if (result.status !== 0) throw new Error('Cannot inspect built HAP manifest.');
        const manifest = JSON.parse(result.stdout);
        if (manifest.app.minAPIVersion !== 60100023 || manifest.app.targetAPIVersion !== 260000026) {
          throw new Error('Built HAP does not declare the expected API 23 minimum / API 26 target.');
        }
        if (manifest.app.bundleName !== 'ai.xopc.mobile' || manifest.app.apiReleaseType !== 'Release') {
          throw new Error('Unexpected application identity or prerelease SDK requirement.');
        }
      }
      const name = `${mode}-${basename(path)}`;
      if (artifacts.some((artifact) => artifact.name === name)) throw new Error(`Duplicate artifact: ${name}`);
      copyFileSync(path, join(output, name));
      artifacts.push({ name, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
    }
  }
}

for (const mode of ['debug', 'release']) {
  run('hvigorw', ['assembleHap', '--mode', 'module', '-p', 'module=entry@default', '-p', 'product=default',
    '-p', `buildMode=${mode}`, '--no-daemon']);
  const before = artifacts.length;
  collect(join(project, 'entry/build/default/outputs/default'), '.hap', mode);
  if (artifacts.length === before) throw new Error(`No ${mode} HAP produced.`);
}
run('hvigorw', ['assembleApp', '--mode', 'project', '-p', 'product=default', '-p', 'buildMode=release', '--no-daemon']);
const beforeApp = artifacts.length;
collect(join(project, 'build/outputs'), '.app', 'release');
if (artifacts.length === beforeApp) throw new Error('No APP produced.');

const lintReport = join(output, 'code-linter.json');
run('codelinter', ['-c', join(project, 'code-linter.json5'), '-f', 'json', '-e', 'error,warn', '-o', lintReport, project]);
const diagnostics = JSON.parse(readFileSync(lintReport, 'utf8')).flatMap((file) => file.messages ?? []);
if (diagnostics.length) throw new Error(`CodeLinter returned ${diagnostics.length} diagnostics.`);
const app = JSON.parse(readFileSync(join(project, 'AppScope/app.json5'), 'utf8')).app;
writeFileSync(join(output, 'build-info.json'), JSON.stringify({
  commit: process.env.GITHUB_SHA ?? 'local',
  toolchain: '26.0.0.821',
  minimumApi: 23,
  targetApi: 26,
  compatibleSdkVersion: product.compatibleSdkVersion,
  targetSdkVersion: product.targetSdkVersion,
  bundleName: app.bundleName,
  versionName: app.versionName,
  versionCode: app.versionCode,
  signed: false,
  physicalDeviceAcceptance: 'not performed',
  artifacts,
}, null, 2) + '\n');
console.log(`Native build and lint passed; ${artifacts.length} unsigned artifacts written to .test/ci.`);
