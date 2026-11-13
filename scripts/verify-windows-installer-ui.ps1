param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [string]$UpgradeInstallDirectory
)
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
$verifyUpgrade = ![string]::IsNullOrEmpty($UpgradeInstallDirectory)
$attemptLimit = 60
if ($verifyUpgrade) {
  $installedExecutable = Join-Path $UpgradeInstallDirectory 'xopc.exe'
  if (!(Test-Path -LiteralPath $installedExecutable -PathType Leaf)) { throw 'Upgrade test requires an existing xopc installation' }
  $process = Start-Process -FilePath $Installer -ArgumentList '--updated', '--force-run' -PassThru
  $attemptLimit = 240
} else {
  $process = Start-Process -FilePath $Installer -PassThru
}
$found = $false
$finishClicked = $false
$snapshot = @()
try {
  for ($attempt=0; $attempt -lt $attemptLimit; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($finishClicked) {
      if (!$process.HasExited) { continue }
      if ($process.ExitCode -ne 0) { throw "Upgrade installer exited with code $($process.ExitCode)" }
      $launched = Get-Process -Name xopc -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -eq $installedExecutable -and $_.MainWindowHandle -ne [IntPtr]::Zero
      }
      if ($launched) { $found = $true; break }
      continue
    }
    foreach ($window in [XopcInstallerControl]::Windows()) {
      $title = [XopcInstallerControl]::Text($window)
      if ($title -notmatch '(?i)xopc.*setup|setup.*xopc' -or ![XopcInstallerControl]::IsWindowVisible($window)) { continue }
      $controls = @([XopcInstallerControl]::Children($window) | ForEach-Object {
        [PSCustomObject]@{handle=$_;class=[XopcInstallerControl]::ClassName($_);text=[XopcInstallerControl]::Text($_);visible=[XopcInstallerControl]::IsWindowVisible($_);enabled=[XopcInstallerControl]::IsWindowEnabled($_);style=[XopcInstallerControl]::GetWindowLong($_,-16)}
      })
      $snapshot = @($controls | Select-Object class,text,visible,enabled,style)
      $checkbox = @($controls | Where-Object { $_.visible -and $_.class -eq 'Button' -and $_.text -like 'Enable automatic desktop updates*' -and ($_.style -band 15) -eq 3 })
      if (!$verifyUpgrade -and $checkbox.Count -eq 1) {
        if ([XopcInstallerControl]::SendMessage($checkbox[0].handle,0xF0,[IntPtr]::Zero,[IntPtr]::Zero).ToInt64() -ne 0) { throw 'Fresh install must not preselect update consent' }
        $text = ($controls | Where-Object { $_.visible -and $_.class -eq 'Edit' } | ForEach-Object text) -join "`n"
        if ($text -notmatch 'remote Langfuse export' -or $text -notmatch 'SignPath application preparation') { throw 'Full privacy text was not rendered in the installer' }
        $found = $true
        break
      }
      if ($verifyUpgrade) {
        $finish = @($controls | Where-Object { $_.visible -and $_.enabled -and $_.class -eq 'Button' -and $_.text.Replace('&','') -eq 'Finish' })
        if ($finish.Count -eq 1) {
          $launch = @($controls | Where-Object { $_.visible -and $_.enabled -and $_.class -eq 'Button' -and $_.text.Replace('&','') -eq 'Run xopc' })
          if ($launch.Count -ne 1 -or [XopcInstallerControl]::SendMessage($launch[0].handle,0xF0,[IntPtr]::Zero,[IntPtr]::Zero).ToInt64() -ne 1) {
            throw 'The upgrade finish page must offer to run xopc and select it by default'
          }
          [XopcInstallerControl]::SetForegroundWindow($window) | Out-Null
          [XopcInstallerControl]::SendMessage($finish[0].handle,0xF5,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
          $finishClicked = $true
          break
        }
      }
      $next = @($controls | Where-Object { $_.visible -and $_.enabled -and $_.class -eq 'Button' -and $_.text.Replace('&','') -match '^Next' })
      if ($verifyUpgrade -and $next.Count -eq 0) {
        $next = @($controls | Where-Object { $_.visible -and $_.enabled -and $_.class -eq 'Button' -and $_.text.Replace('&','') -eq 'Install' })
      }
      if ($next.Count -eq 1) {
        [XopcInstallerControl]::SetForegroundWindow($window) | Out-Null
        [XopcInstallerControl]::SendMessage($next[0].handle,0xF5,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
      }
    }
    if ($found) { break }
  }
  if ($verifyUpgrade) {
    if (!$found) { throw 'The assisted upgrade did not finish and open the installed xopc window' }
    Write-Output 'PASS: assisted upgrade opened xopc from the finish page'
    return
  }
  if (!$found) { throw 'Native installer privacy page was not accessible' }
  Write-Output 'PASS: native privacy page, complete text and unchecked automatic-update choice'
} finally {
  if (!$found) { $snapshot | ConvertTo-Json -Depth 4 | Write-Output }
  # Only the disposable setup process started by this test is terminated.
  if (!$process.HasExited) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F 2>$null | Out-Null
  }
}
