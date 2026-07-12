import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

import { app } from 'electron';

import { resolveStateDir } from '../../src/config/paths-state.js';
import { validateDesktopPetPackage } from '../../src/pets/validator.js';
import type {
  DesktopPetAction,
  DesktopPetAnimation,
  DesktopPetBounds,
  DesktopPetDefinition,
  DesktopPetIssue,
  DesktopPetPrefs,
  DesktopPetState,
} from './types.js';

const PREFS_FILE = 'desktop-pet.json';
const PETS_DIR = 'pets';
const FRAME_SIZE = 96;
const PET_ACTIONS: DesktopPetAction[] = [
  'idle',
  'typing',
  'toolbox',
  'search',
  'file',
  'terminal',
  'browser',
  'success',
  'error',
];

type BuiltInPetKind =
  | 'ember'
  | 'relay'
  | 'loom'
  | 'scout'
  | 'forge'
  | 'sprout'
  | 'atlas'
  | 'pulse'
  | 'patch';

type BuiltInPetPalette = {
  id: string;
  i18nKey: string;
  name: string;
  description: string;
  kind: BuiltInPetKind;
  accent: string;
  accent2: string;
  body: string;
  face: string;
  screen: string;
  highlight: string;
};

const builtInPetPalettes: BuiltInPetPalette[] = [
  {
    id: 'ember',
    i18nKey: 'ember',
    name: '逐焰',
    description: '给日常代理工作一点温热的推进感。',
    kind: 'ember',
    accent: '#fb923c',
    accent2: '#fb7185',
    body: '#f97316',
    face: '#431407',
    screen: '#fff7ad',
    highlight: '#ffedd5',
  },
  {
    id: 'relay',
    i18nKey: 'relay',
    name: '信铃',
    description: '在不同应用和渠道之间传递消息。',
    kind: 'relay',
    accent: '#38bdf8',
    accent2: '#22d3ee',
    body: '#0ea5e9',
    face: '#083344',
    screen: '#cffafe',
    highlight: '#f0f9ff',
  },
  {
    id: 'loom',
    i18nKey: 'loom',
    name: '织忆',
    description: '把上下文、笔记和记忆织在一起。',
    kind: 'loom',
    accent: '#c084fc',
    accent2: '#f0abfc',
    body: '#7c3aed',
    face: '#2e1065',
    screen: '#f5d0fe',
    highlight: '#e9d5ff',
  },
  {
    id: 'scout',
    i18nKey: 'scout',
    name: '探光',
    description: '帮你从信息里找到真正有用的线索。',
    kind: 'scout',
    accent: '#facc15',
    accent2: '#f59e0b',
    body: '#d97706',
    face: '#422006',
    screen: '#fef3c7',
    highlight: '#fde68a',
  },
  {
    id: 'forge',
    i18nKey: 'forge',
    name: '铸匠',
    description: '陪你构建、修复和调用工具。',
    kind: 'forge',
    accent: '#cbd5e1',
    accent2: '#38bdf8',
    body: '#64748b',
    face: '#0f172a',
    screen: '#bae6fd',
    highlight: '#e2e8f0',
  },
  {
    id: 'sprout',
    i18nKey: 'sprout',
    name: '新芽',
    description: '给新的工作流和想法留出生长空间。',
    kind: 'sprout',
    accent: '#84cc16',
    accent2: '#22c55e',
    body: '#a3e635',
    face: '#365314',
    screen: '#ecfccb',
    highlight: '#d9f99d',
  },
  {
    id: 'atlas',
    i18nKey: 'atlas',
    name: '叠境',
    description: '为大型工作区提供清晰的结构感。',
    kind: 'atlas',
    accent: '#60a5fa',
    accent2: '#818cf8',
    body: '#2563eb',
    face: '#172554',
    screen: '#dbeafe',
    highlight: '#bfdbfe',
  },
  {
    id: 'pulse',
    i18nKey: 'pulse',
    name: '脉点',
    description: '感知网关、自动化和持续运行的状态。',
    kind: 'pulse',
    accent: '#f472b6',
    accent2: '#fb7185',
    body: '#db2777',
    face: '#500724',
    screen: '#fce7f3',
    highlight: '#f9a8d4',
  },
  {
    id: 'patch',
    i18nKey: 'patch',
    name: '补丁',
    description: '适合陪你做细致改动和审阅差异。',
    kind: 'patch',
    accent: '#2dd4bf',
    accent2: '#5eead4',
    body: '#0f766e',
    face: '#134e4a',
    screen: '#ccfbf1',
    highlight: '#99f6e4',
  },
];

export const defaultDesktopPetPrefs: DesktopPetPrefs = {
  enabled: false,
  showOnStartup: false,
  selectedPetId: 'ember',
  alwaysOnTop: true,
  bubbleEnabled: true,
  clickThroughWhenIdle: false,
  muted: false,
  feedbackLevel: 'normal',
  sizePercent: 100,
  collapsed: false,
};

function prefsPath(): string {
  return join(app.getPath('userData'), PREFS_FILE);
}

export function desktopPetCustomDir(): string {
  return join(resolveStateDir(), PETS_DIR);
}

function clampSizePercent(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : defaultDesktopPetPrefs.sizePercent;
  return Math.min(140, Math.max(70, Math.round(n)));
}

function normalizeBounds(value: unknown): DesktopPetBounds | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const b = value as Partial<DesktopPetBounds>;
  if (
    typeof b.x !== 'number' ||
    typeof b.y !== 'number' ||
    typeof b.width !== 'number' ||
    typeof b.height !== 'number'
  ) {
    return undefined;
  }
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.max(180, Math.round(b.width)),
    height: Math.max(140, Math.round(b.height)),
  };
}

function normalizePrefs(raw: unknown): DesktopPetPrefs {
  const obj = raw && typeof raw === 'object' ? (raw as Partial<DesktopPetPrefs>) : {};
  const feedbackLevel =
    obj.feedbackLevel === 'quiet' || obj.feedbackLevel === 'normal' || obj.feedbackLevel === 'chatty'
      ? obj.feedbackLevel
      : defaultDesktopPetPrefs.feedbackLevel;
  return {
    ...defaultDesktopPetPrefs,
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : defaultDesktopPetPrefs.enabled,
    showOnStartup:
      typeof obj.showOnStartup === 'boolean' ? obj.showOnStartup : defaultDesktopPetPrefs.showOnStartup,
    selectedPetId:
      typeof obj.selectedPetId === 'string' && obj.selectedPetId.trim()
        ? obj.selectedPetId.trim()
        : defaultDesktopPetPrefs.selectedPetId,
    alwaysOnTop:
      typeof obj.alwaysOnTop === 'boolean' ? obj.alwaysOnTop : defaultDesktopPetPrefs.alwaysOnTop,
    bubbleEnabled:
      typeof obj.bubbleEnabled === 'boolean' ? obj.bubbleEnabled : defaultDesktopPetPrefs.bubbleEnabled,
    clickThroughWhenIdle:
      typeof obj.clickThroughWhenIdle === 'boolean'
        ? obj.clickThroughWhenIdle
        : defaultDesktopPetPrefs.clickThroughWhenIdle,
    muted: typeof obj.muted === 'boolean' ? obj.muted : defaultDesktopPetPrefs.muted,
    feedbackLevel,
    sizePercent: clampSizePercent(obj.sizePercent),
    collapsed: typeof obj.collapsed === 'boolean' ? obj.collapsed : defaultDesktopPetPrefs.collapsed,
    bounds: normalizeBounds(obj.bounds),
  };
}

export async function readDesktopPetPrefs(): Promise<DesktopPetPrefs> {
  try {
    const text = await readFile(prefsPath(), 'utf8');
    return normalizePrefs(JSON.parse(text));
  } catch {
    return defaultDesktopPetPrefs;
  }
}

export async function writeDesktopPetPrefs(prefs: DesktopPetPrefs): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(prefsPath(), `${JSON.stringify(normalizePrefs(prefs), null, 2)}\n`, 'utf8');
}

export async function patchDesktopPetPrefs(patch: Partial<DesktopPetPrefs>): Promise<DesktopPetPrefs> {
  const current = await readDesktopPetPrefs();
  const next = normalizePrefs({ ...current, ...patch });
  await writeDesktopPetPrefs(next);
  return next;
}

function mimeForImagePath(path: string): string | null {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return null;
}

function safeResolve(root: string, child: unknown): string | null {
  if (typeof child !== 'string' || !child.trim()) return null;
  const candidate = resolve(root, child);
  const normalizedRoot = resolve(root);
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}\\`) && !candidate.startsWith(`${normalizedRoot}/`)) {
    return null;
  }
  return candidate;
}

async function imageToDataUrl(path: string): Promise<string | null> {
  const mime = mimeForImagePath(path);
  if (!mime) return null;
  try {
    const data = await readFile(path);
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function actionFrameCount(action: DesktopPetAction): number {
  if (action === 'success' || action === 'error') return 8;
  if (action === 'idle') return 6;
  return 10;
}

function actionFps(action: DesktopPetAction): number {
  if (action === 'idle') return 6;
  if (action === 'success' || action === 'error') return 12;
  return 10;
}

function actionLoops(action: DesktopPetAction): boolean {
  return action !== 'success' && action !== 'error';
}

const PET_OUTLINE = '#111827';

function renderBuiltInFace(
  faceColor: string,
  eye: string,
  mouth: string,
  x = 32,
  y = 36,
  width = 38,
  height = 23,
  rx = 8,
): string {
  const leftEyeX = x + 9;
  const rightEyeX = x + width - 14;
  const eyeY = y + 12;
  const mouthOffsetX = x + Math.round(width / 2) - 9;
  const mouthOffsetY = y + 10;
  return `
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${faceColor}"/>
      <path d="M${leftEyeX} ${eyeY}q3 -5 6 0" fill="none" stroke="${eye}" stroke-width="3" stroke-linecap="round"/>
      <path d="M${rightEyeX} ${eyeY}q3 -5 6 0" fill="none" stroke="${eye}" stroke-width="3" stroke-linecap="round"/>
      <path d="${mouth}" fill="none" stroke="${eye}" stroke-width="3" stroke-linecap="round" transform="translate(${mouthOffsetX - 42} ${mouthOffsetY - 46})"/>`;
}

function renderBuiltInIdentityDetails(palette: BuiltInPetPalette, frame: number): string {
  const pulse = Math.sin((frame / 9) * Math.PI * 2);
  if (palette.kind === 'ember') {
    return `
      <path d="M26 28c-7-13 4-22 10-27 0 9 11 12 5 27z" fill="${palette.accent}" stroke="${PET_OUTLINE}" stroke-width="3"/>
      <path d="M61 24c-2-12 8-17 11-24 3 9 10 14 2 27z" fill="${palette.accent2}" stroke="${PET_OUTLINE}" stroke-width="3"/>
      <path d="M75 68c13 2 15 14 5 21 1-9-7-11-12-15z" fill="${palette.accent2}" stroke="${PET_OUTLINE}" stroke-width="3"/>`;
  }
  if (palette.kind === 'relay') {
    return `
      <path d="M33 25L24 8" stroke="${PET_OUTLINE}" stroke-width="3" stroke-linecap="round"/>
      <path d="M65 25L77 9" stroke="${PET_OUTLINE}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="23" cy="7" r="5" fill="${palette.accent2}" stroke="${PET_OUTLINE}" stroke-width="2"/>
      <circle cx="78" cy="8" r="5" fill="${palette.accent2}" stroke="${PET_OUTLINE}" stroke-width="2"/>
      <path d="M14 24q-7 10 0 20M85 24q7 10 0 20" fill="none" stroke="${palette.highlight}" stroke-width="3" stroke-linecap="round" opacity="${0.55 + Math.abs(pulse) * 0.35}"/>`;
  }
  if (palette.kind === 'loom') {
    return `
      <path d="M18 45c9-31 49-31 60 0" fill="none" stroke="${palette.accent2}" stroke-width="10" stroke-linecap="round"/>
      <path d="M22 65c13 18 39 18 52 0" fill="none" stroke="${palette.highlight}" stroke-width="8" stroke-linecap="round"/>`;
  }
  if (palette.kind === 'scout') {
    return `
      <path d="M20 24l17-11 8 17z" fill="${palette.accent2}" stroke="${PET_OUTLINE}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M75 24L58 13l-8 17z" fill="${palette.accent2}" stroke="${PET_OUTLINE}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M25 60c-7 6-9 15-2 23" fill="none" stroke="${palette.highlight}" stroke-width="5" stroke-linecap="round"/>
      <path d="M73 60c7 6 9 15 2 23" fill="none" stroke="${palette.highlight}" stroke-width="5" stroke-linecap="round"/>`;
  }
  if (palette.kind === 'forge') {
    return `
      <rect x="25" y="12" width="10" height="16" rx="3" fill="${palette.highlight}" stroke="${PET_OUTLINE}" stroke-width="3" transform="rotate(-18 30 20)"/>
      <rect x="62" y="12" width="10" height="16" rx="3" fill="${palette.highlight}" stroke="${PET_OUTLINE}" stroke-width="3" transform="rotate(18 67 20)"/>
      <circle cx="73" cy="70" r="11" fill="${palette.accent2}" stroke="${PET_OUTLINE}" stroke-width="3"/>
      <path d="M73 62v16M65 70h16" stroke="${PET_OUTLINE}" stroke-width="3" stroke-linecap="round"/>`;
  }
  if (palette.kind === 'sprout') {
    return `
      <path d="M45 23c-10-18 11-23 20-13-1 14-11 19-20 13z" fill="${palette.accent2}" stroke="${PET_OUTLINE}" stroke-width="3"/>
      <path d="M51 20l12-11" stroke="${palette.face}" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M36 25c-11-9-3-21 10-19 5 11 0 18-10 19z" fill="${palette.highlight}" stroke="${PET_OUTLINE}" stroke-width="3"/>`;
  }
  if (palette.kind === 'atlas') {
    return `
      <rect x="20" y="20" width="55" height="17" rx="6" fill="${palette.accent2}" stroke="${PET_OUTLINE}" stroke-width="3"/>
      <rect x="16" y="37" width="63" height="17" rx="6" fill="${palette.highlight}" stroke="${PET_OUTLINE}" stroke-width="3"/>
      <rect x="22" y="54" width="55" height="17" rx="6" fill="${palette.accent}" stroke="${PET_OUTLINE}" stroke-width="3"/>`;
  }
  if (palette.kind === 'pulse') {
    return `
      <circle cx="49" cy="53" r="${33 + Math.abs(pulse) * 2}" fill="none" stroke="${palette.highlight}" stroke-width="4" opacity="0.8"/>
      <circle cx="49" cy="53" r="${42 + Math.abs(pulse) * 2}" fill="none" stroke="${palette.accent2}" stroke-width="3" opacity="0.45"/>`;
  }
  return `
      <rect x="22" y="18" width="19" height="13" rx="4" fill="${palette.highlight}" stroke="${PET_OUTLINE}" stroke-width="3"/>
      <path d="M26 24h11M30 20v9" stroke="${palette.face}" stroke-width="2" stroke-linecap="round"/>
      <path d="M66 35h10M66 45h10M66 55h10" stroke="${palette.highlight}" stroke-width="3" stroke-linecap="round"/>`;
}

function renderBuiltInBody(
  palette: BuiltInPetPalette,
  faceColor: string,
  eye: string,
  mouth: string,
  leftArm: number,
  rightArm: number,
): string {
  if (palette.kind === 'pulse') {
    return `
      <circle cx="49" cy="53" r="28" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="4"/>
      ${renderBuiltInFace(faceColor, eye, mouth, 31, 41, 36, 22, 11)}
      <circle cx="34" cy="76" r="7" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="3"/>
      <circle cx="62" cy="76" r="7" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="3"/>`;
  }
  if (palette.kind === 'forge') {
    return `
      <path d="M23 35l11-12h34l12 13v28L68 78H33L22 64z" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="4" stroke-linejoin="round"/>
      ${renderBuiltInFace(faceColor, eye, mouth, 32, 38, 37, 22, 5)}
      <rect x="36" y="67" width="30" height="17" rx="5" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="4"/>
      <rect x="40" y="82" width="12" height="8" rx="3" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="3"/>
      <rect x="56" y="82" width="12" height="8" rx="3" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="3"/>`;
  }
  if (palette.kind === 'atlas') {
    return `
      <rect x="25" y="27" width="50" height="42" rx="12" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="4"/>
      ${renderBuiltInFace(faceColor, eye, mouth, 33, 37, 35, 22, 7)}
      <rect x="33" y="67" width="34" height="20" rx="7" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="4"/>
      <path d="M41 77h17" stroke="${palette.highlight}" stroke-width="3" stroke-linecap="round"/>
      <rect x="22" y="70" width="13" height="20" rx="7" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="3" transform="rotate(${leftArm} 29 80)"/>
      <rect x="68" y="70" width="13" height="20" rx="7" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="3" transform="rotate(${rightArm} 75 80)"/>`;
  }
  if (palette.kind === 'loom') {
    return `
      <path d="M23 31c12-13 40-13 53 1v35c-11 13-40 14-53 0z" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="4"/>
      ${renderBuiltInFace(faceColor, eye, mouth, 31, 38, 38, 22, 10)}
      <path d="M35 69c8 7 22 7 30 0v14c-9 7-21 7-30 0z" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="4"/>
      <rect x="22" y="70" width="13" height="20" rx="7" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="3" transform="rotate(${leftArm} 29 80)"/>
      <rect x="68" y="70" width="13" height="20" rx="7" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="3" transform="rotate(${rightArm} 75 80)"/>`;
  }
  if (palette.kind === 'scout') {
    return `
      <ellipse cx="49" cy="50" rx="31" ry="28" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="4"/>
      ${renderBuiltInFace(faceColor, eye, mouth, 30, 38, 40, 23, 12)}
      <path d="M37 70c5 6 19 6 25 0v15H37z" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="4" stroke-linejoin="round"/>
      <rect x="39" y="83" width="12" height="8" rx="4" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="3"/>
      <rect x="55" y="83" width="12" height="8" rx="4" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="3"/>`;
  }
  return `
      <rect x="22" y="25" width="58" height="45" rx="15" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="4"/>
      ${renderBuiltInFace(faceColor, eye, mouth)}
      <circle cx="32" cy="56" r="3" fill="${palette.highlight}" opacity="0.74"/>
      <circle cx="69" cy="56" r="3" fill="${palette.highlight}" opacity="0.74"/>
      <rect x="36" y="66" width="32" height="21" rx="8" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="4"/>
      <path d="M43 77h13" stroke="${palette.highlight}" stroke-width="3" stroke-linecap="round"/>
      <rect x="22" y="70" width="13" height="20" rx="7" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="3" transform="rotate(${leftArm} 29 80)"/>
      <rect x="68" y="70" width="13" height="20" rx="7" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="3" transform="rotate(${rightArm} 75 80)"/>
      <rect x="39" y="83" width="13" height="8" rx="4" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="3"/>
      <rect x="55" y="83" width="13" height="8" rx="4" fill="${palette.body}" stroke="${PET_OUTLINE}" stroke-width="3"/>`;
}

function renderBuiltInTool(action: DesktopPetAction, frame: number, palette: BuiltInPetPalette): string {
  const bob = Math.sin((frame / Math.max(1, actionFrameCount(action) - 1)) * Math.PI * 2) * 2;
  if (action === 'typing') {
    const keyOpacity = frame % 2 === 0 ? 0.95 : 0.45;
    return `
      <g transform="translate(54 ${58 + bob})">
        <rect x="3" y="0" width="30" height="24" rx="4" fill="#1e3a8a" stroke="#111827" stroke-width="3"/>
        <path d="M14 8l5 5-5 5" fill="none" stroke="${palette.screen}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="0" y="23" width="39" height="10" rx="4" fill="#2563eb" stroke="#111827" stroke-width="3"/>
        <rect x="10" y="27" width="4" height="2" rx="1" fill="#bfdbfe" opacity="${keyOpacity}"/>
        <rect x="18" y="27" width="4" height="2" rx="1" fill="#bfdbfe" opacity="${1 - keyOpacity / 2}"/>
        <rect x="26" y="27" width="4" height="2" rx="1" fill="#bfdbfe" opacity="${keyOpacity}"/>
      </g>`;
  }
  if (action === 'toolbox') {
    const open = frame % 2 === 0 ? -10 : -2;
    return `
      <g transform="translate(8 ${60 + bob})">
        <rect x="5" y="17" width="35" height="20" rx="6" fill="#f97316" stroke="#111827" stroke-width="3"/>
        <rect x="9" y="${8 + open / 4}" width="27" height="12" rx="6" fill="#fb923c" stroke="#111827" stroke-width="3" transform="rotate(${open} 9 20)"/>
        <path d="M17 9h10v7H17z" fill="none" stroke="#111827" stroke-width="3"/>
        <rect x="16" y="${10 + open / 2}" width="5" height="16" rx="2" fill="#e5e7eb" stroke="#111827" stroke-width="2" transform="rotate(-24 18 26)"/>
        <rect x="27" y="${8 + open / 2}" width="5" height="16" rx="2" fill="#e5e7eb" stroke="#111827" stroke-width="2" transform="rotate(25 29 24)"/>
      </g>`;
  }
  if (action === 'search') {
    return `
      <g transform="translate(57 ${58 + bob}) rotate(${frame % 2 === 0 ? -5 : 3} 18 18)">
        <circle cx="15" cy="14" r="11" fill="#e0f2fe" stroke="#38bdf8" stroke-width="5"/>
        <rect x="24" y="24" width="17" height="7" rx="3" fill="#38bdf8" stroke="#111827" stroke-width="3" transform="rotate(43 24 24)"/>
      </g>`;
  }
  if (action === 'file') {
    return `
      <g transform="translate(58 ${55 + bob}) rotate(${frame % 2 === 0 ? -4 : 4} 16 20)">
        <path d="M5 1h22l9 9v31H5z" fill="#eff6ff" stroke="#111827" stroke-width="3" stroke-linejoin="round"/>
        <path d="M27 1v10h9" fill="#60a5fa" stroke="#111827" stroke-width="3" stroke-linejoin="round"/>
        <rect x="12" y="20" width="16" height="3" rx="1.5" fill="#2563eb"/>
        <rect x="12" y="28" width="12" height="3" rx="1.5" fill="#2563eb"/>
      </g>`;
  }
  if (action === 'terminal') {
    return `
      <g transform="translate(54 ${60 + bob})">
        <rect x="0" y="0" width="39" height="29" rx="7" fill="#111827" stroke="#111827" stroke-width="3"/>
        <path d="M10 10l6 5-6 5" fill="none" stroke="#86efac" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="${frame % 2 === 0 ? 1 : 0.4}"/>
      </g>`;
  }
  if (action === 'browser') {
    return `
      <g transform="translate(54 ${58 + bob})">
        <rect x="0" y="0" width="40" height="31" rx="7" fill="#e0f2fe" stroke="#111827" stroke-width="3"/>
        <path d="M1 11h38" stroke="#38bdf8" stroke-width="8"/>
        <circle cx="10" cy="10" r="2" fill="#111827"/>
        <circle cx="17" cy="10" r="2" fill="#111827"/>
        <rect x="11" y="21" width="20" height="4" rx="2" fill="#0ea5e9"/>
      </g>`;
  }
  if (action === 'success') {
    return `
      <g fill="#facc15" transform="translate(62 ${12 + bob})">
        <path d="M12 0l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/>
        <path d="M-12 18l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" opacity="0.78"/>
      </g>`;
  }
  if (action === 'error') {
    return `
      <g transform="translate(62 ${56 + bob})">
        <path d="M18 0l18 32H0z" fill="#facc15" stroke="#111827" stroke-width="3" stroke-linejoin="round"/>
        <circle cx="18" cy="23" r="2.5" fill="#111827"/>
        <path d="M18 8v10" stroke="#111827" stroke-width="4" stroke-linecap="round"/>
      </g>`;
  }
  return '';
}

function renderBuiltInFrame(palette: BuiltInPetPalette, action: DesktopPetAction, frame: number): string {
  const t = frame / Math.max(1, actionFrameCount(action) - 1);
  const bob = Math.sin(t * Math.PI * 2) * (action === 'idle' ? 2.5 : 1.5);
  const tilt =
    action === 'toolbox'
      ? Math.sin(t * Math.PI * 2) * 2
      : action === 'success'
        ? Math.sin(t * Math.PI * 2) * 1.5
        : 0;
  const errorTint = action === 'error' ? '#3f0f18' : palette.face;
  const eye = action === 'error' ? '#fca5a5' : palette.screen;
  const mouth =
    action === 'success'
      ? 'M38 45q5 5 10 0'
      : action === 'error'
        ? 'M40 47q5 -4 10 0'
        : 'M42 46h9';
  const workSwing = action === 'typing' || action === 'terminal' ? (frame % 2) * 12 : 0;
  const toolAction = action === 'toolbox' || action === 'file';
  const toolSwing = toolAction ? (frame % 2) * 10 : 0;
  const leftArm = action === 'typing' || action === 'terminal' ? 22 + workSwing : toolAction ? 38 + toolSwing : 10;
  const rightArm = action === 'typing' || action === 'terminal' ? -22 - workSwing : toolAction ? -38 - toolSwing : -10;
  return `
    <g transform="translate(0 ${bob}) rotate(${tilt} 48 76)">
      <g filter="url(#shadow)">
        ${renderBuiltInIdentityDetails(palette, frame)}
      </g>
      ${renderBuiltInBody(palette, errorTint, eye, mouth, leftArm, rightArm)}
    </g>
    ${renderBuiltInTool(action, frame, palette)}`;
}

function renderBuiltInSheet(palette: BuiltInPetPalette, action: DesktopPetAction, frameCount = actionFrameCount(action)): string {
  const width = FRAME_SIZE * frameCount;
  const frames = Array.from({ length: frameCount }, (_, frame) => {
    return `<g transform="translate(${frame * FRAME_SIZE} 0)">${renderBuiltInFrame(palette, action, frame)}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${FRAME_SIZE}" viewBox="0 0 ${width} ${FRAME_SIZE}">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="0" flood-color="#111827" flood-opacity="0.85"/>
      </filter>
    </defs>
    ${frames}
  </svg>`;
}

function createBuiltInAnimation(palette: BuiltInPetPalette, action: DesktopPetAction): DesktopPetAnimation {
  return {
    imageDataUrl: svgToDataUrl(renderBuiltInSheet(palette, action)),
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
    frameCount: actionFrameCount(action),
    fps: actionFps(action),
    loop: actionLoops(action),
    offsetX: 0,
    offsetY: 0,
  };
}

function createBuiltInPet(palette: BuiltInPetPalette): DesktopPetDefinition {
  const animations = Object.fromEntries(
    PET_ACTIONS.map((action) => [action, createBuiltInAnimation(palette, action)]),
  ) as Record<DesktopPetAction, DesktopPetAnimation>;
  return {
    id: palette.id,
    name: palette.name,
    description: palette.description,
    i18nKey: palette.i18nKey,
    builtin: true,
    canvasWidth: FRAME_SIZE,
    canvasHeight: FRAME_SIZE,
    thumbnailDataUrl: svgToDataUrl(renderBuiltInSheet(palette, 'idle', 1)),
    animations,
  };
}

const builtinPets: DesktopPetDefinition[] = builtInPetPalettes.map(createBuiltInPet);

function numberFromManifest(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveNumberFromManifest(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

async function loadManifestAnimation(
  dir: string,
  action: DesktopPetAction,
  raw: unknown,
  sheetBoundsBySrc: Map<string, { width: number; height: number }>,
): Promise<{ animation: DesktopPetAnimation | null; issue?: string }> {
  if (!raw || typeof raw !== 'object') {
    return { animation: null, issue: `${action}: animation must be an object` };
  }
  const obj = raw as Record<string, unknown>;
  const sourcePath = safeResolve(dir, obj.src);
  if (!sourcePath) {
    return { animation: null, issue: `${action}: src is required and must stay inside the pet folder` };
  }
  const imageDataUrl = await imageToDataUrl(sourcePath);
  if (!imageDataUrl) {
    return { animation: null, issue: `${action}: src is unreadable or uses an unsupported image format` };
  }
  const rawFrameWidth = positiveNumberFromManifest(obj.frameWidth);
  const rawFrameHeight = positiveNumberFromManifest(obj.frameHeight);
  const rawFrameCount = positiveNumberFromManifest(obj.frameCount);
  if (!rawFrameWidth || !rawFrameHeight || !rawFrameCount) {
    return {
      animation: null,
      issue: `${action}: frameWidth, frameHeight, and frameCount must be positive numbers`,
    };
  }
  const frameWidth = Math.round(rawFrameWidth);
  const frameHeight = Math.round(rawFrameHeight);
  const frameCount = Math.round(rawFrameCount);
  const fps = Math.max(1, Math.round(numberFromManifest(obj.fps, 8)));
  const offsetX = Math.max(0, Math.round(numberFromManifest(obj.offsetX, 0)));
  const offsetY = Math.max(0, Math.round(numberFromManifest(obj.offsetY, 0)));
  const sourceKey = typeof obj.src === 'string' ? obj.src : '';
  const sheetBounds = sheetBoundsBySrc.get(sourceKey);
  return {
    animation: {
      imageDataUrl,
      frameWidth,
      frameHeight,
      frameCount,
      fps,
      loop: obj.loop !== false,
      offsetX,
      offsetY,
      sheetWidth: sheetBounds?.width,
      sheetHeight: sheetBounds?.height,
    },
  };
}

function estimateManifestSheetBounds(rawAnimations: Record<string, unknown>): Map<string, { width: number; height: number }> {
  const bounds = new Map<string, { width: number; height: number }>();
  for (const raw of Object.values(rawAnimations)) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.src !== 'string' || !obj.src.trim()) continue;
    const frameWidth = positiveNumberFromManifest(obj.frameWidth);
    const frameHeight = positiveNumberFromManifest(obj.frameHeight);
    const frameCount = positiveNumberFromManifest(obj.frameCount);
    if (!frameWidth || !frameHeight || !frameCount) continue;
    const offsetX = Math.max(0, Math.round(numberFromManifest(obj.offsetX, 0)));
    const offsetY = Math.max(0, Math.round(numberFromManifest(obj.offsetY, 0)));
    const width = offsetX + Math.round(frameWidth) * Math.round(frameCount);
    const height = offsetY + Math.round(frameHeight);
    const existing = bounds.get(obj.src);
    bounds.set(obj.src, {
      width: Math.max(existing?.width ?? 0, width),
      height: Math.max(existing?.height ?? 0, height),
    });
  }
  return bounds;
}

async function loadCustomPet(dir: string): Promise<{ pet: DesktopPetDefinition | null; issue?: DesktopPetIssue }> {
  const validation = await validateDesktopPetPackage(dir);
  if (!validation.ok) {
    return { pet: null, issue: validation.issue };
  }

  try {
    const raw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    const folderId = basename(dir).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const rawId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : folderId;
    const id = `custom:${rawId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`;
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null;
    const description = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : null;
    const sourcePrompt = typeof raw.sourcePrompt === 'string' && raw.sourcePrompt.trim()
      ? raw.sourcePrompt.trim()
      : undefined;
    const rawAnimations =
      raw.animations && typeof raw.animations === 'object' ? (raw.animations as Record<string, unknown>) : null;
    const thumbnailPath = safeResolve(dir, raw.thumbnail);
    const thumbnailDataUrl = thumbnailPath ? await imageToDataUrl(thumbnailPath) : null;
    const details: string[] = [];
    if (!name) details.push('name is required');
    if (!description) details.push('description is required');
    if (!rawAnimations) details.push('animations is required');
    if (!thumbnailDataUrl) details.push('thumbnail is required and must be a readable image');
    if (details.length > 0 || !rawAnimations) {
      return { pet: null, issue: { dir, reason: 'Invalid manifest.json', details } };
    }

    const sheetBoundsBySrc = estimateManifestSheetBounds(rawAnimations);
    const entries = await Promise.all(
      PET_ACTIONS.map(async (action) => {
        const result = await loadManifestAnimation(dir, action, rawAnimations[action], sheetBoundsBySrc);
        if (!result.animation) {
          details.push(result.issue ?? `${action}: invalid animation`);
          return null;
        }
        return [action, result.animation] as const;
      }),
    );
    if (entries.some((entry) => !entry)) {
      return { pet: null, issue: { dir, reason: 'Invalid animation manifest', details } };
    }
    const animations = Object.fromEntries(entries as Array<readonly [DesktopPetAction, DesktopPetAnimation]>) as Record<
      DesktopPetAction,
      DesktopPetAnimation
    >;
    return {
      pet: {
        id,
        name,
        description,
        sourcePrompt,
        builtin: false,
        canvasWidth: Math.max(1, Math.round(numberFromManifest(raw.canvasWidth, FRAME_SIZE))),
        canvasHeight: Math.max(1, Math.round(numberFromManifest(raw.canvasHeight, FRAME_SIZE))),
        thumbnailDataUrl,
        animations,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { pet: null, issue: { dir, reason: 'manifest.json is missing or unreadable', details: [message] } };
  }
}

export async function listDesktopPets(): Promise<{ pets: DesktopPetDefinition[]; issues: DesktopPetIssue[] }> {
  const customDir = desktopPetCustomDir();
  await mkdir(customDir, { recursive: true });
  const custom: DesktopPetDefinition[] = [];
  const issues: DesktopPetIssue[] = [];
  try {
    const entries = await readdir(customDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const result = await loadCustomPet(join(customDir, entry.name));
      if (result.pet) custom.push(result.pet);
      if (result.issue) issues.push(result.issue);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    issues.push({ dir: customDir, reason: 'Could not read custom pets directory', details: [message] });
  }
  return { pets: [...builtinPets, ...custom], issues };
}

export async function readDesktopPetState(visible: boolean): Promise<DesktopPetState> {
  const [prefs, petList] = await Promise.all([readDesktopPetPrefs(), listDesktopPets()]);
  const { pets, issues } = petList;
  const selectedExists = pets.some((pet) => pet.id === prefs.selectedPetId);
  return {
    prefs: selectedExists ? prefs : { ...prefs, selectedPetId: defaultDesktopPetPrefs.selectedPetId },
    pets,
    visible,
    customPetsDir: desktopPetCustomDir(),
    petIssues: issues,
  };
}
