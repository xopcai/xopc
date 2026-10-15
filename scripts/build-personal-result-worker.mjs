import * as esbuild from 'esbuild';
import { join } from 'node:path';

/** Keep parser dependencies in one worker file; PDF.js retains its adjacent runtime assets. */
export async function buildPersonalResultWorker(root, outfile, minify = true) {
  await esbuild.build({
    entryPoints: [join(root, 'src/personal-agent/result-extraction.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    external: ['pdfjs-dist'],
    banner: { js: "import { createRequire as __resultCreateRequire } from 'node:module'; const require = __resultCreateRequire(import.meta.url);" },
    minify,
  });
}
