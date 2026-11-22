import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { app, desktopCapturer, nativeImage, screen, type Display, type NativeImage } from 'electron';

import { openMacosPrivacyPane } from '../ipc/privacy-deep-links.js';
import { rawMediaAccessStatus } from '../ipc/shell-permission-gates.js';
import { resolveVoiceInputHotkeyHelperPath } from '../voice-input-hotkey.js';

import { logicalToPhysicalRect } from './geometry.js';
import {
  captureLinuxCliScreenshot,
  captureLinuxPortalScreenshot,
  isWaylandSession,
  queryLinuxX11SnapWindows,
  runLinuxTesseractOcr,
  sendLinuxX11WheelScroll,
} from './linux-helper.js';
import type { RgbaFrame } from './stitch.js';
import type { DisplayCaptureFrame, ScreenshotOcrBlock, ScreenshotOcrResponse, ScreenshotRect, SnapWindowRect } from './types.js';
import { queryWindowsSnapList, runWindowsNativeOcr, sendWindowsWheelScroll } from './windows-helper.js';

const execFileAsync = promisify(execFile);

export interface DesktopCaptureBundle {
  status: 'ok' | 'cancelled' | 'permission_denied';
  frames: DisplayCaptureFrame[];
  windows: SnapWindowRect[];
  isWayland: boolean;
}

function macHelperPath(): string | null {
  if (process.platform !== 'darwin') return null;
  const candidate = resolveVoiceInputHotkeyHelperPath({
    platform: 'darwin',
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    mainDir: import.meta.dirname,
  });
  // When imported from `electron/screenshot/*` in unbundled tests vs `out/main` in Vite:
  if (candidate && existsSync(candidate)) return candidate;
  const repoCandidate = join(app.getAppPath(), 'dist', 'electron', 'native', 'voice-hotkey-helper');
  return existsSync(repoCandidate) ? repoCandidate : null;
}

async function queryMacSnapWindows(excludePid: number, signal?: AbortSignal): Promise<SnapWindowRect[]> {
  const helper = macHelperPath();
  if (!helper) return [];
  try {
    const { stdout } = await execFileAsync(helper, ['--window-list', String(excludePid)], {
      signal,
      timeout: 1_500,
      maxBuffer: 1024 * 1024,
    });
    const parsed = JSON.parse(stdout.trim()) as { windows?: SnapWindowRect[] };
    return Array.isArray(parsed.windows) ? parsed.windows : [];
  } catch {
    return [];
  }
}

async function runMacVisionOcr(imagePath: string, signal?: AbortSignal): Promise<ScreenshotOcrResponse | null> {
  const helper = macHelperPath();
  if (!helper) return null;
  try {
    const { stdout } = await execFileAsync(helper, ['--ocr', imagePath], {
      signal,
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout.trim()) as {
      ok?: boolean;
      text?: string;
      blocks?: ScreenshotOcrBlock[];
    };
    if (!parsed.ok) return null;
    return {
      ok: true,
      text: parsed.text ?? '',
      blocks: parsed.blocks,
      engine: 'vision',
    };
  } catch {
    return null;
  }
}

export async function sendMacWheelScroll(
  screenX: number,
  screenY: number,
  deltaY = -90,
  signal?: AbortSignal,
): Promise<boolean> {
  const helper = macHelperPath();
  if (!helper) return false;
  try {
    const { stdout } = await execFileAsync(
      helper,
      ['--scroll', String(Math.round(screenX)), String(Math.round(screenY)), String(Math.round(deltaY))],
      { signal, timeout: 1_500 },
    );
    const parsed = JSON.parse(stdout.trim()) as { ok?: boolean };
    return parsed.ok === true;
  } catch {
    return false;
  }
}

export function bgraToRgba(bgra: Uint8Array): Uint8Array {
  const out = new Uint8Array(bgra.byteLength);
  for (let i = 0; i + 3 < bgra.byteLength; i += 4) {
    out[i] = bgra[i + 2]!;
    out[i + 1] = bgra[i + 1]!;
    out[i + 2] = bgra[i]!;
    out[i + 3] = bgra[i + 3]!;
  }
  return out;
}

export function nativeImageToRgbaFrame(image: NativeImage): RgbaFrame | null {
  if (image.isEmpty()) return null;
  const size = image.getSize();
  if (size.width <= 0 || size.height <= 0) return null;
  const bitmap = image.toBitmap();
  if (bitmap.byteLength !== size.width * size.height * 4) return null;
  // Electron's toBitmap() returns BGRA on little-endian x86_64/arm64 across macOS/Windows/Linux.
  return {
    width: size.width,
    height: size.height,
    data: bgraToRgba(bitmap),
  };
}

async function captureViaDesktopCapturer(displays: readonly Display[]): Promise<Map<number, NativeImage>> {
  let maxWidth = 1920;
  let maxHeight = 1080;
  for (const d of displays) {
    maxWidth = Math.max(maxWidth, Math.round(d.bounds.width * d.scaleFactor));
    maxHeight = Math.max(maxHeight, Math.round(d.bounds.height * d.scaleFactor));
  }

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxWidth, height: maxHeight },
    fetchWindowIcons: false,
  });

  const byDisplayId = new Map<number, NativeImage>();
  for (let i = 0; i < displays.length; i += 1) {
    const display = displays[i]!;
    const matched =
      sources.find((s) => s.display_id && Number(s.display_id) === display.id) ??
      sources[i];
    if (matched && !matched.thumbnail.isEmpty()) {
      const targetW = Math.max(1, Math.round(display.bounds.width * display.scaleFactor));
      const size = matched.thumbnail.getSize();
      // Preserve native aspect ratio; only downscale proportionally if oversized.
      const image =
        size.width > targetW * 1.25
          ? matched.thumbnail.resize({ width: targetW, quality: 'best' })
          : matched.thumbnail;
      byDisplayId.set(display.id, image);
    }
  }
  return byDisplayId;
}

async function captureMacFallbackFiles(
  displays: readonly Display[],
  signal?: AbortSignal,
): Promise<Map<number, NativeImage>> {
  const result = new Map<number, NativeImage>();
  for (let idx = 0; idx < displays.length; idx += 1) {
    const display = displays[idx]!;
    const tmpPath = join(tmpdir(), `xopc-cap-${randomUUID()}.png`);
    try {
      await execFileAsync('/usr/sbin/screencapture', ['-x', '-D', String(idx + 1), tmpPath], {
        signal,
        timeout: 5_000,
      });
      const image = nativeImage.createFromPath(tmpPath);
      if (!image.isEmpty()) {
        result.set(display.id, image);
      }
    } catch {
      /* ignore individual display failure */
    } finally {
      await rm(tmpPath, { force: true }).catch(() => undefined);
    }
  }
  return result;
}

function sliceCompositeImageAcrossDisplays(
  fullImage: NativeImage,
  displays: readonly Display[],
): DisplayCaptureFrame[] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const d of displays) {
    minX = Math.min(minX, d.bounds.x);
    minY = Math.min(minY, d.bounds.y);
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
  }
  const logicalTotalW = Math.max(1, maxX - minX);
  const logicalTotalH = Math.max(1, maxY - minY);
  const imgSize = fullImage.getSize();

  const frames: DisplayCaptureFrame[] = [];
  for (const d of displays) {
    const cropRect = logicalToPhysicalRect(
      {
        x: d.bounds.x - minX,
        y: d.bounds.y - minY,
        width: d.bounds.width,
        height: d.bounds.height,
      },
      { width: logicalTotalW, height: logicalTotalH },
      imgSize,
    );
    const cropped = fullImage.crop(cropRect);
    if (cropped.isEmpty()) continue;
    const croppedSize = cropped.getSize();
    frames.push({
      displayId: d.id,
      bounds: { ...d.bounds },
      scaleFactor: d.scaleFactor,
      pixelWidth: croppedSize.width,
      pixelHeight: croppedSize.height,
      pngBase64: cropped.toPNG().toString('base64'),
    });
  }
  return frames;
}

export async function captureDesktopFrames(options: {
  excludePid?: number;
  signal?: AbortSignal;
}): Promise<DesktopCaptureBundle> {
  const { excludePid = process.pid, signal } = options;
  const displays = screen.getAllDisplays();
  const wayland = isWaylandSession();

  if (process.platform === 'darwin') {
    const status = rawMediaAccessStatus('screen');
    if (status === 'denied' || status === 'restricted') {
      await openMacosPrivacyPane('screen');
      return { status: 'permission_denied', frames: [], windows: [], isWayland: false };
    }

    const [windows, capturerMap] = await Promise.all([
      queryMacSnapWindows(excludePid, signal),
      captureViaDesktopCapturer(displays).catch(() => new Map<number, NativeImage>()),
    ]);
    signal?.throwIfAborted();

    let imagesByDisplay = capturerMap;
    if (imagesByDisplay.size === 0) {
      imagesByDisplay = await captureMacFallbackFiles(displays, signal);
    }
    if (imagesByDisplay.size === 0 && rawMediaAccessStatus('screen') !== 'granted') {
      await openMacosPrivacyPane('screen');
      return { status: 'permission_denied', frames: [], windows: [], isWayland: false };
    }

    const frames: DisplayCaptureFrame[] = [];
    for (const d of displays) {
      const img = imagesByDisplay.get(d.id);
      if (!img || img.isEmpty()) continue;
      const size = img.getSize();
      frames.push({
        displayId: d.id,
        bounds: { ...d.bounds },
        scaleFactor: d.scaleFactor,
        pixelWidth: size.width,
        pixelHeight: size.height,
        pngBase64: img.toPNG().toString('base64'),
      });
    }
    return { status: 'ok', frames, windows, isWayland: false };
  }

  if (process.platform === 'win32') {
    const metrics = displays.map((d) => ({ bounds: d.bounds, scaleFactor: d.scaleFactor }));
    const [windows, capturerMap] = await Promise.all([
      queryWindowsSnapList(excludePid, metrics, signal),
      captureViaDesktopCapturer(displays),
    ]);
    signal?.throwIfAborted();

    const frames: DisplayCaptureFrame[] = [];
    for (const d of displays) {
      const img = capturerMap.get(d.id);
      if (!img || img.isEmpty()) continue;
      const size = img.getSize();
      frames.push({
        displayId: d.id,
        bounds: { ...d.bounds },
        scaleFactor: d.scaleFactor,
        pixelWidth: size.width,
        pixelHeight: size.height,
        pngBase64: img.toPNG().toString('base64'),
      });
    }
    return { status: 'ok', frames, windows, isWayland: false };
  }

  // Linux (X11 & Wayland)
  if (!wayland) {
    const [windows, capturerMap] = await Promise.all([
      queryLinuxX11SnapWindows(excludePid, signal),
      captureViaDesktopCapturer(displays).catch(() => new Map<number, NativeImage>()),
    ]);
    signal?.throwIfAborted();

    if (capturerMap.size > 0) {
      const frames: DisplayCaptureFrame[] = [];
      for (const d of displays) {
        const img = capturerMap.get(d.id);
        if (!img || img.isEmpty()) continue;
        const size = img.getSize();
        frames.push({
          displayId: d.id,
          bounds: { ...d.bounds },
          scaleFactor: d.scaleFactor,
          pixelWidth: size.width,
          pixelHeight: size.height,
          pngBase64: img.toPNG().toString('base64'),
        });
      }
      return { status: 'ok', frames, windows, isWayland: false };
    }

    const tmpFile = join(tmpdir(), `xopc-x11-${randomUUID()}.png`);
    try {
      if (await captureLinuxCliScreenshot({ interactive: false, outputPath: tmpFile, wayland: false, signal })) {
        const fullImage = nativeImage.createFromPath(tmpFile);
        if (!fullImage.isEmpty()) {
          return {
            status: 'ok',
            frames: sliceCompositeImageAcrossDisplays(fullImage, displays),
            windows,
            isWayland: false,
          };
        }
      }
    } finally {
      await rm(tmpFile, { force: true }).catch(() => undefined);
    }
  }

  // Wayland (or X11 fallback): Tier 1 — non-interactive full-screen capture via Portal or grim.
  const nonInteractivePortal = await captureLinuxPortalScreenshot({ interactive: false, signal });
  if (nonInteractivePortal.status === 'cancelled') {
    return { status: 'cancelled', frames: [], windows: [], isWayland: wayland };
  }
  if (nonInteractivePortal.status === 'ok') {
    try {
      const img = nativeImage.createFromPath(nonInteractivePortal.filePath);
      if (!img.isEmpty()) {
        return {
          status: 'ok',
          frames: sliceCompositeImageAcrossDisplays(img, displays),
          windows: [],
          isWayland: wayland,
        };
      }
    } finally {
      await rm(nonInteractivePortal.filePath, { force: true }).catch(() => undefined);
    }
  }

  const grimTmp = join(tmpdir(), `xopc-wl-${randomUUID()}.png`);
  try {
    if (await captureLinuxCliScreenshot({ interactive: false, outputPath: grimTmp, wayland: true, signal })) {
      const img = nativeImage.createFromPath(grimTmp);
      if (!img.isEmpty()) {
        return {
          status: 'ok',
          frames: sliceCompositeImageAcrossDisplays(img, displays),
          windows: [],
          isWayland: wayland,
        };
      }
    }
  } finally {
    await rm(grimTmp, { force: true }).catch(() => undefined);
  }

  // Wayland Tier 2: Interactive Portal / DE region picker -> open captured region in xopc annotation editor!
  const interactivePortal = await captureLinuxPortalScreenshot({ interactive: true, signal });
  if (interactivePortal.status === 'cancelled') {
    return { status: 'cancelled', frames: [], windows: [], isWayland: wayland };
  }
  let regionImage: NativeImage | null = null;
  if (interactivePortal.status === 'ok') {
    try {
      regionImage = nativeImage.createFromPath(interactivePortal.filePath);
    } finally {
      await rm(interactivePortal.filePath, { force: true }).catch(() => undefined);
    }
  } else {
    const cliTmp = join(tmpdir(), `xopc-wl-region-${randomUUID()}.png`);
    try {
      if (await captureLinuxCliScreenshot({ interactive: true, outputPath: cliTmp, wayland: true, signal })) {
        regionImage = nativeImage.createFromPath(cliTmp);
      }
    } finally {
      await rm(cliTmp, { force: true }).catch(() => undefined);
    }
  }

  if (!regionImage || regionImage.isEmpty()) {
    throw new Error('No Linux screenshot portal or desktop screenshot tool is available');
  }

  const cursor = screen.getCursorScreenPoint();
  const targetDisplay = screen.getDisplayNearestPoint(cursor) ?? displays[0]!;
  const regionSize = regionImage.getSize();
  const logicalW = Math.min(
    targetDisplay.bounds.width,
    Math.max(32, Math.round(regionSize.width / targetDisplay.scaleFactor)),
  );
  const logicalH = Math.min(
    targetDisplay.bounds.height,
    Math.max(32, Math.round(regionSize.height / targetDisplay.scaleFactor)),
  );

  // Center the captured region on an opaque dark stage matching the display so toolbars have full room!
  return {
    status: 'ok',
    frames: [
      {
        displayId: targetDisplay.id,
        bounds: { ...targetDisplay.bounds },
        scaleFactor: targetDisplay.scaleFactor,
        pixelWidth: regionSize.width,
        pixelHeight: regionSize.height,
        pngBase64: regionImage.toPNG().toString('base64'),
        initialSelection: { x: 0, y: 0, width: logicalW, height: logicalH },
      },
    ],
    windows: [],
    isWayland: wayland,
  };
}

/**
 * Captures a specific display sub-region as an RGBA buffer for Phase 4 scrolling long screenshots.
 */
export async function captureDisplayRegionRgba(
  displayId: number,
  localRect: ScreenshotRect,
  signal?: AbortSignal,
): Promise<RgbaFrame | null> {
  const displays = screen.getAllDisplays();
  const display = displays.find((d) => d.id === displayId);
  if (!display) return null;

  let displayImg: NativeImage | undefined;
  if (process.platform === 'linux' && isWaylandSession()) {
    const portal = await captureLinuxPortalScreenshot({ interactive: false, signal });
    if (portal.status === 'ok') {
      try {
        const full = nativeImage.createFromPath(portal.filePath);
        const sliced = sliceCompositeImageAcrossDisplays(full, displays).find((f) => f.displayId === displayId);
        if (sliced) {
          displayImg = nativeImage.createFromBuffer(Buffer.from(sliced.pngBase64, 'base64'));
        }
      } finally {
        await rm(portal.filePath, { force: true }).catch(() => undefined);
      }
    }
  } else {
    const map = await captureViaDesktopCapturer([display]).catch(() => new Map<number, NativeImage>());
    displayImg = map.get(display.id);
    if ((!displayImg || displayImg.isEmpty()) && process.platform === 'darwin') {
      const idx = displays.findIndex((d) => d.id === displayId);
      if (idx >= 0) {
        const tmp = join(tmpdir(), `xopc-scroll-${randomUUID()}.png`);
        try {
          await execFileAsync('/usr/sbin/screencapture', ['-x', '-D', String(idx + 1), tmp], {
            signal,
            timeout: 2_500,
          });
          displayImg = nativeImage.createFromPath(tmp);
        } catch {
          /* ignore */
        } finally {
          await rm(tmp, { force: true }).catch(() => undefined);
        }
      }
    }
  }

  if (!displayImg || displayImg.isEmpty()) return null;
  const imgSize = displayImg.getSize();
  const physRect = logicalToPhysicalRect(localRect, display.bounds, imgSize);
  const cropped = displayImg.crop(physRect);
  return nativeImageToRgbaFrame(cropped);
}

export async function runPlatformLocalOcr(
  pngBuffer: Buffer,
  signal?: AbortSignal,
): Promise<ScreenshotOcrResponse | null> {
  const tmpFile = join(tmpdir(), `xopc-ocr-${randomUUID()}.png`);
  try {
    await writeFile(tmpFile, pngBuffer, { mode: 0o600 });
    if (process.platform === 'darwin') {
      return await runMacVisionOcr(tmpFile, signal);
    }
    if (process.platform === 'win32') {
      return await runWindowsNativeOcr(tmpFile, signal);
    }
    if (process.platform === 'linux') {
      return await runLinuxTesseractOcr(tmpFile, signal);
    }
    return null;
  } finally {
    await rm(tmpFile, { force: true }).catch(() => undefined);
  }
}

export function isAutoScrollSupported(): boolean {
  if (process.platform === 'darwin') {
    return Boolean(macHelperPath());
  }
  if (process.platform === 'win32') {
    return true;
  }
  if (process.platform === 'linux') {
    return !isWaylandSession();
  }
  return false;
}

export async function sendPlatformAutoScrollStep(
  displayId: number,
  localRect: ScreenshotRect,
  signal?: AbortSignal,
): Promise<boolean> {
  const display = screen.getAllDisplays().find((d) => d.id === displayId);
  if (!display) return false;
  const centerX = display.bounds.x + localRect.x + localRect.width / 2;
  const centerY = display.bounds.y + localRect.y + localRect.height / 2;

  if (process.platform === 'darwin') {
    return sendMacWheelScroll(centerX, centerY, -120, signal);
  }
  if (process.platform === 'win32') {
    const physX = display.bounds.x * display.scaleFactor + (localRect.x + localRect.width / 2) * display.scaleFactor;
    const physY = display.bounds.y * display.scaleFactor + (localRect.y + localRect.height / 2) * display.scaleFactor;
    return sendWindowsWheelScroll(physX, physY, -240, signal);
  }
  if (process.platform === 'linux') {
    return sendLinuxX11WheelScroll(centerX, centerY, 'down', signal);
  }
  return false;
}
