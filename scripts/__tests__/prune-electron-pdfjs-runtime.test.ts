import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PDFJS_RUNTIME_PATHS, pruneElectronPdfjsRuntime } from '../prune-electron-pdfjs-runtime.mjs';

describe('pruneElectronPdfjsRuntime', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the PDF text runtime and Canvas while removing unused builds', () => {
    const packDir = mkdtempSync(join(tmpdir(), 'xopc-pdfjs-prune-'));
    dirs.push(packDir);
    const nodeModules = join(packDir, 'node_modules');
    for (const relative of PDFJS_RUNTIME_PATHS) {
      const path = join(nodeModules, 'pdfjs-dist', relative);
      if (relative === 'package.json' || relative === 'LICENSE' || relative.startsWith('legacy/build/')) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, relative);
      } else {
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, 'asset.bin'), relative);
      }
    }
    const unused = join(nodeModules, 'pdfjs-dist/build/pdf.mjs.map');
    mkdirSync(dirname(unused), { recursive: true });
    writeFileSync(unused, 'unused');
    const canvas = join(nodeModules, '@napi-rs/canvas-darwin-x64');
    mkdirSync(canvas, { recursive: true });
    writeFileSync(join(canvas, 'canvas.node'), 'unused');
    const unrelated = join(nodeModules, '@napi-rs/other');
    mkdirSync(unrelated, { recursive: true });

    pruneElectronPdfjsRuntime(packDir);

    for (const relative of PDFJS_RUNTIME_PATHS) {
      const path = join(nodeModules, 'pdfjs-dist', relative);
      expect(existsSync(path)).toBe(true);
      if (!['package.json', 'LICENSE'].includes(relative) && !relative.startsWith('legacy/build/')) {
        expect(readFileSync(join(path, 'asset.bin'), 'utf8')).toBe(relative);
      }
    }
    expect(existsSync(unused)).toBe(false);
    expect(existsSync(canvas)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
  });
});
