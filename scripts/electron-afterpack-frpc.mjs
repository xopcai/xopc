#!/usr/bin/env node
/**
 * electron-builder afterPack: copy platform-specific frpc into resources/bin/.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  const { electronPlatformName, arch } = context;
  const archName = { 1: 'amd64', 3: 'arm64' }[arch] ?? 'amd64';
  const platformMap = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
  const frpPlatform = platformMap[electronPlatformName] ?? electronPlatformName;
  const ext = electronPlatformName === 'win32' ? '.exe' : '';

  const src = join('electron', 'resources', 'frpc', `${frpPlatform}_${archName}`, `frpc${ext}`);
  if (!existsSync(src)) {
    console.warn(
      `[afterPack] frpc binary missing at ${src} — run: node scripts/download-frpc-binaries.mjs --platform ${frpPlatform} --arch ${archName}`,
    );
    return;
  }

  const destDir = join(context.appOutDir, 'resources', 'bin');
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, `frpc${ext}`);
  copyFileSync(src, dest);
  console.log(`[afterPack] copied frpc → ${dest}`);
}
