/**
 * Build a Chrome Web Store / sideload zip from the extension package root layout.
 * Includes: manifest.json, popup.html, dist/*.js, icons/*.png
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import AdmZip from 'adm-zip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');

const manifest = JSON.parse(readFileSync(join(pkgRoot, 'manifest.json'), 'utf8'));
const version = manifest.version ?? '0.0.0';
const slug = 'xopc-browser-bridge';

const requiredFiles = [
  'manifest.json',
  'popup.html',
  'dist/background.js',
  'dist/content.js',
  'dist/popup.js',
];

for (const rel of requiredFiles) {
  const abs = join(pkgRoot, rel);
  if (!existsSync(abs)) {
    console.error(`Missing ${rel}. Run: pnpm run build`);
    process.exit(1);
  }
}

const iconsDir = join(pkgRoot, 'icons');
if (!existsSync(iconsDir)) {
  console.error('Missing icons/. Run: pnpm run icons');
  process.exit(1);
}

const releaseDir = join(pkgRoot, 'release');
mkdirSync(releaseDir, { recursive: true });

const outZip = join(releaseDir, `${slug}-v${version}.zip`);

const zip = new AdmZip();
zip.addLocalFile(join(pkgRoot, 'manifest.json'));
zip.addLocalFile(join(pkgRoot, 'popup.html'));
zip.addLocalFolder(join(pkgRoot, 'dist'), 'dist');
zip.addLocalFolder(join(pkgRoot, 'icons'), 'icons');
zip.writeZip(outZip);

console.log(`Created ${outZip}`);
