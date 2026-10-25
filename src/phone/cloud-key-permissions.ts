import { execFile } from 'node:child_process';
import { chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { PhoneError } from './contracts.js';

const execute = promisify(execFile);
const protectWindowsCredential = `
$ErrorActionPreference = 'Stop'
$target = $env:XOPC_PHONE_CREDENTIAL_TARGET
$directory = $env:XOPC_PHONE_CREDENTIAL_DIRECTORY -eq '1'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($directory) {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
} else {
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
}
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inheritance, 'None', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $target -AclObject $acl
$actual = Get-Acl -LiteralPath $target
$rules = @($actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
if (!$actual.AreAccessRulesProtected -or $actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1) { throw 'Credential ACL verification failed' }
$access = $rules[0]
if ($access.IdentityReference.Value -ne $sid.Value -or $access.IsInherited -or $access.AccessControlType -ne 'Allow' -or $access.FileSystemRights -ne 'FullControl' -or $access.InheritanceFlags -ne $inheritance -or $access.PropagationFlags -ne 'None') { throw 'Credential ACL verification failed' }
`;

/** Fail closed if owner-only access cannot be established on the credential path. */
export async function protectPhoneCredential(path: string, directory: boolean): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw new Error('Invalid credential path');
    if (process.platform === 'win32') {
      // Windows PowerShell must not inherit PowerShell 7's incompatible module path.
      await execute(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(protectWindowsCredential, 'utf16le').toString('base64')],
        { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024,
          env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath')), PSModulePath: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'), XOPC_PHONE_CREDENTIAL_TARGET: path, XOPC_PHONE_CREDENTIAL_DIRECTORY: directory ? '1' : '0' } });
    } else {
      const mode = directory ? 0o700 : 0o600;
      await chmod(path, mode);
      const actual = await lstat(path);
      if ((actual.mode & 0o777) !== mode || (process.getuid && actual.uid !== process.getuid())) throw new Error('Credential mode verification failed');
    }
  } catch { throw new PhoneError('PHONE_KEY_PERMISSIONS', 'Unable to secure phone credentials for the current user. Check filesystem permissions.', 500); }
}
