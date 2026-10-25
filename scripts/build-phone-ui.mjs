import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';

// Rebuild the embedded device helper with the Android SDK; the Gateway needs no Java installation.
const sdk = process.argv[2] ?? process.env.ANDROID_HOME;
if (!sdk) throw new Error('Pass Android SDK directory as the first argument');
const work = await mkdtemp(join(tmpdir(), 'xopc-phone-ui-'));
try {
  const android = join(sdk, 'platforms', 'android-36', 'android.jar');
  execFileSync('javac', ['-source', '8', '-target', '8', '-classpath', android, '-d', work, resolve('scripts/phone-ui/PhoneUiDump.java')], { stdio: 'inherit' });
  execFileSync('java', ['-cp', join(sdk, 'build-tools', '36.0.0', 'lib', 'd8.jar'), 'com.android.tools.r8.D8', '--min-api', '24', '--lib', android, '--output', work, join(work, 'ai/xopc/phone/PhoneUiDump.class')], { stdio: 'inherit' });
  const dex = await readFile(join(work, 'classes.dex'));
  await writeFile('src/phone/ui-dump-binary.ts', `// Generated from scripts/phone-ui/PhoneUiDump.java by scripts/build-phone-ui.mjs.\nexport const PHONE_UI_DEX = '${dex.toString('base64')}';\n`);
} finally {
  const child = relative(tmpdir(), work);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected build directory');
  await rm(work, { recursive: true, force: true });
}
