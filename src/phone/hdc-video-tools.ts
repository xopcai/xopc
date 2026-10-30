import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { managedHosJar, managedJavaHome } from '../runtime-tools/harmony-paths.js';

import type { PhoneConfig } from './contracts.js';
import { PhoneError } from './contracts.js';
import { resolveHdcPath } from './hdc-driver.js';
import { runPhoneCommandBuffer } from '../process/phone-process.js';
import { HDC_VIDEO_BRIDGE_SOURCE } from './hdc-video-bridge.js';

export type HdcVideoTools = { java: string; javac: string; classpath: string; jar: string };
export function hdcJavaHomes(config: Pick<PhoneConfig, 'hdcVideo' | 'hdcPath'>, stateDir?: string): string[] {
  const inferred = resolveHdcPath(config.hdcPath, stateDir).split(/[\\/]sdk[\\/]/)[0];
  const roots = [config.hdcVideo?.devecoPath, process.env.DEVECO_HOME, inferred,
    '/Applications/DevEco-Studio.app/Contents', 'C:/Program Files/Huawei/DevEco Studio'];
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const pathHomes = (process.env.PATH ?? '').split(delimiter).filter(Boolean).slice(0, 64).flatMap(directory => {
    try { return [dirname(dirname(realpathSync(join(directory, `java${suffix}`))))]; } catch { return []; }
  });
  return [config.hdcVideo?.javaHome, managedJavaHome(stateDir), process.env.JAVA_HOME,
    ...roots.flatMap(candidate => {
      if (!candidate) return [];
      const root = existsSync(join(candidate, 'Contents')) ? join(candidate, 'Contents') : candidate;
      return [join(root, 'jbr', 'Contents', 'Home'), join(root, 'jbr')];
    }), ...pathHomes].filter((home): home is string => Boolean(home));
}

export function resolveHdcJavaHome(config: Pick<PhoneConfig, 'hdcVideo' | 'hdcPath'>, stateDir?: string): string | undefined {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return hdcJavaHomes(config, stateDir).find(home => existsSync(join(home, 'bin', `java${suffix}`)) && existsSync(join(home, 'bin', `javac${suffix}`)));
}

export function resolveHdcVideoTools(config: Pick<PhoneConfig, 'hdcPath' | 'hdcVideo'>, stateDir?: string): HdcVideoTools | undefined {
  const home = resolveHdcJavaHome(config, stateDir);
  if (!home) return undefined;
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const executables = { java: join(home, 'bin', `java${suffix}`), javac: join(home, 'bin', `javac${suffix}`) };
  const standalone = config.hdcVideo?.sdkJar ?? (existsSync(managedHosJar(stateDir)) ? managedHosJar(stateDir) : undefined);
  if (standalone) return existsSync(standalone) ? { ...executables, jar: standalone, classpath: standalone } : undefined;
  const inferred = resolveHdcPath(config.hdcPath, stateDir).split(/[\\/]sdk[\\/]/)[0];
  const roots = [config.hdcVideo?.devecoPath, process.env.DEVECO_HOME, inferred,
    '/Applications/DevEco-Studio.app/Contents', 'C:/Program Files/Huawei/DevEco Studio'];
  for (const candidate of roots) {
    if (!candidate) continue;
    const root = existsSync(join(candidate, 'Contents')) ? join(candidate, 'Contents') : candidate;
    const lib = join(root, 'plugins', 'screen-mirroring', 'lib');
    if (!existsSync(lib)) continue;
    const jar = readdirSync(lib).find(name => /^hosScrcpy-[\w.-]+\.jar$/.test(name));
    if (jar) {
      const sdkJar = join(lib, jar);
      return { ...executables, jar: sdkJar, classpath: [sdkJar, join(root, 'plugins', 'harmony', 'lib', '*'), join(root, 'lib', '*')].join(delimiter) };
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
    throw new PhoneError('PHONE_HDC_VIDEO_DEPENDENCY', `Unable to compile the HarmonyOS video bridge. Check the full JDK 17+ and compatible HOScrcpy library (${dirname(tools.jar)}).`, 502);
  }
}
