#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

import yaml from 'js-yaml';

const [x64Path, arm64Path, outputPath] = process.argv.slice(2);

if (!x64Path || !arm64Path || !outputPath) {
  console.error(
    'Usage: node scripts/merge-macos-electron-latest-yml.mjs <x64.yml> <arm64.yml> <output.yml>',
  );
  process.exit(1);
}

function readManifest(path) {
  const manifest = yaml.load(readFileSync(path, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.files)) {
    throw new Error(`Unexpected macOS update manifest shape: ${path}`);
  }
  return manifest;
}

function hasArchZip(manifest, arch) {
  return manifest.files.some((file) => {
    if (!file || typeof file !== 'object' || typeof file.url !== 'string') return false;
    return file.url.toLowerCase().endsWith('.zip') && file.url.toLowerCase().includes(`-${arch}.`);
  });
}

try {
  const x64Manifest = readManifest(x64Path);
  const arm64Manifest = readManifest(arm64Path);
  const version = String(x64Manifest.version ?? '');

  if (!version || String(arm64Manifest.version ?? '') !== version) {
    throw new Error(
      `Version mismatch across macOS update manifests: ${String(x64Manifest.version)} != ${String(arm64Manifest.version)}`,
    );
  }
  if (!hasArchZip(x64Manifest, 'x64')) {
    throw new Error(`x64 update manifest does not contain an x64 ZIP: ${x64Path}`);
  }
  if (!hasArchZip(arm64Manifest, 'arm64')) {
    throw new Error(`arm64 update manifest does not contain an arm64 ZIP: ${arm64Path}`);
  }

  const files = [];
  const seenUrls = new Set();
  for (const manifest of [x64Manifest, arm64Manifest]) {
    for (const file of manifest.files) {
      if (!file || typeof file !== 'object' || typeof file.url !== 'string') continue;
      if (seenUrls.has(file.url)) continue;
      seenUrls.add(file.url);
      files.push(file);
    }
  }

  const merged = {
    ...x64Manifest,
    files,
    releaseDate: arm64Manifest.releaseDate ?? x64Manifest.releaseDate,
  };
  writeFileSync(outputPath, yaml.dump(merged, { lineWidth: -1, noRefs: true }));
  console.log(
    `Merged ${files.length} macOS update entries for ${version} into ${outputPath}`,
  );
} catch (error) {
  console.error(
    `merge-macos-electron-latest-yml: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
