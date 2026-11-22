import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ScreenshotOcrBlock, ScreenshotOcrResponse, ScreenshotRect, SnapWindowRect } from './types.js';

const execFileAsync = promisify(execFile);

function powershellPath(): string {
  return join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export interface WindowsDisplayMetric {
  bounds: ScreenshotRect;
  scaleFactor: number;
}

const WINDOWS_SNAP_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$excludePid = [int]$env:XOPC_EXCLUDE_PID
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class XopcWinSnap {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

  public class WinItem {
    public string id;
    public uint pid;
    public string title;
    public int x;
    public int y;
    public int width;
    public int height;
    public int zOrder;
  }

  public static WinItem[] List(int excludePid) {
    try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch {}
    var list = new List<WinItem>();
    int z = 0;
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd) || IsIconic(hWnd)) return true;
      int exStyle = GetWindowLong(hWnd, -20);
      if ((exStyle & 0x00000080) != 0 && (exStyle & 0x00040000) == 0) return true; // skip non-app tool windows/popups
      if ((exStyle & 0x08000000) != 0 && (exStyle & 0x00000020) != 0) return true; // transparent click-through overlay
      int cloaked = 0;
      if (DwmGetWindowAttribute(hWnd, 14, out cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
      uint pid = 0;
      GetWindowThreadProcessId(hWnd, out pid);
      if (excludePid > 0 && pid == (uint)excludePid) return true;
      RECT rect;
      if (DwmGetWindowAttribute(hWnd, 9, out rect, Marshal.SizeOf(typeof(RECT))) != 0) {
        if (!GetWindowRect(hWnd, out rect)) return true;
      }
      int w = rect.Right - rect.Left;
      int h = rect.Bottom - rect.Top;
      if (w < 24 || h < 24) return true;
      var sb = new StringBuilder(256);
      GetWindowText(hWnd, sb, sb.Capacity);
      list.Add(new WinItem {
        id = hWnd.ToInt64().ToString(),
        pid = pid,
        title = sb.ToString(),
        x = rect.Left,
        y = rect.Top,
        width = w,
        height = h,
        zOrder = z++
      });
      return list.Count < 160;
    }, IntPtr.Zero);
    return list.ToArray();
  }
}
"@
$items = [XopcWinSnap]::List($excludePid)
ConvertTo-Json -Compress -InputObject @{ windows = @($items) }
`;

export function physicalToLogicalWindowsRect(
  phys: { x: number; y: number; width: number; height: number },
  displays: readonly WindowsDisplayMetric[],
): ScreenshotRect {
  const cx = phys.x + phys.width / 2;
  const cy = phys.y + phys.height / 2;
  let matched = displays[0];
  for (const d of displays) {
    const px = d.bounds.x * d.scaleFactor;
    const py = d.bounds.y * d.scaleFactor;
    const pw = d.bounds.width * d.scaleFactor;
    const ph = d.bounds.height * d.scaleFactor;
    if (cx >= px && cx <= px + pw && cy >= py && cy <= py + ph) {
      matched = d;
      break;
    }
  }
  const scale = matched?.scaleFactor && matched.scaleFactor > 0 ? matched.scaleFactor : 1;
  if (!matched || scale === 1) {
    return {
      x: Math.round(phys.x),
      y: Math.round(phys.y),
      width: Math.round(phys.width),
      height: Math.round(phys.height),
    };
  }
  const physOriginX = matched.bounds.x * scale;
  const physOriginY = matched.bounds.y * scale;
  return {
    x: Math.round(matched.bounds.x + (phys.x - physOriginX) / scale),
    y: Math.round(matched.bounds.y + (phys.y - physOriginY) / scale),
    width: Math.max(1, Math.round(phys.width / scale)),
    height: Math.max(1, Math.round(phys.height / scale)),
  };
}

export async function queryWindowsSnapList(
  excludePid: number,
  displays: readonly WindowsDisplayMetric[],
  signal?: AbortSignal,
): Promise<SnapWindowRect[]> {
  try {
    const { stdout } = await execFileAsync(
      powershellPath(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(WINDOWS_SNAP_SCRIPT)],
      {
        windowsHide: true,
        timeout: 2_500,
        maxBuffer: 512 * 1024,
        signal,
        env: { ...process.env, XOPC_EXCLUDE_PID: String(excludePid) },
      },
    );
    const parsed = JSON.parse(stdout.trim()) as {
      windows?:
        | Array<{
            id: string;
            pid: number;
            title: string;
            x: number;
            y: number;
            width: number;
            height: number;
            zOrder: number;
          }>
        | {
            id: string;
            pid: number;
            title: string;
            x: number;
            y: number;
            width: number;
            height: number;
            zOrder: number;
          };
    };
    const rawList = Array.isArray(parsed.windows)
      ? parsed.windows
      : parsed.windows
        ? [parsed.windows]
        : [];
    return rawList.map((w) => {
      const rect = physicalToLogicalWindowsRect(w, displays);
      return {
        id: String(w.id),
        title: w.title ?? '',
        appName: '',
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        zOrder: w.zOrder,
      };
    });
  } catch {
    return [];
  }
}

const WINDOWS_OCR_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$imagePath = $env:XOPC_OCR_IMAGE_PATH
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]
function AwaitOp($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
}
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null

$file = AwaitOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
$stream = AwaitOp ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = AwaitOp ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = AwaitOp ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
  $langs = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
  if ($langs.Count -gt 0) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langs[0])
  }
}
if ($null -eq $engine) {
  ConvertTo-Json -Compress @{ ok = $false; error = 'No Windows OCR language pack installed' }
  exit 0
}
$result = AwaitOp ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$w = [Math]::Max(1.0, [double]$bitmap.PixelWidth)
$h = [Math]::Max(1.0, [double]$bitmap.PixelHeight)
$blocks = @()
foreach ($line in $result.Lines) {
  $minX = $w; $minY = $h; $maxX = 0.0; $maxY = 0.0
  foreach ($word in $line.Words) {
    $r = $word.BoundingRect
    if ($r.X -lt $minX) { $minX = $r.X }
    if ($r.Y -lt $minY) { $minY = $r.Y }
    if (($r.X + $r.Width) -gt $maxX) { $maxX = $r.X + $r.Width }
    if (($r.Y + $r.Height) -gt $maxY) { $maxY = $r.Y + $r.Height }
  }
  $blocks += @{
    text = $line.Text
    x = $minX / $w
    y = $minY / $h
    width = [Math]::Max(0.0, ($maxX - $minX) / $w)
    height = [Math]::Max(0.0, ($maxY - $minY) / $h)
  }
}
$stream.Dispose()
ConvertTo-Json -Compress -Depth 5 @{
  ok = $true
  text = ($blocks | ForEach-Object { $_.text }) -join "\`n"
  blocks = $blocks
}
`;

export async function runWindowsNativeOcr(
  imagePath: string,
  signal?: AbortSignal,
): Promise<ScreenshotOcrResponse | null> {
  try {
    const { stdout } = await execFileAsync(
      powershellPath(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(WINDOWS_OCR_SCRIPT)],
      {
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024,
        signal,
        env: { ...process.env, XOPC_OCR_IMAGE_PATH: imagePath },
      },
    );
    const parsed = JSON.parse(stdout.trim()) as {
      ok?: boolean;
      text?: string;
      blocks?: ScreenshotOcrBlock[] | ScreenshotOcrBlock;
      error?: string;
    };
    if (!parsed.ok) return null;
    const blocks = Array.isArray(parsed.blocks)
      ? parsed.blocks
      : parsed.blocks
        ? [parsed.blocks]
        : undefined;
    return {
      ok: true,
      text: parsed.text ?? '',
      blocks,
      engine: 'winrt',
    };
  } catch {
    return null;
  }
}

const WINDOWS_SCROLL_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class XopcWinScroll {
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
  public static void Wheel(int x, int y, int delta) {
    try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch {}
    SetCursorPos(x, y);
    mouse_event(0x0800, 0, 0, delta, UIntPtr.Zero);
  }
}
"@
[XopcWinScroll]::Wheel([int]$env:XOPC_SCROLL_X, [int]$env:XOPC_SCROLL_Y, [int]$env:XOPC_SCROLL_DELTA)
`;

export async function sendWindowsWheelScroll(
  physX: number,
  physY: number,
  delta = -240,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    await execFileAsync(
      powershellPath(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(WINDOWS_SCROLL_SCRIPT)],
      {
        windowsHide: true,
        timeout: 2_000,
        signal,
        env: {
          ...process.env,
          XOPC_SCROLL_X: String(Math.round(physX)),
          XOPC_SCROLL_Y: String(Math.round(physY)),
          XOPC_SCROLL_DELTA: String(Math.round(delta)),
        },
      },
    );
    return true;
  } catch {
    return false;
  }
}
