param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
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
        $toggle = $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
        if ($toggle.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::Off) { throw 'Fresh install must not preselect update consent' }
        $text = ''
        foreach ($candidate in $elements) {
          $value = $null
          if ($candidate.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value)) { $text += $value.Current.Value }
        }
        if ($text -notmatch 'remote Langfuse export' -or $text -notmatch 'SignPath application preparation') { throw 'Full privacy text was not rendered in the installer' }
        $found = $true
      }
      if ($found) { break }
      foreach ($element in $elements) {
        if ($element.Current.IsEnabled -and $element.Current.Name -match '^Next') {
          $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
          break
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
