import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { load } from 'js-yaml';

const execFileAsync = promisify(execFile);
const SCRIPT = `$ErrorActionPreference='Stop';
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);
$s=Get-AuthenticodeSignature -LiteralPath $env:XOPC_SIGNATURE_TARGET;
$eku=@(); if ($s.SignerCertificate) { $eku=@($s.SignerCertificate.EnhancedKeyUsageList | ForEach-Object { [string]$_.ObjectId }) };
[pscustomobject]@{status=$s.Status.ToString();subject=if($s.SignerCertificate){$s.SignerCertificate.Subject}else{''};issuer=if($s.SignerCertificate){$s.SignerCertificate.Issuer}else{''};thumbprint=if($s.SignerCertificate){$s.SignerCertificate.Thumbprint}else{''};timestamped=($null -ne $s.TimeStamperCertificate);codeSigning=($eku -contains '1.3.6.1.5.5.7.3.3')} | ConvertTo-Json -Compress`;

export type WindowsSignature = { status: string; subject: string; issuer: string; thumbprint: string; timestamped: boolean; codeSigning: boolean };

export function windowsPublishers(configPath: string): string[] {
  const contents = readFileSync(configPath, 'utf8');
  if (contents.length > 65_536) throw new Error('Windows update configuration is too large');
  const config = load(contents) as { publisherName?: unknown };
  const names = Array.isArray(config?.publisherName) ? config.publisherName : [config?.publisherName];
  if (!names.length || names.some(name => typeof name !== 'string' || !name.startsWith('CN=') || /Developer ID Application|Apple/i.test(name))) {
    throw new Error('Windows update publisher is missing or invalid; install a signed release');
  }
  return names as string[];
}

/** No caller-controlled text is interpolated into executable PowerShell source. */
export async function readWindowsSignature(file: string): Promise<WindowsSignature> {
  if (process.platform !== 'win32') throw new Error('Authenticode verification requires Windows');
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const { stdout } = await execFileAsync(join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 30_000, maxBuffer: 65_536, encoding: 'utf8', env: { ...process.env,
      PSModulePath: join(systemRoot, 'System32/WindowsPowerShell/v1.0/Modules'), XOPC_SIGNATURE_TARGET: resolve(file) } });
  const result = JSON.parse(stdout);
  if (typeof result.status !== 'string' || typeof result.subject !== 'string' || typeof result.issuer !== 'string'
    || typeof result.timestamped !== 'boolean' || typeof result.codeSigning !== 'boolean') throw new Error('Invalid Authenticode verification result');
  return result;
}

export function windowsSignatureFailure(signature: WindowsSignature, publishers: string[]): string | null {
  if (!publishers.length || publishers.some(name => !name.startsWith('CN='))) return 'Windows publisher pin is missing';
  if (signature.status !== 'Valid') return `Windows signature is ${signature.status}`;
  if (!signature.codeSigning || !signature.timestamped) return 'Windows signature requires code-signing EKU and a trusted timestamp';
  if (/Developer ID Application|Apple/i.test(signature.subject + signature.issuer)) return 'Windows signature uses an unsupported Apple certificate';
  if (!publishers.includes(signature.subject)) return 'Windows signature publisher does not match the installed application';
  return null;
}

export async function verifyWindowsUpdateSignature(publishers: string[], file: string): Promise<string | null> {
  try { return windowsSignatureFailure(await readWindowsSignature(file), publishers); }
  catch { return 'Windows signature verification could not be completed'; }
}
