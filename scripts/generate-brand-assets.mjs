#!/usr/bin/env node
/**
 * Generate all xopc logo assets from assets/brand/xopc-mark.svg.
 *
 * This script intentionally uses @resvg/resvg-js rather than platform image tools so
 * contributors and CI produce byte-stable PNGs on macOS, Windows, and Linux.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'assets/brand/xopc-mark.svg');
const markSource = readFileSync(sourcePath, 'utf8');
const markRoot = markSource.match(/<svg\b[^>]*>/i)?.[0];
const mark = markSource.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1]?.trim();
const markViewBox = markRoot?.match(/\bviewBox=(["'])(.*?)\1/i)?.[2];

if (!mark || !markViewBox) {
  throw new Error(`Could not read SVG artwork from ${sourcePath}`);
}

const check = process.argv.includes('--check');
const requestedTarget = process.argv.find((argument) => argument.startsWith('--target='))?.slice('--target='.length);
const validTargets = new Set(['all', 'web', 'docs', 'mobile', 'electron', 'browser-ext']);
const target = requestedTarget ?? 'all';

if (!validTargets.has(target)) {
  throw new Error(`Unknown --target value ${JSON.stringify(target)}. Use ${[...validTargets].join(', ')}.`);
}

const DARK = '#0B0D10';
const LIGHT = '#F8FAFC';
const LIGHT_MARK = '#111827';
const MOBILE_MARK_SCALE = 0.60;

const outputs = [];

function isEnabled(outputTarget) {
  return target === 'all' || target === outputTarget;
}

function queue(outputTarget, relativePath, data) {
  if (!isEnabled(outputTarget)) return;
  outputs.push({ path: join(root, relativePath), data: Buffer.isBuffer(data) ? data : Buffer.from(data) });
}

function document(definitions, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">\n${definitions ? `  <defs>${definitions}</defs>\n` : ''}${body}\n</svg>\n`;
}

function markLayer(foreground, scale = 1, offsetX = 0, offsetY = 0) {
  const recolouredMark = mark.replaceAll('currentColor', foreground);
  return `  <g transform="translate(${512 + offsetX} ${512 + offsetY}) scale(${scale}) translate(-512 -512)">\n    <svg width="1024" height="1024" viewBox="${markViewBox}">\n      ${recolouredMark}\n    </svg>\n  </g>`;
}

function uiMarkSvg(foreground, scale = 1, offsetX = 0, offsetY = 0) {
  return document('', markLayer(foreground, scale, offsetX, offsetY));
}

function appIconSvg(appearance, options = {}) {
  const isDark = appearance === 'dark';
  const {
    markScale = 0.77,
    markOffsetX = 0,
    markOffsetY = 0,
    palette = 'default',
  } = options;
  const isMobile = palette === 'mobile';
  const definitions = isMobile && isDark
    ? `
    <linearGradient id="surface" x1="90" y1="74" x2="910" y2="950" gradientUnits="userSpaceOnUse">
      <stop stop-color="#3A425F" />
      <stop offset="0.52" stop-color="#252B40" />
      <stop offset="1" stop-color="#302B48" />
    </linearGradient>
    <radialGradient id="bloom" cx="0" cy="0" r="1" gradientTransform="translate(744 264) rotate(133) scale(640)">
      <stop stop-color="#A8B3FF" stop-opacity="0.28" />
      <stop offset="1" stop-color="#A8B3FF" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="mark" x1="344" y1="244" x2="690" y2="780" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF" />
      <stop offset="1" stop-color="#D9E0FF" />
    </linearGradient>`
    : isMobile
      ? `
    <linearGradient id="surface" x1="68" y1="74" x2="936" y2="940" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FBFCFF" />
      <stop offset="0.53" stop-color="#F0F2F8" />
      <stop offset="1" stop-color="#E8EAF3" />
    </linearGradient>
    <radialGradient id="bloom" cx="0" cy="0" r="1" gradientTransform="translate(770 248) rotate(133) scale(620)">
      <stop stop-color="#FFFFFF" stop-opacity="0.75" />
      <stop offset="0.5" stop-color="#AEB9EF" stop-opacity="0.2" />
      <stop offset="1" stop-color="#AEB9EF" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="mark" x1="346" y1="244" x2="686" y2="780" gradientUnits="userSpaceOnUse">
      <stop stop-color="#151A2C" />
      <stop offset="1" stop-color="#46547E" />
    </linearGradient>`
      : isDark
    ? `
    <linearGradient id="surface" x1="90" y1="74" x2="910" y2="950" gradientUnits="userSpaceOnUse">
      <stop stop-color="#181D31" />
      <stop offset="0.5" stop-color="#0B0E18" />
      <stop offset="1" stop-color="#151127" />
    </linearGradient>
    <radialGradient id="bloom" cx="0" cy="0" r="1" gradientTransform="translate(744 264) rotate(133) scale(640)">
      <stop stop-color="#717BFF" stop-opacity="0.34" />
      <stop offset="1" stop-color="#717BFF" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="mark" x1="344" y1="244" x2="690" y2="780" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF" />
      <stop offset="1" stop-color="#B8C6FF" />
    </linearGradient>`
    : `
    <linearGradient id="surface" x1="68" y1="74" x2="936" y2="940" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF" />
      <stop offset="0.53" stop-color="#EDF0F8" />
      <stop offset="1" stop-color="#DFE3F4" />
    </linearGradient>
    <radialGradient id="bloom" cx="0" cy="0" r="1" gradientTransform="translate(770 248) rotate(133) scale(620)">
      <stop stop-color="#8996FF" stop-opacity="0.23" />
      <stop offset="1" stop-color="#8996FF" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="mark" x1="346" y1="244" x2="686" y2="780" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0B1020" />
      <stop offset="1" stop-color="#35436E" />
    </linearGradient>`;
  const orbit = isMobile
    ? isDark
      ? '#C5CEFA'
      : '#53618A'
    : isDark
      ? '#AEBBFF'
      : '#6473AD';
  const body = `  <rect width="1024" height="1024" fill="url(#surface)" />
  <rect width="1024" height="1024" fill="url(#bloom)" />
  <circle cx="512" cy="512" r="402" fill="none" stroke="${orbit}" stroke-opacity="0.14" stroke-width="2" />
${markLayer('url(#mark)', markScale, markOffsetX, markOffsetY)}`;
  return document(definitions, body);
}

function mobileAppIconSvg(appearance) {
  return appIconSvg(appearance, {
    markScale: MOBILE_MARK_SCALE,
    palette: 'mobile',
  });
}

function mobileAdaptiveIconSvg(foreground) {
  return uiMarkSvg(foreground, MOBILE_MARK_SCALE);
}

function desktopIconSvg() {
  const definitions = `
    <linearGradient id="desktop-surface" x1="118" y1="98" x2="900" y2="930" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FBFCFF" />
      <stop offset="0.52" stop-color="#EEF1F8" />
      <stop offset="1" stop-color="#E6E8F3" />
    </linearGradient>
    <radialGradient id="desktop-bloom" cx="0" cy="0" r="1" gradientTransform="translate(760 250) rotate(130) scale(590)">
      <stop stop-color="#FFFFFF" stop-opacity="0.78" />
      <stop offset="0.48" stop-color="#AEB9EF" stop-opacity="0.22" />
      <stop offset="1" stop-color="#AEB9EF" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="desktop-mark" x1="362" y1="280" x2="690" y2="740" gradientUnits="userSpaceOnUse">
      <stop stop-color="#151A2C" />
      <stop offset="1" stop-color="#46547E" />
    </linearGradient>`;
  const body = `  <rect x="64" y="64" width="896" height="896" rx="264" fill="url(#desktop-surface)" />
  <rect x="64" y="64" width="896" height="896" rx="264" fill="url(#desktop-bloom)" />
  <rect x="65" y="65" width="894" height="894" rx="263" fill="none" stroke="#FFFFFF" stroke-opacity="0.9" stroke-width="2" />
  <circle cx="512" cy="512" r="338" fill="none" stroke="#53618A" stroke-opacity="0.12" stroke-width="2" />
${markLayer('url(#desktop-mark)', 0.68)}`;
  return document(definitions, body);
}

function badgeSvg() {
  const definitions = `
    <linearGradient id="badge-surface" x1="218" y1="140" x2="806" y2="884" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF" />
      <stop offset="1" stop-color="#EDF0F5" />
    </linearGradient>
    <linearGradient id="badge-mark" x1="356" y1="286" x2="670" y2="738" gradientUnits="userSpaceOnUse">
      <stop stop-color="#080B12" />
      <stop offset="1" stop-color="#303A52" />
    </linearGradient>`;
  const body = `  <rect x="72" y="72" width="880" height="880" rx="160" fill="url(#badge-surface)" />
  <rect x="73" y="73" width="878" height="878" rx="159" fill="none" stroke="#0B1020" stroke-opacity="0.12" stroke-width="2" />
${markLayer('url(#badge-mark)', 0.67)}`;
  return document(definitions, body);
}

function faviconSvg() {
  const body = `  <rect x="40" y="40" width="944" height="944" rx="216" fill="#F8FAFC" />
  <rect x="41" y="41" width="942" height="942" rx="215" fill="none" stroke="#0B1020" stroke-opacity="0.14" stroke-width="2" />
${markLayer('#111827', 0.85)}`;
  return document('', body);
}

function trayTemplateSvg() {
  return uiMarkSvg(DARK).replace('scale(1)', 'scale(0.9)');
}

function renderSvg(scene) {
  if (scene === 'app-dark') return appIconSvg('dark');
  if (scene === 'app-light') return appIconSvg('light');
  if (scene === 'mobile-app-dark') return mobileAppIconSvg('dark');
  if (scene === 'mobile-app-light') return mobileAppIconSvg('light');
  if (scene === 'mobile-adaptive-light') return mobileAdaptiveIconSvg(LIGHT_MARK);
  if (scene === 'mobile-adaptive-monochrome') return mobileAdaptiveIconSvg(LIGHT);
  if (scene === 'desktop') return desktopIconSvg();
  if (scene === 'badge') return badgeSvg();
  if (scene === 'favicon') return faviconSvg();
  if (scene === 'tray-template') return trayTemplateSvg();
  if (scene === 'mark-light') return uiMarkSvg(LIGHT_MARK);
  if (scene === 'mark-dark') return uiMarkSvg(LIGHT);
  if (scene === 'mark-dark-plain') return uiMarkSvg(DARK);
  if (scene === 'mark-light-plain') return uiMarkSvg(LIGHT);
  throw new Error(`Unknown SVG scene: ${scene}`);
}

function renderPng(scene, size) {
  const resvg = new Resvg(renderSvg(scene), {
    fitTo: { mode: 'width', value: size },
  });
  return Buffer.from(resvg.render().asPng());
}

function makeIco(entries) {
  const directorySize = 6 + entries.length * 16;
  let offset = directorySize;
  const chunks = [Buffer.from([0, 0, 1, 0, entries.length, 0])];

  for (const { size, data } of entries) {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    chunks.push(entry);
    offset += data.length;
  }

  return Buffer.concat([...chunks, ...entries.map(({ data }) => data)]);
}

function makeIcns(entries) {
  const typeForSize = new Map([
    [16, 'icp4'],
    [32, 'icp5'],
    [64, 'icp6'],
    [128, 'ic07'],
    [256, 'ic08'],
    [512, 'ic09'],
    [1024, 'ic10'],
  ]);
  const chunks = entries.map(({ size, data }) => {
    const type = typeForSize.get(size);
    if (!type) throw new Error(`Unsupported ICNS size: ${size}`);
    const chunk = Buffer.alloc(8 + data.length);
    chunk.write(type, 0, 4, 'ascii');
    chunk.writeUInt32BE(chunk.length, 4);
    data.copy(chunk, 8);
    return chunk;
  });
  const file = Buffer.alloc(8);
  file.write('icns', 0, 4, 'ascii');
  file.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
  return Buffer.concat([file, ...chunks]);
}

const iconSizes = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024];
const renderSet = (scene) => new Map(iconSizes.map((size) => [size, renderPng(scene, size)]));
const appDarkPngs = renderSet('app-dark');
const appLightPngs = renderSet('app-light');
const mobileAppDarkPngs = renderSet('mobile-app-dark');
const mobileAppLightPngs = renderSet('mobile-app-light');
const desktopPngs = renderSet('desktop');
const badgePngs = renderSet('badge');
const faviconPngs = renderSet('favicon');
const uiLight = renderSvg('mark-light');
const uiDark = renderSvg('mark-dark');

for (const directory of ['docs/public', 'web/public', 'apps/mobile-expo/assets', 'electron/resources', 'packages/browser-ext/icons']) {
  mkdirSync(join(root, directory), { recursive: true });
}

// Docs and the gateway console: transparent marks follow the current page theme.
for (const [outputTarget, base] of [
  ['docs', 'docs/public'],
  ['web', 'web/public'],
]) {
  queue(outputTarget, `${base}/logo.svg`, uiLight);
  queue(outputTarget, `${base}/logo-dark.svg`, uiDark);
}

queue('docs', 'docs/public/apple-touch-icon.png', appDarkPngs.get(180));
queue('docs', 'docs/public/favicon.svg', renderSvg('badge'));

queue('web', 'web/public/favicon.svg', renderSvg('favicon'));
queue('web', 'web/public/favicon-icon.svg', renderSvg('favicon'));
queue('web', 'web/public/favicon.png', faviconPngs.get(192));
queue('web', 'web/public/favicon-16x16.png', faviconPngs.get(16));
queue('web', 'web/public/favicon-32x32.png', faviconPngs.get(32));
queue('web', 'web/public/apple-touch-icon.png', appDarkPngs.get(180));
queue('web', 'web/public/pwa-192x192.png', appDarkPngs.get(192));
queue('web', 'web/public/pwa-512x512.png', appDarkPngs.get(512));
queue(
  'web',
  'web/public/favicon.ico',
  makeIco([16, 32, 48].map((size) => ({ size, data: faviconPngs.get(size) }))),
);
queue(
  'web',
  'web/public/site.webmanifest',
  `${JSON.stringify(
    {
      name: 'xopc',
      short_name: 'xopc',
      description: 'A local-first AI system that keeps projects moving.',
      start_url: '/',
      display: 'standalone',
      background_color: DARK,
      theme_color: DARK,
      icons: [
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    null,
    2,
  )}\n`,
);

// Native mobile icons. iOS receives appearance-specific full-bleed PNGs; Android gets
// a transparent foreground plus the same silhouette for Android 13+ themed icons.
queue('mobile', 'apps/mobile-expo/assets/icon.png', mobileAppLightPngs.get(1024));
queue('mobile', 'apps/mobile-expo/assets/icon-light.png', mobileAppLightPngs.get(1024));
queue('mobile', 'apps/mobile-expo/assets/icon-dark.png', mobileAppDarkPngs.get(1024));
queue('mobile', 'apps/mobile-expo/assets/icon-tinted.png', mobileAppLightPngs.get(1024));
queue('mobile', 'apps/mobile-expo/assets/adaptive-icon.png', renderPng('mobile-adaptive-light', 1024));
queue('mobile', 'apps/mobile-expo/assets/adaptive-icon-monochrome.png', renderPng('mobile-adaptive-monochrome', 1024));
queue('mobile', 'apps/mobile-expo/assets/favicon.png', badgePngs.get(48));
queue('mobile', 'apps/mobile-expo/assets/splash-icon.png', renderPng('mark-dark-plain', 1024));
queue('mobile', 'apps/mobile-expo/assets/splash-icon-dark.png', renderPng('mark-light-plain', 1024));

// Desktop packaging and tray assets. The macOS tray image is a template image: Electron
// recolours it against the current menu-bar appearance after setTemplateImage(true).
queue('electron', 'electron/resources/icon.png', desktopPngs.get(1024));
queue(
  'electron',
  'electron/resources/icon.ico',
  makeIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, data: desktopPngs.get(size) }))),
);
queue(
  'electron',
  'electron/resources/icon.icns',
  makeIcns([16, 32, 64, 128, 256, 512, 1024].map((size) => ({ size, data: desktopPngs.get(size) }))),
);
queue('electron', 'electron/resources/tray-iconTemplate.png', renderPng('tray-template', 36));
queue('electron', 'electron/resources/tray-icon.png', badgePngs.get(32));
queue('electron', 'electron/resources/tray-icon-win.png', badgePngs.get(32));

for (const size of [16, 32, 48, 128]) {
  queue('browser-ext', `packages/browser-ext/icons/icon-${size}.png`, badgePngs.get(size));
}

let written = 0;
let stale = 0;
for (const { path, data } of outputs) {
  if (existsSync(path) && readFileSync(path).equals(data)) continue;
  stale += 1;
  if (!check) {
    writeFileSync(path, data);
    written += 1;
  }
}

if (check) {
  if (stale > 0) {
    console.error(`${stale} generated brand asset(s) are stale. Run: pnpm run assets:brand`);
    process.exitCode = 1;
  } else {
    console.log(`Brand assets are up to date (${outputs.length} checked).`);
  }
} else {
  console.log(`Brand assets generated from assets/brand/xopc-mark.svg (${written} written, ${outputs.length - written} unchanged).`);
}
