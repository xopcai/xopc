import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The packaged result worker needs the legacy parser, worker, and their data assets.
// PDF.js viewers, alternate builds, types, and source maps are build artifacts.
export const PDFJS_RUNTIME_PATHS = [
  'package.json',
  'LICENSE',
  'legacy/build/pdf.mjs',
  'legacy/build/pdf.worker.mjs',
  'cmaps',
  'standard_fonts',
  'wasm',
  'image_decoders',
  'iccs',
];

function deferRenderingMatrix(pdfjs) {
  // Backport https://github.com/mozilla/pdf.js/pull/21721 to the pinned 6.2.108
  // desktop copy. Text extraction must not instantiate rendering-only DOMMatrix.
  const path = join(pdfjs, 'legacy/build/pdf.mjs');
  let source = readFileSync(path, 'utf8');
  const replacements = [
    ['const SCALE_MATRIX = new DOMMatrix();', ''],
    ['class CanvasGraphics {', 'class CanvasGraphics {\n  static #SCALE_MATRIX = null;'],
    ['    SCALE_MATRIX.a = 1 / scaleX;', '    const SCALE_MATRIX = (CanvasGraphics.#SCALE_MATRIX ??= new DOMMatrix());\n    SCALE_MATRIX.a = 1 / scaleX;'],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) {
      throw new Error('[prepare-electron-pack-dir] PDF.js rendering matrix changed; review the text-only runtime backport');
    }
    source = source.replace(before, after);
  }
  writeFileSync(path, source);
}

export function pruneElectronPdfjsRuntime(packDir) {
  const nodeModules = join(packDir, 'node_modules');
  const pdfjs = join(nodeModules, 'pdfjs-dist');
  if (!existsSync(pdfjs)) throw new Error('[prepare-electron-pack-dir] Missing pdfjs-dist runtime');

  const minimal = mkdtempSync(join(nodeModules, '.pdfjs-runtime-'));
  try {
    for (const relative of PDFJS_RUNTIME_PATHS) {
      const source = join(pdfjs, relative);
      if (!existsSync(source)) throw new Error(`[prepare-electron-pack-dir] Missing PDF.js runtime asset: ${relative}`);
      const destination = join(minimal, relative);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(source, destination, { recursive: true });
    }
    deferRenderingMatrix(minimal);
    rmSync(pdfjs, { recursive: true, force: true });
    renameSync(minimal, pdfjs);
    // Only the desktop text parser uses this tree; previews render in Chromium.
    const napi = join(nodeModules, '@napi-rs');
    if (existsSync(napi)) {
      for (const name of readdirSync(napi)) {
        if (name === 'canvas' || name.startsWith('canvas-')) {
          rmSync(join(napi, name), { recursive: true, force: true });
        }
      }
    }
  } finally {
    rmSync(minimal, { recursive: true, force: true });
  }
}
