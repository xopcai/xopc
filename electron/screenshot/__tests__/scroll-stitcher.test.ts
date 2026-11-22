import { describe, expect, it } from 'vitest';

import { ScrollStitcher, type RgbaFrame } from '../stitch.js';

/**
 * Generates a synthetic scrollable viewport with:
 * - Sticky top header (`headerH` rows)
 * - Scrollable content (`scrollY` offset) with deterministic colorful horizontal text-like bands
 * - Sticky bottom footer (`footerH` rows)
 * - Rightmost 10px moving scrollbar thumb
 */
function renderSyntheticViewport(params: {
  width: number;
  height: number;
  scrollY: number;
  headerH?: number;
  footerH?: number;
}): RgbaFrame {
  const { width, height, scrollY, headerH = 20, footerH = 18 } = params;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      // Moving scrollbar on right edge (must be ignored by stitcher!)
      if (x >= width - 10) {
        const thumbPos = Math.floor(scrollY * 0.4) % Math.max(1, height - 30);
        const onThumb = y >= thumbPos && y < thumbPos + 30;
        data[idx] = onThumb ? 180 : 30;
        data[idx + 1] = onThumb ? 180 : 30;
        data[idx + 2] = onThumb ? 180 : 30;
        data[idx + 3] = 255;
        continue;
      }

      if (y < headerH) {
        // Sticky top header
        data[idx] = 24;
        data[idx + 1] = 42;
        data[idx + 2] = 88;
        data[idx + 3] = 255;
      } else if (y >= height - footerH) {
        // Sticky bottom footer
        data[idx] = 35;
        data[idx + 1] = 38;
        data[idx + 2] = 45;
        data[idx + 3] = 255;
      } else {
        // Unique scrollable document row `docY`
        const docY = scrollY + (y - headerH);
        data[idx] = (docY * 37 + x * 3) & 255;
        data[idx + 1] = (docY * 73 + x * 5) & 255;
        data[idx + 2] = (docY * 19 + (docY >> 2) * 41) & 255;
        data[idx + 3] = 255;
      }
    }
  }

  return { width, height, data };
}

describe('ScrollStitcher (Phase 4 scrolling long screenshot)', () => {
  it('stitches sequential scrolled frames while preserving sticky headers and footers without duplication', () => {
    const stitcher = new ScrollStitcher(2000);
    const f0 = renderSyntheticViewport({ width: 240, height: 180, scrollY: 0 });
    const r0 = stitcher.pushFrame(f0);
    expect(r0).toMatchObject({ accepted: true, appendedRows: 180, totalHeight: 180, reason: 'first_frame' });

    // Identical frame -> rejected as no_motion
    const rStatic = stitcher.pushFrame(f0);
    expect(rStatic).toMatchObject({ accepted: false, appendedRows: 0, reason: 'no_motion' });

    // Scroll down by 48px
    const f1 = renderSyntheticViewport({ width: 240, height: 180, scrollY: 48 });
    const r1 = stitcher.pushFrame(f1);
    expect(r1.accepted).toBe(true);
    expect(r1.appendedRows).toBe(48);
    expect(r1.totalHeight).toBe(228);

    // Scroll down by another 60px
    const f2 = renderSyntheticViewport({ width: 240, height: 180, scrollY: 108 });
    const r2 = stitcher.pushFrame(f2);
    expect(r2.accepted).toBe(true);
    expect(r2.appendedRows).toBe(60);
    expect(r2.totalHeight).toBe(288);

    const composite = stitcher.buildComposite();
    expect(composite).not.toBeNull();
    expect(composite!.width).toBe(240);
    expect(composite!.height).toBe(288);
    expect(composite!.data.byteLength).toBe(240 * 288 * 4);
  });

  it('stops cleanly when reaching maxHeight budget', () => {
    const stitcher = new ScrollStitcher(220);
    stitcher.pushFrame(renderSyntheticViewport({ width: 200, height: 160, scrollY: 0 }));
    const step = stitcher.pushFrame(renderSyntheticViewport({ width: 200, height: 160, scrollY: 80 }));
    expect(step.accepted).toBe(true);
    expect(step.totalHeight).toBe(220);
    expect(step.reachedLimit).toBe(true);

    const after = stitcher.pushFrame(renderSyntheticViewport({ width: 200, height: 160, scrollY: 140 }));
    expect(after.accepted).toBe(false);
    expect(after.reachedLimit).toBe(true);
  });
});
