import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { resolveStateDir } from '../config/paths-state.js';
import { DESKTOP_PET_ACTIONS, type DesktopPetPackageAction } from './manifest.js';
import { validateDesktopPetPackage } from './validator.js';

export { DESKTOP_PET_ACTIONS, type DesktopPetPackageAction } from './manifest.js';

export type CreateDesktopPetPackageInput = {
  id?: string;
  name?: string;
  prompt: string;
  description?: string;
  targetDir?: string;
  overwrite?: boolean;
};

export type CreateDesktopPetPackageResult = {
  id: string;
  name: string;
  description: string;
  dir: string;
  manifestPath: string;
  thumbnailPath: string;
  spritesheetPath: string;
  sourcePrompt: string;
};

const FRAME_SIZE = 96;
const MAX_FRAMES = 10;

type Palette = {
  body: string;
  accent: string;
  face: string;
  screen: string;
  cheek: string;
};

type PetStyle = {
  seed: number;
  palette: Palette;
  ears: 'round' | 'antenna' | 'leaf' | 'spark';
};

export function resolveDesktopPetsDir(): string {
  return join(resolveStateDir(), 'pets');
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function normalizePackageId(value: string): string {
  return slugify(value.replace(/^custom:/i, ''), '');
}

function titleFromPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(' ');
  return cleaned || 'Custom Pet';
}

function clampText(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}...` : trimmed;
}

function hsl(seed: number, offset: number, saturation = 74, lightness = 56): string {
  const hue = (seed + offset) % 360;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function paletteFromPrompt(prompt: string): PetStyle {
  const seed = hashString(prompt);
  const keyword = prompt.toLowerCase();
  const ears = keyword.includes('plant') || keyword.includes('leaf') || keyword.includes('seed')
    ? 'leaf'
    : keyword.includes('star') || keyword.includes('magic') || keyword.includes('spark')
      ? 'spark'
      : keyword.includes('robot') || keyword.includes('tech') || keyword.includes('signal')
        ? 'antenna'
        : 'round';
  return {
    seed,
    ears,
    palette: {
      body: hsl(seed, 0, 72, 53),
      accent: hsl(seed, 34, 82, 63),
      face: hsl(seed, 208, 70, 22),
      screen: hsl(seed, 176, 92, 78),
      cheek: hsl(seed, 318, 86, 72),
    },
  };
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function desktopPetActionFrameCount(action: DesktopPetPackageAction): number {
  if (action === 'idle') return 6;
  if (action === 'success' || action === 'error') return 8;
  return 10;
}

export function desktopPetActionFps(action: DesktopPetPackageAction): number {
  if (action === 'idle') return 6;
  if (action === 'success' || action === 'error') return 12;
  return 10;
}

export function desktopPetActionLoops(action: DesktopPetPackageAction): boolean {
  return action !== 'success' && action !== 'error';
}

function renderAccessory(action: DesktopPetPackageAction, frame: number, style: PetStyle): string {
  const t = frame / Math.max(1, desktopPetActionFrameCount(action) - 1);
  const bob = Math.sin(t * Math.PI * 2) * 2;
  const { palette } = style;
  if (action === 'typing') {
    const glow = frame % 2 === 0 ? 1 : 0.45;
    return `
      <g transform="translate(55 ${59 + bob})">
        <rect x="1" y="0" width="36" height="25" rx="5" fill="#1e3a8a" stroke="#101827" stroke-width="3"/>
        <path d="M14 8l6 5-6 5" fill="none" stroke="${palette.screen}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="${glow}"/>
        <rect x="-1" y="24" width="41" height="10" rx="4" fill="${palette.accent}" stroke="#101827" stroke-width="3"/>
        <rect x="9" y="28" width="5" height="2" rx="1" fill="#e0f2fe" opacity="${glow}"/>
        <rect x="19" y="28" width="5" height="2" rx="1" fill="#e0f2fe" opacity="${1 - glow / 3}"/>
        <rect x="29" y="28" width="5" height="2" rx="1" fill="#e0f2fe" opacity="${glow}"/>
      </g>`;
  }
  if (action === 'toolbox') {
    const open = frame % 2 === 0 ? -11 : -3;
    return `
      <g transform="translate(6 ${61 + bob})">
        <rect x="6" y="17" width="36" height="21" rx="6" fill="#fb923c" stroke="#101827" stroke-width="3"/>
        <rect x="11" y="${8 + open / 4}" width="26" height="12" rx="6" fill="#fdba74" stroke="#101827" stroke-width="3" transform="rotate(${open} 11 20)"/>
        <path d="M18 9h12v7H18z" fill="none" stroke="#101827" stroke-width="3"/>
        <rect x="17" y="${10 + open / 2}" width="5" height="17" rx="2" fill="#e5e7eb" stroke="#101827" stroke-width="2" transform="rotate(-24 19 26)"/>
        <rect x="29" y="${8 + open / 2}" width="5" height="17" rx="2" fill="#e5e7eb" stroke="#101827" stroke-width="2" transform="rotate(25 31 24)"/>
      </g>`;
  }
  if (action === 'search') {
    return `
      <g transform="translate(58 ${58 + bob}) rotate(${frame % 2 === 0 ? -7 : 4} 18 18)">
        <circle cx="15" cy="14" r="11" fill="#e0f2fe" stroke="${palette.accent}" stroke-width="5"/>
        <rect x="24" y="24" width="17" height="7" rx="3" fill="${palette.accent}" stroke="#101827" stroke-width="3" transform="rotate(43 24 24)"/>
      </g>`;
  }
  if (action === 'file') {
    return `
      <g transform="translate(59 ${55 + bob}) rotate(${frame % 2 === 0 ? -5 : 5} 16 20)">
        <path d="M5 1h22l9 9v31H5z" fill="#eff6ff" stroke="#101827" stroke-width="3" stroke-linejoin="round"/>
        <path d="M27 1v10h9" fill="${palette.accent}" stroke="#101827" stroke-width="3" stroke-linejoin="round"/>
        <rect x="12" y="20" width="16" height="3" rx="1.5" fill="${palette.body}"/>
        <rect x="12" y="28" width="12" height="3" rx="1.5" fill="${palette.body}"/>
      </g>`;
  }
  if (action === 'terminal') {
    return `
      <g transform="translate(55 ${61 + bob})">
        <rect x="0" y="0" width="39" height="29" rx="7" fill="#111827" stroke="#101827" stroke-width="3"/>
        <path d="M10 10l6 5-6 5" fill="none" stroke="#86efac" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="${frame % 2 === 0 ? 1 : 0.4}"/>
        <path d="M20 20h9" stroke="#86efac" stroke-width="3" stroke-linecap="round"/>
      </g>`;
  }
  if (action === 'browser') {
    return `
      <g transform="translate(55 ${58 + bob})">
        <rect x="0" y="0" width="40" height="31" rx="7" fill="#e0f2fe" stroke="#101827" stroke-width="3"/>
        <path d="M1 11h38" stroke="${palette.accent}" stroke-width="8"/>
        <circle cx="10" cy="10" r="2" fill="#101827"/>
        <circle cx="17" cy="10" r="2" fill="#101827"/>
        <rect x="11" y="21" width="20" height="4" rx="2" fill="${palette.body}"/>
      </g>`;
  }
  if (action === 'success') {
    return `
      <g fill="#facc15" transform="translate(61 ${12 + bob})">
        <path d="M12 0l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/>
        <path d="M-12 18l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" opacity="0.78"/>
      </g>`;
  }
  if (action === 'error') {
    return `
      <g transform="translate(61 ${56 + bob})">
        <path d="M18 0l18 32H0z" fill="#facc15" stroke="#101827" stroke-width="3" stroke-linejoin="round"/>
        <text x="18" y="26" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="900" fill="#101827">!</text>
      </g>`;
  }
  return '';
}

function renderHead(style: PetStyle): string {
  const { palette } = style;
  if (style.ears === 'antenna') {
    return `
      <path d="M34 19l-5-10" stroke="#101827" stroke-width="3" stroke-linecap="round"/>
      <circle cx="28" cy="8" r="4" fill="${palette.accent}" stroke="#101827" stroke-width="2"/>
      <path d="M65 18l7-9" stroke="#101827" stroke-width="3" stroke-linecap="round"/>
      <circle cx="74" cy="8" r="4" fill="${palette.accent}" stroke="#101827" stroke-width="2"/>`;
  }
  if (style.ears === 'leaf') {
    return `
      <path d="M42 19c-8-13 7-18 16-10-1 11-9 15-16 10z" fill="#84cc16" stroke="#101827" stroke-width="3"/>
      <path d="M48 16l9-8" stroke="#365314" stroke-width="2" stroke-linecap="round"/>`;
  }
  if (style.ears === 'spark') {
    return `
      <path d="M45 4l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#facc15" stroke="#101827" stroke-width="3"/>`;
  }
  return `
    <circle cx="29" cy="22" r="13" fill="${palette.accent}" stroke="#101827" stroke-width="3"/>
    <circle cx="66" cy="22" r="13" fill="${palette.accent}" stroke="#101827" stroke-width="3"/>`;
}

function renderFrame(style: PetStyle, action: DesktopPetPackageAction, frame: number): string {
  const t = frame / Math.max(1, desktopPetActionFrameCount(action) - 1);
  const bob = Math.sin(t * Math.PI * 2) * (action === 'idle' ? 2.5 : 1.5);
  const tilt = action === 'toolbox' ? Math.sin(t * Math.PI * 2) * 2.5 : 0;
  const { palette } = style;
  const face = action === 'error' ? '#3f0f18' : palette.face;
  const eye = action === 'error' ? '#fca5a5' : palette.screen;
  const mouth = action === 'success' ? 'M39 45q5 5 10 0' : 'M42 46h9';
  const leftArm = action === 'typing' ? 23 + (frame % 2) * 13 : action === 'toolbox' ? 39 + (frame % 2) * 10 : 9;
  const rightArm = action === 'typing' ? -23 - (frame % 2) * 13 : action === 'toolbox' ? -39 - (frame % 2) * 10 : -9;
  return `
    <g transform="translate(0 ${bob}) rotate(${tilt} 48 76)">
      ${renderHead(style)}
      <rect x="21" y="24" width="58" height="45" rx="16" fill="${palette.body}" stroke="#101827" stroke-width="4"/>
      <rect x="32" y="36" width="38" height="23" rx="8" fill="${face}"/>
      <path d="M41 48q3 -5 6 0" fill="none" stroke="${eye}" stroke-width="3" stroke-linecap="round"/>
      <path d="M56 48q3 -5 6 0" fill="none" stroke="${eye}" stroke-width="3" stroke-linecap="round"/>
      <path d="${mouth}" fill="none" stroke="${eye}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="32" cy="56" r="3" fill="${palette.cheek}" opacity="0.72"/>
      <circle cx="69" cy="56" r="3" fill="${palette.cheek}" opacity="0.72"/>
      <rect x="36" y="66" width="32" height="21" rx="8" fill="${palette.body}" stroke="#101827" stroke-width="4"/>
      <path d="M43 77h13" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.8"/>
      <rect x="22" y="70" width="13" height="20" rx="7" fill="${palette.body}" stroke="#101827" stroke-width="3" transform="rotate(${leftArm} 29 80)"/>
      <rect x="68" y="70" width="13" height="20" rx="7" fill="${palette.body}" stroke="#101827" stroke-width="3" transform="rotate(${rightArm} 75 80)"/>
      <rect x="39" y="83" width="13" height="8" rx="4" fill="${palette.body}" stroke="#101827" stroke-width="3"/>
      <rect x="55" y="83" width="13" height="8" rx="4" fill="${palette.body}" stroke="#101827" stroke-width="3"/>
    </g>
    ${renderAccessory(action, frame, style)}`;
}

function renderSpritesheet(prompt: string): string {
  const style = paletteFromPrompt(prompt);
  const width = FRAME_SIZE * MAX_FRAMES;
  const height = FRAME_SIZE * DESKTOP_PET_ACTIONS.length;
  const frames = DESKTOP_PET_ACTIONS.flatMap((action, row) =>
    Array.from({ length: MAX_FRAMES }, (_, frame) => {
      const visible = frame < desktopPetActionFrameCount(action);
      return `<g transform="translate(${frame * FRAME_SIZE} ${row * FRAME_SIZE})">${visible ? renderFrame(style, action, frame) : ''}</g>`;
    }),
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="none"/>
    ${frames}
  </svg>`;
}

function renderThumbnail(name: string, prompt: string): string {
  const style = paletteFromPrompt(prompt);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME_SIZE}" height="${FRAME_SIZE}" viewBox="0 0 ${FRAME_SIZE} ${FRAME_SIZE}">
    <rect width="${FRAME_SIZE}" height="${FRAME_SIZE}" rx="20" fill="none"/>
    ${renderFrame(style, 'idle', 0)}
    <title>${esc(name)}</title>
  </svg>`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolvePackageDir(targetRoot: string, id: string, overwrite: boolean): Promise<{ dir: string; id: string }> {
  let nextId = id;
  let dir = join(targetRoot, nextId);
  if (overwrite || !(await pathExists(dir))) return { dir, id: nextId };
  for (let i = 2; i < 100; i += 1) {
    nextId = `${id}-${i}`;
    dir = join(targetRoot, nextId);
    if (!(await pathExists(dir))) return { dir, id: nextId };
  }
  const suffix = Date.now().toString(36);
  nextId = `${id}-${suffix}`;
  return { dir: join(targetRoot, nextId), id: nextId };
}

async function readExistingManifest(dir: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function assertChildPath(root: string, child: string): void {
  const normalizedRoot = resolve(root);
  const normalizedChild = resolve(child);
  if (
    normalizedChild !== normalizedRoot &&
    !normalizedChild.startsWith(`${normalizedRoot}\\`) &&
    !normalizedChild.startsWith(`${normalizedRoot}/`)
  ) {
    throw new Error(`Refusing to publish pet package outside target directory: ${normalizedChild}`);
  }
}

async function publishPackageDir(targetRoot: string, tempDir: string, finalDir: string, overwrite: boolean): Promise<void> {
  assertChildPath(targetRoot, tempDir);
  assertChildPath(targetRoot, finalDir);
  if (!overwrite || !(await pathExists(finalDir))) {
    await rename(tempDir, finalDir);
    return;
  }

  const backupDir = `${finalDir}.backup-${Date.now().toString(36)}`;
  assertChildPath(targetRoot, backupDir);
  await rename(finalDir, backupDir);
  let published = false;
  try {
    await rename(tempDir, finalDir);
    published = true;
  } catch (e) {
    if (!(await pathExists(finalDir)) && (await pathExists(backupDir))) {
      await rename(backupDir, finalDir);
    }
    throw e;
  }
  if (published) {
    await rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function createDesktopPetPackage(
  input: CreateDesktopPetPackageInput,
): Promise<CreateDesktopPetPackageResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error('prompt is required');
  }
  const targetRoot = input.targetDir ?? resolveDesktopPetsDir();
  await mkdir(targetRoot, { recursive: true });
  const requestedId = input.id?.trim() ? normalizePackageId(input.id) : null;
  const initialId = requestedId || slugify(input.name?.trim() || titleFromPrompt(prompt), `pet-${hashString(prompt).toString(36)}`);
  const { id, dir } = await resolvePackageDir(
    targetRoot,
    initialId,
    input.overwrite === true,
  );
  const existingManifest = input.overwrite === true ? await readExistingManifest(dir) : null;
  const existingName = typeof existingManifest?.name === 'string' ? existingManifest.name.trim() : '';
  const baseName = clampText(input.name?.trim() || existingName || titleFromPrompt(prompt), 36);
  const description = clampText(
    input.description?.trim() || `Custom pet generated from: ${prompt}`,
    120,
  );

  const tempDir = await mkdtemp(join(targetRoot, `.tmp-${id}-`));
  const spritesheetPath = join(tempDir, 'pet.svg');
  const thumbnailPath = join(tempDir, 'thumbnail.svg');
  const manifestPath = join(tempDir, 'manifest.json');
  const manifest = {
    id,
    name: baseName,
    description,
    sourcePrompt: prompt,
    generatedAt: new Date().toISOString(),
    thumbnail: 'thumbnail.svg',
    canvasWidth: FRAME_SIZE,
    canvasHeight: FRAME_SIZE,
    animations: Object.fromEntries(
      DESKTOP_PET_ACTIONS.map((action, row) => [
        action,
        {
          src: 'pet.svg',
          frameWidth: FRAME_SIZE,
          frameHeight: FRAME_SIZE,
          frameCount: desktopPetActionFrameCount(action),
          fps: desktopPetActionFps(action),
          loop: desktopPetActionLoops(action),
          offsetX: 0,
          offsetY: row * FRAME_SIZE,
        },
      ]),
    ),
  };

  try {
    await writeFile(spritesheetPath, renderSpritesheet(prompt), 'utf8');
    await writeFile(thumbnailPath, renderThumbnail(baseName, prompt), 'utf8');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const validation = await validateDesktopPetPackage(tempDir);
    if (validation.ok === false) {
      const detailText = validation.issue.details?.length ? `: ${validation.issue.details.join('; ')}` : '';
      throw new Error(`${validation.issue.reason}${detailText}`);
    }
    await publishPackageDir(targetRoot, tempDir, dir, input.overwrite === true);
  } catch (e) {
    if (await pathExists(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
    throw e;
  }

  return {
    id,
    name: baseName,
    description,
    dir,
    manifestPath: join(dir, 'manifest.json'),
    thumbnailPath: join(dir, 'thumbnail.svg'),
    spritesheetPath: join(dir, 'pet.svg'),
    sourcePrompt: prompt,
  };
}
