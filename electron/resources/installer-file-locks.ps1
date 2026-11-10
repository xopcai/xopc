# Resolve inaccessible process paths by the files actually locked in this installation.
function Get-XopcLockingProcessIds([string[]]$Files) {
  $existing = @($Files | Where-Object { [IO.File]::Exists($_) })
  if ($existing.Count -eq 0) { return @() }
  if (-not ('XopcInstaller.RestartManager' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
namespace XopcInstaller {
  public static class RestartManager {
    [StructLayout(LayoutKind.Sequential)] struct UniqueProcess { public uint Id; public System.Runtime.InteropServices.ComTypes.FILETIME Start; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct ProcessInfo {
      public UniqueProcess Process;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string Name;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string Service;
      public uint Type, Status, Session;
      [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
    }
    [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint handle, uint flags, StringBuilder key);
    [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint handle, uint count, string[] files, uint apps, IntPtr processes, uint services, string[] names);
    [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint handle, out uint needed, ref uint count, [In,Out] ProcessInfo[] infos, ref uint reasons);
    [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint handle);
    public static int[] Find(string[] files) {
      uint handle;
      int status = RmStartSession(out handle, 0, new StringBuilder(Guid.NewGuid().ToString("N"), 33));
      if (status != 0) throw new IOException("RmStartSession: " + status);
      try {
        status = RmRegisterResources(handle, (uint)files.Length, files, 0, IntPtr.Zero, 0, null);
        if (status != 0) throw new IOException("RmRegisterResources: " + status);
        uint count=0, needed=0, reasons=0;
        for (int attempt=0; attempt<3; attempt++) {
          var infos = new ProcessInfo[count];
          status = RmGetList(handle, out needed, ref count, infos, ref reasons);
          if (status == 234) { count=needed; continue; }
          if (status != 0) throw new IOException("RmGetList: " + status);
          var result=new int[count];
          for (int i=0; i<count; i++) result[i]=(int)infos[i].Process.Id;
          return result;
        }
        throw new IOException("File lock owners kept changing; retry installation.");
      } finally { RmEndSession(handle); }
    }
  }
}
'@
  }
  return [XopcInstaller.RestartManager]::Find($existing)
}
