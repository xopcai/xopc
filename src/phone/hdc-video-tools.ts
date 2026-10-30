import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import type { PhoneConfig } from './contracts.js';
import { PhoneError } from './contracts.js';
import { resolveHdcPath } from './hdc-driver.js';
import { runPhoneCommandBuffer } from '../process/phone-process.js';
import { HDC_VIDEO_BRIDGE_SOURCE } from './hdc-video-bridge.js';

export type HdcVideoTools = { java: string; javac: string; classpath: string; jar: string };
export function resolveHdcVideoTools(config: Pick<PhoneConfig, 'hdcPath' | 'hdcVideo'>): HdcVideoTools | undefined {
  const inferred = resolveHdcPath(config.hdcPath).split(/[\\/]sdk[\\/]/)[0];
  const roots = [config.hdcVideo?.devecoPath, process.env.DEVECO_HOME, inferred,
    '/Applications/DevEco-Studio.app/Contents', 'C:/Program Files/Huawei/DevEco Studio'];
  for (const candidate of roots) {
    if (!candidate) continue;
    const root = existsSync(join(candidate, 'Contents')) ? join(candidate, 'Contents') : candidate;
    const lib = join(root, 'plugins', 'screen-mirroring', 'lib');
    if (!existsSync(lib) && !config.hdcVideo?.sdkJar) continue;
    const jar = existsSync(lib) && readdirSync(lib).find(name => /^hosScrcpy-[\w.-]+\.jar$/.test(name));
    const sdkJar = config.hdcVideo?.sdkJar ?? (jar ? join(lib, jar) : undefined);
    if (!sdkJar || !existsSync(sdkJar)) continue;
    const homes = [config.hdcVideo?.javaHome, process.env.JAVA_HOME, join(root, 'jbr', 'Contents', 'Home'), join(root, 'jbr')];
    for (const home of homes) {
      if (!home) continue;
      const suffix = process.platform === 'win32' ? '.exe' : '';
      const java = join(home, 'bin', `java${suffix}`); const javac = join(home, 'bin', `javac${suffix}`);
      if (existsSync(java) && existsSync(javac)) return { java, javac, jar: sdkJar, classpath: config.hdcVideo?.sdkJar ? sdkJar : [sdkJar, join(root, 'plugins', 'harmony', 'lib', '*'), join(root, 'lib', '*')].join(delimiter) };
    }
  }
  return undefined;
}

export async function compileHdcVideoBridge(tools: HdcVideoTools, signal: AbortSignal) {
  const directory = await mkdtemp(join(tmpdir(), 'xopc-hdc-video-'));
  try {
    await writeFile(join(directory, 'XopcHdcVideo.java'), HDC_VIDEO_BRIDGE_SOURCE, { mode: 0o600 });
    // Disable vendor annotation processors: only the small bridge is compiled.
    await runPhoneCommandBuffer(tools.javac, ['-proc:none', '--release', '17', '-cp', tools.classpath, '-d', directory, join(directory, 'XopcHdcVideo.java')], signal, 20_000);
    return { program: tools.java, args: ['-cp', `${directory}${delimiter}${tools.classpath}`, 'XopcHdcVideo'],
      cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch {
    await rm(directory, { recursive: true, force: true }); signal.throwIfAborted();
    throw new PhoneError('PHONE_HDC_VIDEO_DEPENDENCY', `Unable to compile the HarmonyOS video bridge. Check the JDK and DevEco Studio installation (${dirname(tools.jar)}).`, 502);
  }
}
