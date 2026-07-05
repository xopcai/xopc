/**
 * Renders extension toolbar / store icons from the gateway app icon (single source of truth).
 * Source: web/public/favicon.svg
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const svgPath = join(repoRoot, 'web/public/favicon.svg');
const outDir = resolve(__dirname, '../icons');

const svg = readFileSync(svgPath);
mkdirSync(outDir, { recursive: true });

let written = 0;
let unchanged = 0;

for (const size of [16, 32, 48, 128]) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  });
  const data = resvg.render();
  const png = Buffer.from(data.asPng());
  const outPath = join(outDir, `icon-${size}.png`);

  if (existsSync(outPath) && readFileSync(outPath).equals(png)) {
    unchanged += 1;
    continue;
  }

  writeFileSync(outPath, png);
  written += 1;
}

if (written === 0) {
  console.log(`PNG icons are up to date in ${outDir} (${unchanged} unchanged)`);
} else {
  console.log(`Wrote ${written} PNG icon(s) to ${outDir} from ${svgPath} (${unchanged} unchanged)`);
}
