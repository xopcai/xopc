export type UninstallMode = 'manual' | 'native-uninstaller' | 'unsupported';

export type LinuxPackageKind = 'appimage' | 'deb' | 'unknown';

export type UninstallErrorCode =
  | 'PENDING_UPDATE'
  | 'NOT_PACKAGED'
  | 'UNINSTALLER_NOT_FOUND'
  | 'PLATFORM_UNSUPPORTED';

export type UninstallInfo = {
  packaged: boolean;
  platform: 'darwin' | 'win32' | 'linux';
  uninstallMode: UninstallMode;
  appPath: string;
  userDataPath: string;
  userDataSizeBytes: number | null;
  hasSeparateCliData: boolean;
  cliDataPath: string | null;
  uninstallerPath: string | null;
  pendingUpdate: boolean;
  linuxPackageKind?: LinuxPackageKind;
  /** Best-effort `.deb` package name for UI hints (Linux only). */
  linuxDebPackageName?: string;
};

export type UninstallAppResult =
  | {
      ok: true;
      mode: 'manual' | 'native-uninstaller';
      linuxPackageKind?: LinuxPackageKind;
      debPackageName?: string;
    }
  | { ok: false; error: UninstallErrorCode };

export type ClearUserDataResult = { ok: true } | { ok: false; error: UninstallErrorCode };
