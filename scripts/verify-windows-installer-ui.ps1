param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
# NSIS controls do not expose every UIA pattern on every hosted Windows image.
# Read actual Win32 controls when that provider lacks Toggle/Value/Invoke support.
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class XopcInstallerControl {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)] static extern IntPtr SendText(IntPtr hwnd, uint msg, IntPtr count, StringBuilder text);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int index);
  public static string Text(IntPtr hwnd) { var b=new StringBuilder(checked((int)SendMessage(hwnd,0xE,IntPtr.Zero,IntPtr.Zero).ToInt64())+1); SendText(hwnd,0xD,(IntPtr)b.Capacity,b); return b.ToString(); }
  public static string ClassName(IntPtr hwnd) { var b=new StringBuilder(256); GetClassName(hwnd,b,b.Capacity); return b.ToString(); }
}
'@
$process = Start-Process -FilePath $Installer -PassThru
try {
  $found = $false
  for ($attempt=0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 500
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($window in $windows) {
      if ($window.Current.Name -notmatch '(?i)xopc.*setup|setup.*xopc') { continue }
      $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      foreach ($element in $elements) {
        if ($element.Current.Name -notlike 'Enable automatic desktop updates*') { continue }
        $handle = [IntPtr]$element.Current.NativeWindowHandle
        $toggle = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$toggle)) {
          if ($toggle.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::Off) { throw 'Fresh install must not preselect update consent' }
        } elseif ($handle -ne [IntPtr]::Zero -and [XopcInstallerControl]::ClassName($handle) -eq 'Button' -and ([XopcInstallerControl]::GetWindowLong($handle, -16) -band 15) -eq 3) {
          if ([XopcInstallerControl]::SendMessage($handle, 0xF0, [IntPtr]::Zero, [IntPtr]::Zero).ToInt64() -ne 0) { throw 'Fresh install must not preselect update consent' }
        } else { continue }
        $text = ''
        foreach ($candidate in $elements) {
          $value = $null
          if ($candidate.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value)) { $text += $value.Current.Value }
          $native = [IntPtr]$candidate.Current.NativeWindowHandle
          if ($native -ne [IntPtr]::Zero -and [XopcInstallerControl]::ClassName($native) -eq 'Edit') { $text += [XopcInstallerControl]::Text($native) }
        }
        if ($text -notmatch 'remote Langfuse export' -or $text -notmatch 'SignPath application preparation') { throw 'Full privacy text was not rendered in the installer' }
        $found = $true
      }
      if ($found) { break }
      foreach ($element in $elements) {
        if ($element.Current.IsEnabled -and $element.Current.Name.Replace('&', '') -match '^Next') {
          $invoke = $null
          if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
            $invoke.Invoke()
            break
          }
          $handle = [IntPtr]$element.Current.NativeWindowHandle
          if ($handle -ne [IntPtr]::Zero -and [XopcInstallerControl]::ClassName($handle) -eq 'Button') {
            [XopcInstallerControl]::SendMessage($handle, 0xF5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
            break
          }
        }
      }
    }
    if ($found) { break }
  }
  if (!$found) { throw 'Native installer privacy page was not accessible' }
  Write-Output 'PASS: native privacy page, complete text and unchecked automatic-update choice'
} finally {
  # Only the disposable setup process started by this test is terminated.
  & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F 2>$null | Out-Null
}
