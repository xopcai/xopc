/**
 * Renders extension toolbar / store icons from the gateway app logo (single source of truth).
 * Source: web/public/logo.svg
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const svgPath = join(repoRoot, 'web/public/logo.svg');
const outDir = resolve(__dirname, '../icons');

const svg = readFileSync(svgPath);
mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  });
  const data = resvg.render();
  writeFileSync(join(outDir, `icon-${size}.png`), data.asPng());
}

console.log(`Wrote PNG icons to ${outDir} from ${svgPath}`);
