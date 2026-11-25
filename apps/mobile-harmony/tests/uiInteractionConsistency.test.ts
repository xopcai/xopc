import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@kit.ArkUI', () => ({
  RectShape: class {},
  curves: {
    cubicBezierCurve: () => ({ curve: 'bezier' }),
    interpolatingSpring: () => ({ curve: 'spring' }),
  },
}));

vi.hoisted(() => {
  Object.assign(globalThis, {
    $r: (name: string) => name,
    ObservedV2: (value: unknown) => value,
    Trace: () => undefined,
    SheetSize: { LARGE: 'LARGE', MEDIUM: 'MEDIUM' },
    ClickEffectLevel: { LIGHT: 0 },
  });
});

import {
  XOPC_MOTION_PAGER_MS,
  XOPC_MOTION_STANDARD_MS,
  xopcMotionDuration,
  xopcPagerAnimated,
  xopcPagerDuration,
} from '../entry/src/main/ets/common/motionTokens.ets';
import { xopcSheetOptions } from '../entry/src/main/ets/common/dialogActions.ets';
import { appThemeColors } from '../entry/src/main/ets/common/themePalette.ets';

const etsRoot = new URL('../entry/src/main/ets/', import.meta.url).pathname;

function collectViewFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectViewFiles(full));
    else if (entry.name.endsWith('.ets')) results.push(full);
  }
  return results;
}

const uiFiles = [
  ...collectViewFiles(join(etsRoot, 'view')),
  ...collectViewFiles(join(etsRoot, 'pages')),
];

describe('HarmonyOS UI & interaction unification guard', () => {
  it('resolves motion durations and pager animation consistently with reduceMotion', () => {
    expect(xopcMotionDuration(XOPC_MOTION_STANDARD_MS, false)).toBe(220);
    expect(xopcMotionDuration(XOPC_MOTION_STANDARD_MS, true)).toBe(0);
    expect(xopcMotionDuration(-10, false)).toBe(0);
    expect(xopcPagerDuration(false)).toBe(XOPC_MOTION_PAGER_MS);
    expect(xopcPagerDuration(true)).toBe(0);
    expect(xopcPagerAnimated(false, 1)).toBe(true);
    expect(xopcPagerAnimated(false, 2)).toBe(false);
    expect(xopcPagerAnimated(true, 1)).toBe(false);
  });

  it('produces standardized sheet presets with consistent surfaces and chrome', () => {
    const compact = xopcSheetOptions('compact');
    expect(compact.height).toBe('45%');
    expect(compact.dragBar).toBe(true);
    expect(compact.showClose).toBe(false);
    expect(compact.backgroundColor).toBe(appThemeColors.panel);

    const medium = xopcSheetOptions('medium');
    expect(medium.height).toBe('70%');
    expect(medium.dragBar).toBe(true);

    const large = xopcSheetOptions('large');
    expect(large.height).toBe('LARGE');
    expect(large.dragBar).toBe(true);

    const immersive = xopcSheetOptions('immersive');
    expect(immersive.height).toBe('94%');
    expect(immersive.dragBar).toBe(false);
    expect(immersive.backgroundColor).toBe(appThemeColors.chat.canvas);
  });

  it('forbids legacy showAlertDialog and showActionSheet across all views', () => {
    for (const file of uiFiles) {
      const rel = relative(etsRoot, file);
      const source = readFileSync(file, 'utf8');
      expect(source, `${rel} must use xopcConfirmDialog instead of showAlertDialog`).not.toMatch(/\bshowAlertDialog\s*\(/);
      expect(source, `${rel} must use bindContextMenu/bindMenu instead of showActionSheet`).not.toMatch(/\bshowActionSheet\s*\(/);
    }
  });

  it('enforces unified overflow iconography across all views', () => {
    for (const file of uiFiles) {
      const rel = relative(etsRoot, file);
      const source = readFileSync(file, 'utf8');
      expect(source, `${rel} must use xopcMoreIcon() instead of dot_grid_1x2`).not.toContain('dot_grid_1x2');
      expect(source, `${rel} must use xopcMoreIcon() instead of literal ellipsis text`).not.toMatch(/['"](?:⋯|•••)['"]/);
    }
  });

  it('forbids hardcoded business hex colors in views (only physical QR code foreground allowed)', () => {
    const allowedHexFiles = new Set(['view/ShareResultView.ets']);
    for (const file of uiFiles) {
      const rel = relative(etsRoot, file);
      if (allowedHexFiles.has(rel)) continue;
      const source = readFileSync(file, 'utf8');
      expect(source, `${rel} must use semantic appThemeColors instead of hardcoded hex`).not.toMatch(/['"]#[0-9a-fA-F]{6,8}['"]/);
    }
  });

  it('routes every bindSheet through xopcSheetOptions and every Swiper duration through motionTokens', () => {
    for (const file of uiFiles) {
      const rel = relative(etsRoot, file);
      const source = readFileSync(file, 'utf8');
      expect(source, `${rel} must use xopcPagerDuration instead of hardcoded 230/240`).not.toMatch(/\.duration\([^)]*(?:230|240)\)/);
      if (source.includes('.bindSheet(')) {
        expect(source, `${rel} must use xopcSheetOptions for bindSheet`).toContain('xopcSheetOptions(');
      }
    }
  });

  it('uses XopcPageHeader on FilesView, CapabilitiesView, GatewayProfilesView, and SessionsView', () => {
    for (const view of ['FilesView.ets', 'CapabilitiesView.ets', 'GatewayProfilesView.ets', 'SessionsView.ets']) {
      const source = readFileSync(join(etsRoot, 'view', view), 'utf8');
      expect(source, `${view} should render XopcPageHeader`).toContain('XopcPageHeader(');
    }
  });

  it('routes all toasts through xopcToast outside dialogActions.ets', () => {
    const allFiles = [...uiFiles, ...collectViewFiles(join(etsRoot, 'service'))];
    for (const file of allFiles) {
      const rel = relative(etsRoot, file);
      const source = readFileSync(file, 'utf8');
      expect(source, `${rel} must use xopcToast instead of direct showToast`).not.toMatch(/\.showToast\s*\(/);
    }
  });
});
