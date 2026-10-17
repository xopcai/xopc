import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PDFJS_RUNTIME_PATHS, pruneElectronPdfjsRuntime } from '../prune-electron-pdfjs-runtime.mjs';

describe('pruneElectronPdfjsRuntime', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('fails before deleting dependencies when the PDF.js backport no longer matches', () => {
    const packDir = mkdtempSync(join(tmpdir(), 'xopc-pdfjs-prune-'));
    dirs.push(packDir);
    const pdfjs = join(packDir, 'node_modules/pdfjs-dist');
    cpSync(join(process.cwd(), 'node_modules/pdfjs-dist'), pdfjs, { recursive: true, dereference: true });
    const parser = join(pdfjs, 'legacy/build/pdf.mjs');
    writeFileSync(parser, 'changed upstream implementation');
    const canvas = join(packDir, 'node_modules/@napi-rs/canvas');
    mkdirSync(canvas, { recursive: true });
    expect(() => pruneElectronPdfjsRuntime(packDir)).toThrow('review the text-only runtime backport');
    expect(readFileSync(parser, 'utf8')).toBe('changed upstream implementation');
    expect(existsSync(canvas)).toBe(true);
  });

  it('keeps the PDF text runtime while removing native Canvas and unused builds', () => {
    const packDir = mkdtempSync(join(tmpdir(), 'xopc-pdfjs-prune-'));
    dirs.push(packDir);
    const nodeModules = join(packDir, 'node_modules');
    for (const relative of PDFJS_RUNTIME_PATHS) {
      const path = join(nodeModules, 'pdfjs-dist', relative);
      if (relative === 'package.json' || relative === 'LICENSE' || relative.startsWith('legacy/build/')) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, relative === 'legacy/build/pdf.mjs'
          ? 'const SCALE_MATRIX = new DOMMatrix();\nclass CanvasGraphics {\n    SCALE_MATRIX.a = 1 / scaleX;\n}'
          : relative);
      } else {
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, 'asset.bin'), relative);
      }
    }
    const unused = join(nodeModules, 'pdfjs-dist/build/pdf.mjs.map');
    mkdirSync(dirname(unused), { recursive: true });
    writeFileSync(unused, 'unused');
    const canvasPackages = ['canvas', 'canvas-darwin-x64', 'canvas-darwin-arm64', 'canvas-win32-x64-msvc', 'canvas-linux-x64-gnu'];
    for (const name of canvasPackages) {
      const canvas = join(nodeModules, '@napi-rs', name);
      mkdirSync(canvas, { recursive: true });
      writeFileSync(join(canvas, 'canvas.node'), 'unused');
    }
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
    for (const name of canvasPackages) expect(existsSync(join(nodeModules, '@napi-rs', name))).toBe(false);
    expect(readFileSync(join(nodeModules, 'pdfjs-dist/legacy/build/pdf.mjs'), 'utf8'))
      .toContain('CanvasGraphics.#SCALE_MATRIX ??= new DOMMatrix()');
    expect(existsSync(unrelated)).toBe(true);
  });
});
