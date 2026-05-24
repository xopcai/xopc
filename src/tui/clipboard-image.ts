import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type ClipboardImage = {
  bytes: Uint8Array;
  mimeType: string;
};

const SUPPORTED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

function baseMimeType(mimeType: string): string {
  return mimeType.split(';')[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

export function extensionForImageMimeType(mimeType: string): string | null {
  switch (baseMimeType(mimeType)) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return null;
  }
}

function runCommand(
  command: string,
  args: string[],
  options?: { timeoutMs?: number; maxBufferBytes?: number },
): { stdout: Buffer; ok: boolean } {
  const result = spawnSync(command, args, {
    timeout: options?.timeoutMs ?? 3000,
    maxBuffer: options?.maxBufferBytes ?? 50 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    return { ok: false, stdout: Buffer.alloc(0) };
  }
  const stdout = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout ?? '', 'utf8');
  return { ok: true, stdout };
}

export function isWaylandSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === 'wayland';
}

function selectPreferredImageMimeType(mimeTypes: string[]): string | null {
  for (const preferred of SUPPORTED_IMAGE_MIME_TYPES) {
    const match = mimeTypes.find((t) => baseMimeType(t) === preferred);
    if (match) return match;
  }
  return mimeTypes.find((t) => baseMimeType(t).startsWith('image/')) ?? null;
}

function readClipboardImageViaWlPaste(): ClipboardImage | null {
  const list = runCommand('wl-paste', ['--list-types'], { timeoutMs: 1000 });
  if (!list.ok) return null;
  const types = list.stdout
    .toString('utf8')
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  const selectedType = selectPreferredImageMimeType(types);
  if (!selectedType) return null;
  const data = runCommand('wl-paste', ['--type', selectedType, '--no-newline']);
  if (!data.ok || data.stdout.length === 0) return null;
  return { bytes: data.stdout, mimeType: baseMimeType(selectedType) };
}

function readClipboardImageViaXclip(): ClipboardImage | null {
  for (const mimeType of SUPPORTED_IMAGE_MIME_TYPES) {
    const data = runCommand('xclip', ['-selection', 'clipboard', '-t', mimeType, '-o']);
    if (data.ok && data.stdout.length > 0) {
      return { bytes: data.stdout, mimeType };
    }
  }
  return null;
}

function readClipboardImageViaMac(): ClipboardImage | null {
  const tmpFile = join(tmpdir(), `xopc-clip-${randomUUID()}.png`);
  const script = [
    'try',
    '  set pngData to the clipboard as «class PNGf»',
    `  set fileRef to POSIX file "${tmpFile}"`,
    '  set fileNumber to open for access fileRef with write permission',
    '  write pngData to fileNumber',
    '  close access fileNumber',
    '  return "ok"',
    'on error',
    '  return "empty"',
    'end try',
  ].join('\n');
  const result = runCommand('osascript', ['-e', script], { timeoutMs: 5000 });
  if (!result.ok || result.stdout.toString('utf8').trim() !== 'ok') {
    try {
      unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
    return null;
  }
  try {
    const bytes = readFileSync(tmpFile);
    if (bytes.length === 0) return null;
    return { bytes: new Uint8Array(bytes), mimeType: 'image/png' };
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
}

function readClipboardImageViaPowerShell(): ClipboardImage | null {
  const tmpFile = join(tmpdir(), `xopc-clip-${randomUUID()}.png`);
  let psPath = tmpFile;
  if (process.platform !== 'win32') {
    const wslpath = runCommand('wslpath', ['-w', tmpFile], { timeoutMs: 1000 });
    if (!wslpath.ok) return null;
    psPath = wslpath.stdout.toString('utf8').trim();
  }
  const psQuoted = psPath.replaceAll("'", "''");
  const psScript = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    ` $path = '${psQuoted}'`,
    '$img = [System.Windows.Forms.Clipboard]::GetImage()',
    'if ($img) { $img.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); Write-Output "ok" } else { Write-Output "empty" }',
  ].join('; ');
  const result = runCommand('powershell.exe', ['-NoProfile', '-Command', psScript], {
    timeoutMs: 5000,
  });
  if (!result.ok || result.stdout.toString('utf8').trim() !== 'ok') {
    return null;
  }
  try {
    const bytes = readFileSync(tmpFile);
    if (bytes.length === 0) return null;
    return { bytes: new Uint8Array(bytes), mimeType: 'image/png' };
  } catch {
    return null;
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
}

/** Read image bytes from the system clipboard when available. */
export async function readClipboardImage(options?: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<ClipboardImage | null> {
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;

  if (platform === 'darwin') {
    return readClipboardImageViaMac();
  }
  if (platform === 'win32') {
    return readClipboardImageViaPowerShell();
  }
  if (platform === 'linux') {
    if (isWaylandSession(env)) {
      return readClipboardImageViaWlPaste() ?? readClipboardImageViaXclip();
    }
    return readClipboardImageViaXclip() ?? readClipboardImageViaWlPaste();
  }
  return null;
}

/** Write clipboard image to a temp file; caller owns cleanup. */
export async function saveClipboardImageToTempFile(): Promise<string | null> {
  const image = await readClipboardImage();
  if (!image) return null;
  const ext = extensionForImageMimeType(image.mimeType) ?? 'png';
  const filePath = join(tmpdir(), `xopc-clip-${randomUUID()}.${ext}`);
  writeFileSync(filePath, Buffer.from(image.bytes));
  return filePath;
}
