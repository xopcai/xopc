$ErrorActionPreference = 'Stop'
$testRoot = [IO.Path]::GetFullPath($args[0])
$leaf = Split-Path -Leaf $testRoot
if ($leaf -notmatch '^windows-reliability-[a-f0-9-]{36}$') { throw 'Invalid validation root' }
$needle = [BitConverter]::ToString([Text.Encoding]::Unicode.GetBytes($leaf + '\notepad-validation.txt'))
Get-CimInstance Win32_Process -Filter "Name='Notepad.exe'" | ForEach-Object {
  $ownedProcess = $_
  $owned = $ownedProcess.CommandLine -and $ownedProcess.CommandLine.ToLowerInvariant().Contains($testRoot.ToLowerInvariant())
  if ($ownedProcess.CommandLine -match '/SESSION:([A-Za-z0-9+/=]+)') {
    $sessionToken = $Matches[1]
    $sessionToken = $sessionToken.PadRight([int]([Math]::Ceiling($sessionToken.Length / 4.0) * 4), '=')
    $owned = [BitConverter]::ToString([Convert]::FromBase64String($sessionToken)).Contains($needle)
  }
  if ($owned) { Stop-Process -Id $ownedProcess.ProcessId -ErrorAction SilentlyContinue }
}
