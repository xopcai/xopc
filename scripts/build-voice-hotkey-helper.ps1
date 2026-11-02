param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Output,
  [Parameter(Mandatory = $true)][ValidatePattern("^\d+\.\d+\.\d+$")][string]$Version
)

$ErrorActionPreference = 'Stop'
$outputDirectory = Split-Path -Parent $Output
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$parts = $Version.Split('.')
if ($parts | Where-Object { [int]$_ -gt 65534 }) { throw "Version exceeds Windows PE limits" }
$assemblyVersion = "$Version.0"
$attributes = @"
[assembly: System.Reflection.AssemblyProduct("xopc")]
[assembly: System.Reflection.AssemblyTitle("xopc voice hotkey helper")]
[assembly: System.Reflection.AssemblyVersion("$assemblyVersion")]
[assembly: System.Reflection.AssemblyFileVersion("$assemblyVersion")]
[assembly: System.Reflection.AssemblyInformationalVersion("$Version")]
"@
$code = [IO.File]::ReadAllText($Source)
# Assembly attributes must follow using directives and precede the first type.
$code = $code.Replace('internal static class VoiceHotkeyHelper', $attributes + "`ninternal static class VoiceHotkeyHelper")
Add-Type -TypeDefinition $code -OutputAssembly $Output -OutputType ConsoleApplication
$info = [Diagnostics.FileVersionInfo]::GetVersionInfo($Output)
if ($info.ProductName -ne 'xopc' -or $info.FileVersion -ne $assemblyVersion -or $info.ProductVersion -ne $Version) {
  throw 'Windows helper metadata does not match this release'
}
