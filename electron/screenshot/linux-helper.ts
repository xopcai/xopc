import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { ScreenshotOcrResponse, SnapWindowRect } from './types.js';

const execFileAsync = promisify(execFile);

export function isWaylandSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    process.platform === 'linux' &&
    (env['XDG_SESSION_TYPE']?.toLowerCase() === 'wayland' || Boolean(env['WAYLAND_DISPLAY']))
  );
}

const PORTAL_SCREENSHOT_PYTHON = `
import sys
import uuid

interactive = sys.argv[1] == "1"

try:
    from gi.repository import Gio, GLib
except ImportError:
    sys.exit(11)

service = "org.freedesktop.portal.Desktop"
desktop = "/org/freedesktop/portal/desktop"
request = "org.freedesktop.portal.Request"
token = "xopc_" + uuid.uuid4().hex

try:
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
except GLib.Error:
    sys.exit(11)

sender = bus.get_unique_name()[1:].replace(".", "_")
handle = f"{desktop}/request/{sender}/{token}"
loop = GLib.MainLoop()
status = 2

def on_response(_bus, _sender, _path, _interface, _signal, parameters):
    global status
    status, results = parameters.unpack()
    if status == 0:
        print(results.get("uri", ""))
    loop.quit()

def subscribe(path):
    return bus.signal_subscribe(
        service, request, "Response", path, None, Gio.DBusSignalFlags.NONE, on_response
    )

subscription = subscribe(handle)
try:
    result = bus.call_sync(
        service, desktop, "org.freedesktop.portal.Screenshot", "Screenshot",
        GLib.Variant("(sa{sv})", ("", {
            "handle_token": GLib.Variant("s", token),
            "interactive": GLib.Variant("b", interactive),
        })),
        GLib.VariantType.new("(o)"), Gio.DBusCallFlags.NONE, 15000, None,
    )
except GLib.Error as error:
    if Gio.DBusError.get_remote_error(error) in {
        "org.freedesktop.DBus.Error.ServiceUnknown",
        "org.freedesktop.DBus.Error.UnknownInterface",
        "org.freedesktop.DBus.Error.UnknownMethod",
    }:
        sys.exit(11)
    raise

returned_handle, = result.unpack()
if returned_handle != handle:
    bus.signal_unsubscribe(subscription)
    subscription = subscribe(returned_handle)

loop.run()
bus.signal_unsubscribe(subscription)
sys.exit({0: 0, 1: 10}.get(status, 1))
`;

export type PortalCaptureResult =
  | { status: 'ok'; filePath: string }
  | { status: 'cancelled' }
  | { status: 'unavailable' };

export async function captureLinuxPortalScreenshot(options: {
  interactive: boolean;
  signal?: AbortSignal;
}): Promise<PortalCaptureResult> {
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/python3',
      ['-c', PORTAL_SCREENSHOT_PYTHON, options.interactive ? '1' : '0'],
      { signal: options.signal, maxBuffer: 64 * 1024, timeout: options.interactive ? 120_000 : 12_000 },
    );
    const uri = stdout.trim();
    if (!uri) return { status: 'unavailable' };
    return { status: 'ok', filePath: fileURLToPath(uri) };
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code === 10) return { status: 'cancelled' };
    return { status: 'unavailable' };
  }
}

export async function captureLinuxCliScreenshot(options: {
  interactive: boolean;
  outputPath: string;
  wayland: boolean;
  signal?: AbortSignal;
}): Promise<boolean> {
  const { interactive, outputPath, wayland, signal } = options;
  const candidates: Array<[string, ...string[]]> = interactive
    ? [
        ['spectacle', '-b', '-r', '-n', '-o', outputPath],
        ['gnome-screenshot', '--area', '--file', outputPath],
        ['xfce4-screenshooter', '--region', '--save', outputPath],
      ]
    : [
        ...(wayland ? ([['grim', outputPath]] as Array<[string, ...string[]]>) : []),
        ['spectacle', '-b', '-f', '-n', '-o', outputPath],
        ['gnome-screenshot', '--file', outputPath],
        ['maim', outputPath],
        ['scrot', outputPath],
      ];

  for (const [cmd, ...args] of candidates) {
    try {
      await execFileAsync(cmd, args, { signal, timeout: interactive ? 120_000 : 8_000 });
      return true;
    } catch {
      /* try next tool */
    }
  }
  return false;
}

export function parseWmctrlWindowList(stdout: string, excludePid: number): SnapWindowRect[] {
  const results: SnapWindowRect[] = [];
  const lines = stdout.trim().split('\n');
  // wmctrl -lGp outputs bottom-to-top; reverse so top-most window has zOrder 0.
  const reversed = [...lines].reverse();
  let zOrder = 0;
  for (const line of reversed) {
    const match = /^(0x[0-9a-fA-F]+)\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+\S+\s*(.*)$/.exec(
      line.trim(),
    );
    if (!match) continue;
    const [, id, desktop, pidStr, xStr, yStr, wStr, hStr, title] = match;
    if (desktop === '-1') continue; // sticky desktop wallpaper / dock
    const pid = Number(pidStr);
    if (excludePid > 0 && pid === excludePid) continue;
    const width = Number(wStr);
    const height = Number(hStr);
    if (width < 24 || height < 24) continue;
    results.push({
      id: id!,
      title: title ?? '',
      appName: '',
      x: Number(xStr),
      y: Number(yStr),
      width,
      height,
      zOrder: zOrder++,
    });
  }
  return results;
}

export async function queryLinuxX11SnapWindows(
  excludePid: number,
  signal?: AbortSignal,
): Promise<SnapWindowRect[]> {
  if (isWaylandSession()) return [];

  // Try wmctrl first (fast single process call).
  try {
    const { stdout } = await execFileAsync('wmctrl', ['-lGp'], { signal, timeout: 1_500 });
    const parsed = parseWmctrlWindowList(stdout, excludePid);
    if (parsed.length > 0) return parsed;
  } catch {
    /* fall through to xprop + xwininfo */
  }

  try {
    const { stdout: stackOut } = await execFileAsync('xprop', ['-root', '_NET_CLIENT_LIST_STACKING'], {
      signal,
      timeout: 1_500,
    });
    const ids = [...stackOut.matchAll(/0x[0-9a-fA-F]+/g)].map((m) => m[0]).reverse();
    const windows: SnapWindowRect[] = [];
    let zOrder = 0;
    for (const id of ids.slice(0, 48)) {
      try {
        const { stdout: info } = await execFileAsync('xwininfo', ['-id', id], { signal, timeout: 500 });
        if (!/Map State:\s*IsViewable/.test(info)) continue;
        const xMatch = /Absolute upper-left X:\s*(-?\d+)/.exec(info);
        const yMatch = /Absolute upper-left Y:\s*(-?\d+)/.exec(info);
        const wMatch = /Width:\s*(\d+)/.exec(info);
        const hMatch = /Height:\s*(\d+)/.exec(info);
        const titleMatch = /xwininfo: Window id: 0x[0-9a-fA-F]+ "(.*)"/.exec(info);
        if (!xMatch || !yMatch || !wMatch || !hMatch) continue;
        const width = Number(wMatch[1]);
        const height = Number(hMatch[1]);
        if (width < 24 || height < 24) continue;
        windows.push({
          id,
          title: titleMatch?.[1] ?? '',
          appName: '',
          x: Number(xMatch[1]),
          y: Number(yMatch[1]),
          width,
          height,
          zOrder: zOrder++,
        });
      } catch {
        /* ignore closed window */
      }
    }
    return windows;
  } catch {
    return [];
  }
}

export async function runLinuxTesseractOcr(
  imagePath: string,
  signal?: AbortSignal,
): Promise<ScreenshotOcrResponse | null> {
  for (const lang of ['chi_sim+eng', 'eng']) {
    try {
      const { stdout } = await execFileAsync('tesseract', [imagePath, 'stdout', '-l', lang, '--psm', '6'], {
        signal,
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const text = stdout.trim();
      return {
        ok: true,
        text,
        engine: 'tesseract',
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    }
  }
  return null;
}

export async function sendLinuxX11WheelScroll(
  screenX: number,
  screenY: number,
  direction: 'down' | 'up' = 'down',
  signal?: AbortSignal,
): Promise<boolean> {
  if (isWaylandSession()) return false;
  const button = direction === 'down' ? '5' : '4';
  try {
    await execFileAsync(
      'xdotool',
      ['mousemove', '--sync', String(Math.round(screenX)), String(Math.round(screenY)), 'click', '--repeat', '3', '--delay', '25', button],
      { signal, timeout: 1_500 },
    );
    return true;
  } catch {
    return false;
  }
}
