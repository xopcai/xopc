import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import type { AppInfo } from '@trycua/cua-driver';
import type { WindowsComputerIdentity } from './windows-native.js';

export function windowsAppIdentity(app: AppInfo): { appId: string; nativeId: string; launch: Record<string, string>; packaged: boolean } | undefined {
  const aumid = app.launchPath?.match(/^shell:appsFolder\\([a-zA-Z0-9._-]+![a-zA-Z0-9._-]+)$/i)?.[1];
  const executable = app.bundleId;
  if (!aumid && (!executable || !win32.isAbsolute(executable) || !/\.exe$/i.test(executable))) return undefined;
  const nativeId = aumid ?? win32.normalize(executable!);
  return { appId: `win-${createHash('sha256').update(nativeId.toLowerCase()).digest('hex')}`, nativeId,
    launch: aumid ? { aumid } : { path: nativeId }, packaged: Boolean(aumid) };
}

export function windowsAppMatches(app: AppInfo, identity: WindowsComputerIdentity): boolean {
  const expected = windowsAppIdentity(app);
  return !!expected && (expected.packaged ? identity.appIds.length === 1 && identity.appIds[0].toLowerCase() === expected.nativeId.toLowerCase()
    : identity.executable.toLowerCase() === expected.nativeId.toLowerCase());
}

export function assertWindowsAppAllowed(app: AppInfo): void {
  const identity = windowsAppIdentity(app);
  const name = win32.basename(identity?.nativeId ?? app.name).toLowerCase();
  if (app.pid === process.pid || (!identity?.packaged && identity?.nativeId.toLowerCase() === process.execPath.toLowerCase())) {
    throw new Error('COMPUTER_SELF_CONTROL_DENIED');
  }
  if (!identity || /password|1password|bitwarden|keepass|keypass/i.test(`${identity.nativeId} ${app.name}`)
    || /^(cmd|powershell|pwsh|wt|windowsterminal|conhost|regedit|mmc|control|systemsettings|xopc|electron)\.exe$/i.test(name)
    || /^(Microsoft\.WindowsTerminal|windows\.immersivecontrolpanel|Microsoft\.Windows\.SecHealthUI)_/i.test(identity.nativeId)) {
    throw new Error('COMPUTER_SENSITIVE_APP_MANUAL_ONLY');
  }
}
