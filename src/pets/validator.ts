import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import { DESKTOP_PET_ACTIONS, type DesktopPetPackageAction } from './manifest.js';

export type DesktopPetValidationIssue = {
  dir: string;
  reason: string;
  details?: string[];
};

export type DesktopPetValidationResult =
  | { ok: true }
  | { ok: false; issue: DesktopPetValidationIssue };

type ManifestAnimation = {
  src: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  offsetX: number;
  offsetY: number;
};

function safeResolve(root: string, child: unknown): string | null {
  if (typeof child !== 'string' || !child.trim()) return null;
  const normalizedRoot = resolve(root);
  const candidate = resolve(root, child);
  if (candidate === normalizedRoot) return candidate;
  if (candidate.startsWith(`${normalizedRoot}\\`) || candidate.startsWith(`${normalizedRoot}/`)) return candidate;
  return null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function positiveRoundedNumber(value: unknown): number | null {
  const n = positiveNumber(value);
  if (n === null) return null;
  const rounded = Math.round(n);
  return rounded > 0 ? rounded : null;
}

function nonNegativeNumber(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function supportedImagePath(path: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extname(path).toLowerCase());
}

async function readableImage(path: string): Promise<boolean> {
  if (!supportedImagePath(path)) return false;
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function parseSvgDimension(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseSvgBounds(svg: string): { width: number; height: number } | null {
  const rootMatch = svg.match(/<svg\b[^>]*>/i);
  if (!rootMatch) return null;
  const root = rootMatch[0];
  const width = parseSvgDimension(root.match(/\bwidth=["']([^"']+)["']/i)?.[1]);
  const height = parseSvgDimension(root.match(/\bheight=["']([^"']+)["']/i)?.[1]);
  if (width && height) return { width, height };
  const viewBox = root.match(/\bviewBox=["']([^"']+)["']/i)?.[1]?.trim();
  if (!viewBox) return null;
  const parts = viewBox.split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [, , viewBoxWidth, viewBoxHeight] = parts;
  return viewBoxWidth > 0 && viewBoxHeight > 0 ? { width: viewBoxWidth, height: viewBoxHeight } : null;
}

async function imageBounds(path: string): Promise<{ width: number; height: number } | null> {
  if (extname(path).toLowerCase() !== '.svg') return null;
  try {
    return parseSvgBounds(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function parseAnimation(action: DesktopPetPackageAction, raw: unknown, details: string[]): ManifestAnimation | null {
  if (!raw || typeof raw !== 'object') {
    details.push(`${action}: animation must be an object`);
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const src = typeof obj.src === 'string' && obj.src.trim() ? obj.src.trim() : null;
  const frameWidth = positiveRoundedNumber(obj.frameWidth);
  const frameHeight = positiveRoundedNumber(obj.frameHeight);
  const frameCount = positiveRoundedNumber(obj.frameCount);
  const fps = positiveRoundedNumber(obj.fps);
  const offsetX = nonNegativeNumber(obj.offsetX, 0);
  const offsetY = nonNegativeNumber(obj.offsetY, 0);
  if (!src) details.push(`${action}: src is required`);
  if (!frameWidth || !frameHeight || !frameCount) {
    details.push(`${action}: frameWidth, frameHeight, and frameCount must be positive numbers`);
  }
  if (!fps) details.push(`${action}: fps must be a positive number`);
  if (offsetX === null || offsetY === null) details.push(`${action}: offsetX and offsetY must be non-negative numbers`);
  if (!src || !frameWidth || !frameHeight || !frameCount || !fps || offsetX === null || offsetY === null) {
    return null;
  }
  return {
    src,
    frameWidth,
    frameHeight,
    frameCount,
    fps,
    offsetX: Math.round(offsetX),
    offsetY: Math.round(offsetY),
  };
}

function estimateSheetBounds(animations: ManifestAnimation[]): Map<string, { width: number; height: number }> {
  const bounds = new Map<string, { width: number; height: number }>();
  for (const animation of animations) {
    const width = animation.offsetX + animation.frameWidth * animation.frameCount;
    const height = animation.offsetY + animation.frameHeight;
    const existing = bounds.get(animation.src);
    bounds.set(animation.src, {
      width: Math.max(existing?.width ?? 0, width),
      height: Math.max(existing?.height ?? 0, height),
    });
  }
  return bounds;
}

export async function validateDesktopPetPackage(dir: string): Promise<DesktopPetValidationResult> {
  const details: string[] = [];
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, issue: { dir, reason: 'manifest.json is missing or unreadable', details: [message] } };
  }

  if (typeof manifest.id !== 'string' || !manifest.id.trim()) details.push('id is required');
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) details.push('name is required');
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
    details.push('description is required');
  }
  if (positiveNumber(manifest.canvasWidth) === null || positiveNumber(manifest.canvasHeight) === null) {
    details.push('canvasWidth and canvasHeight must be positive numbers');
  }

  const thumbnailPath = safeResolve(dir, manifest.thumbnail);
  if (!thumbnailPath || !(await readableImage(thumbnailPath))) {
    details.push('thumbnail is required and must be a readable supported image');
  }

  const rawAnimations =
    manifest.animations && typeof manifest.animations === 'object'
      ? (manifest.animations as Record<string, unknown>)
      : null;
  if (!rawAnimations) {
    details.push('animations is required');
  }

  const animations: ManifestAnimation[] = [];
  if (rawAnimations) {
    for (const action of DESKTOP_PET_ACTIONS) {
      const animation = parseAnimation(action, rawAnimations[action], details);
      if (animation) animations.push(animation);
    }
  }

  for (const animation of animations) {
    const sourcePath = safeResolve(dir, animation.src);
    if (!sourcePath || !(await readableImage(sourcePath))) {
      details.push(`${animation.src}: image is missing, outside the pet folder, or uses an unsupported format`);
    }
  }

  const boundsBySrc = estimateSheetBounds(animations);
  for (const [src, requiredBounds] of boundsBySrc) {
    const sourcePath = safeResolve(dir, src);
    if (!sourcePath) continue;
    const actualBounds = await imageBounds(sourcePath);
    if (!actualBounds) continue;
    if (requiredBounds.width > actualBounds.width || requiredBounds.height > actualBounds.height) {
      details.push(
        `${src}: manifest needs ${requiredBounds.width}x${requiredBounds.height}, but image is ${actualBounds.width}x${actualBounds.height}`,
      );
    }
  }

  if (details.length > 0) return { ok: false, issue: { dir, reason: 'Invalid desktop pet package', details } };
  return { ok: true };
}
