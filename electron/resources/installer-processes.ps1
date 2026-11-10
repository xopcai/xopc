param(
  [ValidateSet('check', 'request', 'force')][string]$Mode = 'check',
  [Parameter(Mandatory=$true)][string]$InstallDirectory,
  [Parameter(Mandatory=$true)][int]$InstallerProcessId,
  [string]$InstallRegistryKey = '',
  [string[]]$AdditionalInstallDirectories = @(),
  [string]$StateFile = '',
  [string]$LogFile = '',
  [ValidateRange(0, 60)][int]$WaitSeconds = 15
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command Get-XopcLockingProcessIds -ErrorAction SilentlyContinue)) {
  . (Join-Path $PSScriptRoot 'installer-file-locks.ps1')
}

function Write-Diagnostic([string]$Message) {
  Write-Output $Message
  if ($LogFile) { Add-Content -LiteralPath $LogFile -Value "[$([DateTime]::UtcNow.ToString('o'))] $Message" -Encoding Unicode }
}
function Get-RegisteredDirectories {
  if (!$InstallRegistryKey) { return @() }
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
      try {
        $key = $base.OpenSubKey($InstallRegistryKey)
        if ($key) { try { $key.GetValue('InstallLocation') } finally { $key.Dispose() } }
      } finally { $base.Dispose() }
    }
  }
}
function Get-CreationIdentity($Process) {
  # A prefix prevents ConvertFrom-Json from coercing ISO timestamps back to DateTime.
  if ($Process.CreationDate -is [DateTime]) { return 'utc-ticks:' + $Process.CreationDate.ToUniversalTime().Ticks }
  return [string]$Process.CreationDate
}
function ConvertTo-XopcPath([string]$Path) {
  if (!$Path) { return $null }
  # .NET Framework can expand 8.3 names (RUNNER~1) while CIM retains the launch path.
  return [IO.Path]::GetFullPath($Path)
}
function Same-Identity($Current, $Saved) {
  return $Current -and (Get-CreationIdentity $Current) -eq $Saved.CreationIdentity -and
    [string]::Equals([string](ConvertTo-XopcPath $Current.ExecutablePath), [string]$Saved.ExecutablePath, [StringComparison]::OrdinalIgnoreCase)
}

try {
  $directories = @(@($InstallDirectory) + $AdditionalInstallDirectories + @(Get-RegisteredDirectories) | Where-Object { $_ } | ForEach-Object {
    if (![IO.Path]::IsPathRooted($_) -or $_.Contains('"')) { throw "Invalid installation directory: $_" }
    $full = [IO.Path]::GetFullPath($_)
    if ($full.Length -gt [IO.Path]::GetPathRoot($full).Length) { $full = $full.TrimEnd('\', '/') }
    $full
  } | Sort-Object -Unique)
  $relativeExecutables = @('xopc.exe', 'resources/bin/cua-driver.exe', 'resources/bin/cua-driver-uia.exe',
    'resources/bin/cua-cursor-theme.exe', 'resources/bin/voice-hotkey-helper.exe', 'resources/bin/rg.exe')
  $executables = @($directories | ForEach-Object { $dir = $_; $relativeExecutables | ForEach-Object { [IO.Path]::Combine($dir, $_.Replace('/', [IO.Path]::DirectorySeparatorChar)) } })
  $names = @($executables | ForEach-Object { [IO.Path]::GetFileName($_) } | Sort-Object -Unique)
  $excluded = @($PID, $InstallerProcessId)
  $saved = @()
  # Windows PowerShell returns a JSON array as one pipeline item; don't wrap it again.
  if ($StateFile -and [IO.File]::Exists($StateFile)) { $saved = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json }

  function Get-InstalledProcesses {
    $all = @(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object {
      [pscustomobject]@{ ProcessId=$_.ProcessId; ParentProcessId=$_.ParentProcessId; Name=$_.Name;
        CreationDate=$_.CreationDate; ExecutablePath=(ConvertTo-XopcPath $_.ExecutablePath) }
    })
    foreach ($start in @($PID, $InstallerProcessId)) {
      $current = $start
      $visited = @()
      while ($current -gt 0 -and $current -notin $visited) {
        $visited += $current
        $row = $all | Where-Object { $_.ProcessId -eq $current } | Select-Object -First 1
        if (!$row) { break }
        $current = [int]$row.ParentProcessId
        if ($current -in $script:excluded) { break }
        $parent = $all | Where-Object { $_.ProcessId -eq $current } | Select-Object -First 1
        if ($parent -and $parent.ExecutablePath -in $executables) { break }
        $script:excluded += $current
      }
    }
    $opaque = @($all | Where-Object { !$_.ExecutablePath -and $_.Name -in $names -and $_.ProcessId -notin $script:excluded })
    $lockOwners = @()
    if ($opaque.Count) { $lockOwners = @(Get-XopcLockingProcessIds $executables) }
    $owned = @($all | Where-Object {
      $_.ProcessId -notin $script:excluded -and ($_.ExecutablePath -in $executables -or
        (!$_.ExecutablePath -and $_.Name -in $names -and $_.ProcessId -in $lockOwners))
    })
    foreach ($previous in $script:saved) {
      $row = $all | Where-Object { $_.ProcessId -eq $previous.ProcessId } | Select-Object -First 1
      if ($row -and $row.ProcessId -notin $script:excluded -and (Same-Identity $row $previous) -and
          $row.ExecutablePath -and $row.ProcessId -notin @($owned | ForEach-Object ProcessId)) { $owned += $row }
    }
    do {
      $parents = @($owned | ForEach-Object ProcessId)
      $children = @($all | Where-Object {
        $row = $_
        $withinDirectory = @($directories | Where-Object { $row.ExecutablePath -and $row.ExecutablePath.StartsWith($_.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
        $row.ParentProcessId -in $parents -and $row.ProcessId -notin $parents -and $row.ProcessId -notin $script:excluded -and $withinDirectory
      })
      $owned += $children
    } while ($children.Count)
    $script:saved = @($owned | ForEach-Object { @{ ProcessId=$_.ProcessId; ExecutablePath=$_.ExecutablePath; CreationIdentity=(Get-CreationIdentity $_) } })
    if ($StateFile) { ConvertTo-Json -InputObject @($script:saved) | Set-Content -LiteralPath $StateFile -Encoding UTF8 }
    return $owned
  }

  Write-Diagnostic "phase=$Mode directories=$($directories -join ';')"
  $running = @(Get-InstalledProcesses)
  Write-Diagnostic "phase=$Mode matchedPids=$(@($running | ForEach-Object ProcessId) -join ',')"
  if (!$running.Count) { exit 0 }
  if ($Mode -eq 'check') { exit 10 }
  if ($Mode -eq 'request') {
    # Request only apps which still exist; helper-only remnants require explicit force approval.
    foreach ($directory in $directories) {
      $exe = [IO.Path]::Combine($directory, 'xopc.exe')
      if (@($running | Where-Object { $_.ExecutablePath -ieq $exe }).Count) {
        Start-Process -FilePath $exe -ArgumentList '--quit-for-install' -WorkingDirectory $directory | Out-Null
      }
    }
  } else {
    foreach ($process in $running) {
      $identity = $script:saved | Where-Object { $_.ProcessId -eq $process.ProcessId } | Select-Object -First 1
      if (!$identity.CreationIdentity) { throw "Cannot verify process start time for PID $($process.ProcessId). Exit it manually and retry." }
      $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ProcessId)" -ErrorAction Stop
      if (Same-Identity $current $identity) {
        if (!$current.ExecutablePath -and $current.ProcessId -notin @(Get-XopcLockingProcessIds $executables)) { continue }
        try { Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop }
        catch { if (Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ProcessId)") { throw } }
      }
    }
  }
  $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
  do {
    if (@(Get-InstalledProcesses).Count -eq 0) { Write-Diagnostic "phase=$Mode result=stopped"; exit 0 }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  Write-Diagnostic "phase=$Mode result=still-running"
  exit 10
} catch {
  Write-Diagnostic "phase=$Mode result=error message=$($_.Exception.Message)"
  exit 20
}
