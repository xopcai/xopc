import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Restart Manager enumerates file owners without stopping or restarting them.
// https://learn.microsoft.com/windows/win32/api/restartmanager/nf-restartmanager-rmgetlist
const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Text;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class XopcDatabaseOwners {
  [StructLayout(LayoutKind.Sequential)]
  public struct ProcessIdentity { public uint Id; public FILETIME StartedAt; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct ProcessInfo {
    public ProcessIdentity Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Application;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string Service;
    public uint Type;
    public uint Status;
    public uint TerminalSession;
    [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmStartSession(out uint handle, uint flags, StringBuilder key);
  [DllImport("rstrtmgr.dll")]
  static extern int RmEndSession(uint handle);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmRegisterResources(uint handle, uint files,
    [MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.LPWStr)] string[] paths,
    uint applications, IntPtr processes, uint services, IntPtr names);
  [DllImport("rstrtmgr.dll")]
  static extern int RmGetList(uint handle, out uint needed, ref uint count,
    [In, Out] ProcessInfo[] processes, ref uint reasons);
  static void Check(int result) { if (result != 0) throw new Win32Exception(result); }
  public static uint[] Read(string[] paths) {
    uint handle;
    Check(RmStartSession(out handle, 0, new StringBuilder(33)));
    try {
      Check(RmRegisterResources(handle, (uint)paths.Length, paths, 0, IntPtr.Zero, 0, IntPtr.Zero));
      uint needed = 0, count = 0, reasons = 0;
      ProcessInfo[] processes = null;
      for (int attempt = 0; attempt < 5; attempt++) {
        int result = RmGetList(handle, out needed, ref count, processes, ref reasons);
        if (result == 234) { count = needed; processes = new ProcessInfo[count]; continue; }
        Check(result);
        var ids = new uint[count];
        for (int i = 0; i < count; i++) ids[i] = processes[i].Process.Id;
        return ids;
      }
      throw new InvalidOperationException("Database owners kept changing during upgrade.");
    } finally { RmEndSession(handle); }
  }
}
'@
[XopcDatabaseOwners]::Read([string[]](ConvertFrom-Json $env:XOPC_CUTOVER_DATABASE_FILES)) | ForEach-Object { $_ }
`;

export function windowsDatabaseOwners(databasePath: string): string[] {
  const paths = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].filter(existsSync).map(path => resolve(path));
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 30_000, windowsHide: true,
    env: { ...process.env, XOPC_CUTOVER_DATABASE_FILES: JSON.stringify(paths) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output.trim().split(/\s+/).filter(pid => pid && pid !== String(process.pid));
}
