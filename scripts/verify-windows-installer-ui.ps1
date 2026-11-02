param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
# NSIS uses native Win32 controls; inspect their actual HWNDs rather than optional UIA patterns.
Add-Type @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public static class XopcInstallerControl {
  delegate bool WindowVisitor(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(WindowVisitor callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, WindowVisitor callback, IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)] static extern IntPtr SendText(IntPtr hwnd, uint msg, IntPtr count, StringBuilder text);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  public static IntPtr[] Windows() { var result=new List<IntPtr>(); EnumWindows((h,d)=>{result.Add(h); return true;},IntPtr.Zero); return result.ToArray(); }
  public static IntPtr[] Children(IntPtr parent) { var result=new List<IntPtr>(); EnumChildWindows(parent,(h,d)=>{result.Add(h); return true;},IntPtr.Zero); return result.ToArray(); }
  public static string Text(IntPtr hwnd) { var b=new StringBuilder(checked((int)SendMessage(hwnd,0xE,IntPtr.Zero,IntPtr.Zero).ToInt64())+1); SendText(hwnd,0xD,(IntPtr)b.Capacity,b); return b.ToString(); }
  public static string ClassName(IntPtr hwnd) { var b=new StringBuilder(256); GetClassName(hwnd,b,b.Capacity); return b.ToString(); }
}
'@
$process = Start-Process -FilePath $Installer -PassThru
$found = $false
$snapshot = @()
try {
  for ($attempt=0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 500
    foreach ($window in [XopcInstallerControl]::Windows()) {
      $title = [XopcInstallerControl]::Text($window)
      if ($title -notmatch '(?i)xopc.*setup|setup.*xopc' -or ![XopcInstallerControl]::IsWindowVisible($window)) { continue }
      $controls = @([XopcInstallerControl]::Children($window) | ForEach-Object {
        [PSCustomObject]@{handle=$_;class=[XopcInstallerControl]::ClassName($_);text=[XopcInstallerControl]::Text($_);visible=[XopcInstallerControl]::IsWindowVisible($_);enabled=[XopcInstallerControl]::IsWindowEnabled($_);style=[XopcInstallerControl]::GetWindowLong($_,-16)}
      })
      $snapshot = @($controls | Select-Object class,text,visible,enabled,style)
      $checkbox = @($controls | Where-Object { $_.visible -and $_.class -eq 'Button' -and $_.text -like 'Enable automatic desktop updates*' -and ($_.style -band 15) -eq 3 })
      if ($checkbox.Count -eq 1) {
        if ([XopcInstallerControl]::SendMessage($checkbox[0].handle,0xF0,[IntPtr]::Zero,[IntPtr]::Zero).ToInt64() -ne 0) { throw 'Fresh install must not preselect update consent' }
        $text = ($controls | Where-Object { $_.visible -and $_.class -eq 'Edit' } | ForEach-Object text) -join "`n"
        if ($text -notmatch 'remote Langfuse export' -or $text -notmatch 'SignPath application preparation') { throw 'Full privacy text was not rendered in the installer' }
        $found = $true
        break
      }
      $next = @($controls | Where-Object { $_.visible -and $_.enabled -and $_.class -eq 'Button' -and $_.text.Replace('&','') -match '^Next' })
      if ($next.Count -eq 1) {
        [XopcInstallerControl]::SetForegroundWindow($window) | Out-Null
        [XopcInstallerControl]::SendMessage($next[0].handle,0xF5,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
      }
    }
    if ($found) { break }
  }
  if (!$found) { throw 'Native installer privacy page was not accessible' }
  Write-Output 'PASS: native privacy page, complete text and unchecked automatic-update choice'
} finally {
  if (!$found) { $snapshot | ConvertTo-Json -Depth 4 | Write-Output }
  # Only the disposable setup process started by this test is terminated.
  & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F 2>$null | Out-Null
}
