import { describe, expect, it } from 'vitest';
import pathWin32 from 'node:path/win32';

import {
  NSIS_UNINSTALL_EXE,
  detectLinuxPackageKind,
  detectSeparateCliData,
  resolveAppPath,
  resolveNsisUninstallerPath,
  resolveShowInFolderTarget,
} from '../uninstall/paths.js';

describe('resolveAppPath', () => {
  it('returns .app bundle root on darwin', () => {
    const execPath = '/Applications/xopc.app/Contents/MacOS/xopc';
    expect(resolveAppPath('darwin', execPath)).toBe('/Applications/xopc.app');
  });

  it('returns install directory on win32', () => {
    const execPath = pathWin32.join('C:\\Program Files', 'xopc', 'xopc.exe');
    expect(resolveAppPath('win32', execPath)).toBe(pathWin32.join('C:\\Program Files', 'xopc'));
  });
});

describe('resolveShowInFolderTarget', () => {
  it('highlights the macOS executable inside the bundle', () => {
    const execPath = '/Applications/xopc.app/Contents/MacOS/xopc';
    const appPath = '/Applications/xopc.app';
    expect(resolveShowInFolderTarget('darwin', execPath, appPath)).toBe(
      '/Applications/xopc.app/Contents/MacOS/xopc',
    );
  });

  it('uses execPath on win32', () => {
    const execPath = 'C:\\Program Files\\xopc\\xopc.exe';
    expect(resolveShowInFolderTarget('win32', execPath, 'C:\\Program Files\\xopc')).toBe(execPath);
  });
});

describe('resolveNsisUninstallerPath', () => {
  it('returns primary path when uninstaller exists on win32', () => {
    const execPath = pathWin32.join('C:\\Program Files', 'xopc', 'xopc.exe');
    const expected = pathWin32.join('C:\\Program Files', 'xopc', NSIS_UNINSTALL_EXE);
    const exists = (p: string) => p === expected;
    expect(resolveNsisUninstallerPath(execPath, exists, 'win32')).toBe(expected);
  });

  it('returns null when uninstaller is missing', () => {
    const execPath = pathWin32.join('C:\\Program Files', 'xopc', 'xopc.exe');
    expect(resolveNsisUninstallerPath(execPath, () => false, 'win32')).toBeNull();
  });
});

describe('detectSeparateCliData', () => {
  it('returns false when cli dir does not exist', () => {
    expect(
      detectSeparateCliData('/Users/me/Library/Application Support/xopc', '/Users/me/.xopc', () => false),
    ).toBe(false);
  });

  it('returns false when cli dir is the same as userData', () => {
    const path = '/Users/me/Library/Application Support/xopc';
    expect(
      detectSeparateCliData(path, '/Users/me/.xopc', () => true, () => path),
    ).toBe(false);
  });

  it('returns true when cli dir exists and differs from userData', () => {
    expect(
      detectSeparateCliData(
        '/Users/me/Library/Application Support/xopc',
        '/Users/me/.xopc',
        () => true,
        (p) => p,
      ),
    ).toBe(true);
  });
});

describe('detectLinuxPackageKind', () => {
  it('detects AppImage installs', () => {
    expect(detectLinuxPackageKind('/home/me/Downloads/xopc-1.0.0.AppImage')).toBe('appimage');
    expect(detectLinuxPackageKind('/home/me/xopc.appimage')).toBe('appimage');
  });

  it('detects deb installs under /opt or /usr', () => {
    expect(detectLinuxPackageKind('/opt/xopc/xopc')).toBe('deb');
    expect(detectLinuxPackageKind('/usr/lib/xopc/xopc')).toBe('deb');
  });

  it('returns unknown for other paths', () => {
    expect(detectLinuxPackageKind('/home/me/local/bin/xopc')).toBe('unknown');
  });
});
