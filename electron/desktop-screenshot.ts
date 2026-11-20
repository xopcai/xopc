import { execFile } from 'node:child_process';
import { platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ClipboardItem, clipboard, nativeImage, shell } from 'electron';

const run = promisify(execFile);

// The portal method and Response subscription need to use the same session bus connection.
const PORTAL_SCREENSHOT = `
import sys
import uuid

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
            "interactive": GLib.Variant("b", True),
        })),
        GLib.VariantType.new("(o)"), Gio.DBusCallFlags.NONE, 10000, None,
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

const LINUX_SCREENSHOT_TOOLS = [
  ['spectacle', '-b', '-r', '-c'],
  ['gnome-screenshot', '--area', '--clipboard'],
  ['xfce4-screenshooter', '--region', '--clipboard'],
] as const;

async function captureLinuxScreenshot(signal: AbortSignal): Promise<void> {
  try {
    const { stdout } = await run('/usr/bin/python3', ['-c', PORTAL_SCREENSHOT], { signal, maxBuffer: 64 * 1024 });
    const path = fileURLToPath(stdout.trim());
    const image = nativeImage.createFromPath(path);
    if (image.isEmpty()) throw new Error('Screenshot portal returned an unreadable image');
    signal.throwIfAborted();
    const png = new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return;
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code === 10) return;
    if (code !== 11 && code !== 'ENOENT') throw error;
  }

  const desktop = process.env.XDG_CURRENT_DESKTOP?.toLowerCase() ?? '';
  const preferred = desktop.includes('kde') ? 'spectacle'
    : desktop.includes('xfce') ? 'xfce4-screenshooter' : 'gnome-screenshot';
  const tools = [...LINUX_SCREENSHOT_TOOLS].sort(([left], [right]) =>
    Number(right === preferred) - Number(left === preferred));
  for (const [command, ...args] of tools) {
    try {
      await run(command, args, { signal });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('No Linux screenshot portal or desktop screenshot tool is available');
}

export async function captureDesktopScreenshot(signal: AbortSignal): Promise<void> {
  const system = platform();
  if (system === 'darwin') {
    // macOS displays capture errors itself, and can exit nonzero on cancellation.
    await run('/usr/sbin/screencapture', ['-i', '-c', '-d'], { signal }).catch((error: NodeJS.ErrnoException) => {
      if (typeof error.code !== 'number') throw error;
    });
  } else if (system === 'win32') {
    const build = Number(release().split('.')[2]);
    const uri = build < 22000 ? 'ms-screenclip:'
      : 'ms-screenclip://capture/image?rectangle&enabledModes=RectangleSnip,WindowSnip&user-agent=xopc';
    try {
      await shell.openExternal(uri);
    } catch (error) {
      if (uri === 'ms-screenclip:') throw error;
      await shell.openExternal('ms-screenclip:');
    }
  } else if (system === 'linux') {
    await captureLinuxScreenshot(signal);
  }
}
