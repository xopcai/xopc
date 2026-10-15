import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
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
    rmSync(pdfjs, { recursive: true, force: true });
    renameSync(minimal, pdfjs);
  } finally {
    rmSync(minimal, { recursive: true, force: true });
  }
}
