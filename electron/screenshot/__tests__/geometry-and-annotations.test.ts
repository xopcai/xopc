import { describe, expect, it, vi } from 'vitest';

import {
  AnnotationHistory,
  findHitAnnotation,
  hitTestAnnotation,
  nextBadgeNumber,
  translateAnnotation,
} from '../annotations.js';
import { renderAnnotationsToContext } from '../canvas-renderer.js';
import {
  applyResizeHandle,
  clampRectToBounds,
  computeMagnifierPlacement,
  computeToolbarPlacement,
  displayToScreenRect,
  findTopSnapWindow,
  logicalToPhysicalRect,
  moveRectWithinBounds,
  normalizeRect,
  nudgeRect,
  screenToDisplayRect,
} from '../geometry.js';
import { isWaylandSession, parseWmctrlWindowList } from '../linux-helper.js';
import type { AnnotationItem, SnapWindowRect } from '../types.js';
import { physicalToLogicalWindowsRect } from '../windows-helper.js';

describe('screenshot geometry & multi-display coordinate transforms', () => {
  it('normalizes reversed drag coordinates and clamps within display bounds', () => {
    expect(normalizeRect(320, 240, 100, 80)).toEqual({ x: 100, y: 80, width: 220, height: 160 });
    expect(clampRectToBounds({ x: -20, y: -15, width: 2000, height: 1200 }, { width: 1440, height: 900 })).toEqual({
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
    });
  });

  it('handles 8-way resize handles and Shift aspect-ratio lock', () => {
    const initial = { x: 100, y: 100, width: 200, height: 100 };
    const viewport = { width: 1280, height: 800 };

    expect(applyResizeHandle(initial, 'se', 50, 30, viewport)).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 130,
    });
    expect(applyResizeHandle(initial, 'nw', -20, -10, viewport)).toEqual({
      x: 80,
      y: 90,
      width: 220,
      height: 110,
    });

    const locked = applyResizeHandle(initial, 'se', 100, 10, viewport, true);
    expect(locked.width / locked.height).toBeCloseTo(2, 2);
  });

  it('moves and nudges selection without escaping viewport', () => {
    const viewport = { width: 800, height: 600 };
    const rect = { x: 750, y: 550, width: 40, height: 40 };
    expect(moveRectWithinBounds(rect, 50, 50, viewport)).toEqual({ x: 760, y: 560, width: 40, height: 40 });
    expect(nudgeRect({ x: 10, y: 10, width: 50, height: 50 }, 'ArrowUp', 1, viewport)).toEqual({
      x: 10,
      y: 9,
      width: 50,
      height: 50,
    });
    expect(nudgeRect({ x: 10, y: 10, width: 50, height: 50 }, 'ArrowRight', 10, viewport)).toEqual({
      x: 20,
      y: 10,
      width: 50,
      height: 50,
    });
  });

  it('maps between global screen DIP, display-local DIP, and HiDPI physical pixels', () => {
    const secondaryDisplay = { x: 1512, y: 0, width: 1920, height: 1080 };
    const winRect = { x: 1612, y: 120, width: 640, height: 480 };
    const local = screenToDisplayRect(winRect, secondaryDisplay);
    expect(local).toEqual({ x: 100, y: 120, width: 640, height: 480 });
    expect(displayToScreenRect(local!, secondaryDisplay)).toEqual(winRect);

    // 2x Retina backing bitmap
    const phys = logicalToPhysicalRect(
      { x: 50, y: 60, width: 300, height: 200 },
      { width: 1512, height: 982 },
      { width: 3024, height: 1964 },
    );
    expect(phys).toEqual({ x: 100, y: 120, width: 600, height: 400 });
  });

  it('snaps to the frontmost Z-ordered visible window under the cursor', () => {
    const display = { x: 0, y: 0, width: 1440, height: 900 };
    const windows: SnapWindowRect[] = [
      { id: 'back', title: 'Browser', appName: 'Chrome', x: 50, y: 50, width: 1000, height: 700, zOrder: 2 },
      { id: 'front', title: 'Settings', appName: 'xopc', x: 200, y: 150, width: 500, height: 400, zOrder: 0 },
      { id: 'tiny', title: 'Status', appName: 'Helper', x: 220, y: 160, width: 12, height: 12, zOrder: 0 },
    ];
    const hitFront = findTopSnapWindow(300, 250, display, windows);
    expect(hitFront?.id).toBe('front');
    expect(hitFront?.localRect).toEqual({ x: 200, y: 150, width: 500, height: 400 });

    const hitBack = findTopSnapWindow(100, 100, display, windows);
    expect(hitBack?.id).toBe('back');
  });

  it('places WeChat toolbar below, flips above near bottom, and docks inside for full-height selection', () => {
    const vp = { width: 1440, height: 900 };
    const tb = { width: 520, height: 40 };

    expect(computeToolbarPlacement({ x: 300, y: 200, width: 600, height: 300 }, tb, vp).position).toBe('below');
    expect(computeToolbarPlacement({ x: 300, y: 450, width: 600, height: 420 }, tb, vp).position).toBe('above');
    expect(computeToolbarPlacement({ x: 0, y: 0, width: 1440, height: 900 }, tb, vp).position).toBe('inside');

    const loupe = computeMagnifierPlacement(1430, 890, { width: 144, height: 158 }, vp);
    expect(loupe.x + 144).toBeLessThanOrEqual(vp.width);
    expect(loupe.y + 158).toBeLessThanOrEqual(vp.height);
  });
});

describe('vector annotations & undo/redo stack', () => {
  it('supports hit-testing, translation, numbered badges, and undo/redo history', () => {
    const history = new AnnotationHistory();
    const rect: AnnotationItem = {
      id: 'r1',
      kind: 'rect',
      x: 100,
      y: 100,
      width: 200,
      height: 120,
      color: '#fa5151',
      strokeSize: 'md',
    };
    const badge1: AnnotationItem = {
      id: 'b1',
      kind: 'badge',
      x: 150,
      y: 150,
      number: nextBadgeNumber([rect]),
      color: '#fa5151',
      strokeSize: 'md',
    };
    expect(badge1.number).toBe(1);
    expect(nextBadgeNumber([rect, badge1])).toBe(2);

    history.commit([rect]);
    history.commit([rect, badge1]);
    expect(history.items).toHaveLength(2);
    expect(history.canUndo).toBe(true);

    expect(hitTestAnnotation(rect, 100, 150)).toBe(true);
    expect(hitTestAnnotation(rect, 200, 160)).toBe(false); // hollow center
    expect(findHitAnnotation(history.items, 150, 150)?.id).toBe('b1');

    const moved = translateAnnotation(badge1, 25, -10);
    expect(moved).toMatchObject({ x: 175, y: 140 });

    history.undo();
    expect(history.items).toHaveLength(1);
    expect(history.canRedo).toBe(true);
    history.redo();
    expect(history.items).toHaveLength(2);
  });

  it('applies selection crop offsetX/offsetY to mosaic mask rendering so exported cropped mosaic aligns 1:1', () => {
    const maskTranslations: Array<[number, number]> = [];
    const maskCtx = {
      globalCompositeOperation: 'source-over',
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn((x: number, y: number) => maskTranslations.push([x, y])),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      drawImage: vi.fn(),
    };
    const origDoc = globalThis.document;
    Object.assign(globalThis, {
      document: {
        createElement: () => ({
          width: 400,
          height: 300,
          getContext: () => maskCtx,
        }),
      },
    });
    try {
      const outCtx = {
        canvas: { width: 400, height: 300 },
        save: vi.fn(),
        restore: vi.fn(),
        setTransform: vi.fn(),
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D;

      renderAnnotationsToContext({
        ctx: outCtx,
        items: [
          {
            id: 'm1',
            kind: 'mosaic',
            points: [
              { x: 320, y: 210 },
              { x: 360, y: 240 },
            ],
            color: '#000000',
            strokeSize: 'md',
          },
        ],
        scaleFactor: 2,
        offsetX: -300,
        offsetY: -180,
        getMosaicSource: () => ({ width: 400, height: 300 }) as HTMLCanvasElement,
      });

      expect(maskTranslations).toEqual([[-300, -180]]);
    } finally {
      Object.assign(globalThis, { document: origDoc });
    }
  });
});

describe('cross-platform window helper normalization (Windows HiDPI & Linux X11/Wayland)', () => {
  it('maps Windows physical DWM coordinates to logical DIP across mixed-DPI monitors', () => {
    const displays = [
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
      { bounds: { x: 1920, y: 0, width: 1707, height: 960 }, scaleFactor: 1.5 },
    ];
    // Window on secondary 150% monitor at physical (2880 + 150, 300) size (900x600) -> logical (1920 + 100, 200, 600x400)
    const mapped = physicalToLogicalWindowsRect(
      { x: 3030, y: 300, width: 900, height: 600 },
      displays,
    );
    expect(mapped).toEqual({ x: 2020, y: 200, width: 600, height: 400 });
  });

  it('parses Linux wmctrl stacking output in front-to-back Z-order and excludes desktop/own PID', () => {
    const sample = [
      '0x01200003 -1 1010   0    0    1920 1080 host Desktop',
      '0x02400010  0 2020 100   80    1200  800 host Mozilla Firefox',
      '0x03600020  0 9999 200  100     800  600 host xopc',
      '0x04800007  0 3030 320  180     720  520 host Terminal',
    ].join('\n');

    const parsed = parseWmctrlWindowList(sample, 9999);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ id: '0x04800007', title: 'Terminal', zOrder: 0, x: 320, y: 180 });
    expect(parsed[1]).toMatchObject({ id: '0x02400010', title: 'Mozilla Firefox', zOrder: 1 });
  });

  it('detects Wayland environment flags accurately on Linux', () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      expect(isWaylandSession({ XDG_SESSION_TYPE: 'wayland' })).toBe(true);
      expect(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0' })).toBe(true);
      expect(isWaylandSession({ XDG_SESSION_TYPE: 'x11' })).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', { value: orig });
    }
  });
});
