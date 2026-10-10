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
import sharp from 'sharp';
import { optimize } from 'svgo';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'assets/brand/xopc-mark.svg');
const markSource = readFileSync(sourcePath, 'utf8');
const markRoot = markSource.match(/<svg\b[^>]*>/i)?.[0];
const mark = markSource.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1]?.trim();
const markViewBox = markRoot?.match(/\bviewBox=(["'])(.*?)\1/i)?.[2];
const markSegments = mark?.match(/<circle\b[^>]*\/>/g);

if (!mark || !markViewBox || markSegments?.length !== 2) {
  throw new Error(`Could not read SVG artwork from ${sourcePath}`);
}

const [aiMarkSegment, humanMarkSegment] = markSegments;

const check = process.argv.includes('--check');
const requestedTarget = process.argv.find((argument) => argument.startsWith('--target='))?.slice('--target='.length);
const validTargets = new Set(['all', 'web', 'docs', 'harmony', 'android', 'ios', 'electron', 'browser-ext']);
const target = requestedTarget ?? 'all';

if (!validTargets.has(target)) {
  throw new Error(`Unknown --target value ${JSON.stringify(target)}. Use ${[...validTargets].join(', ')}.`);
}

const DARK = '#0B0D10';
const LIGHT = '#F8FAFC';
const AI_LIGHT = '#1D1D1F';
const AI_DARK = '#F5F5F7';
const HUMAN_LIGHT = '#007AFF';
const HUMAN_DARK = '#0A84FF';
const SOURCE_HUMAN = '#007AFF';
// Keep the mobile glyph inside the conservative iOS/Android launcher safe zone.
// The canonical mark occupies ~78% of its source canvas, so 0.76 yields a
// visible footprint of ~59% while remaining inside Android's 66dp safe zone.
const MOBILE_MARK_SCALE = 0.76;
// Harmony uses a flat launcher resource rather than Android's overscanned
// adaptive foreground. Give it its own optical scale so the mark keeps a calm
// safe area after the launcher applies its mask.
const HARMONY_MARK_SCALE = 0.86;
// Match Android's 8% foreground inset after its adaptive 108dp canvas is cropped to 72dp.
const IOS_MARK_SCALE = 0.84;
const DESKTOP_MARK_SCALE = 0.78;

const ROLE_LIGHT = { ai: AI_LIGHT, human: HUMAN_LIGHT };
const ROLE_DARK = { ai: AI_DARK, human: HUMAN_DARK };

const outputs = [];

function isEnabled(outputTarget) {
  return target === 'all' || target === outputTarget;
}

function queue(outputTarget, relativePath, data) {
  if (!isEnabled(outputTarget)) return;
  const output = outputTarget === 'web' && relativePath.endsWith('.svg') && typeof data === 'string'
    ? optimize(data, {
      multipass: true,
      path: relativePath,
      plugins: [{
        name: 'preset-default',
        params: {
          overrides: {
            cleanupNumericValues: { floatPrecision: 1 },
            convertPathData: { floatPrecision: 1 },
          },
        },
      }],
    }).data
    : data;
  outputs.push({ path: join(root, relativePath), data: Buffer.isBuffer(output) ? output : Buffer.from(output) });
}

function document(definitions, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">\n${definitions ? `  <defs>${definitions}</defs>\n` : ''}${body}\n</svg>\n`;
}

function markLayer(palette, scale = 1, offsetX = 0, offsetY = 0) {
  const colours = typeof palette === 'string' ? { ai: palette, human: palette } : palette;
  const recolouredMark = mark
    .replaceAll(SOURCE_HUMAN, colours.human)
    .replaceAll('currentColor', colours.ai);
  return `  <g transform="translate(${512 + offsetX} ${512 + offsetY}) scale(${scale}) translate(-512 -512)">\n    <svg width="1024" height="1024" viewBox="${markViewBox}">\n      ${recolouredMark}\n    </svg>\n  </g>`;
}

function segmentLayer(segment, colour, scale = 1, offsetX = 0, offsetY = 0) {
  const recolouredSegment = segment
    .replaceAll(SOURCE_HUMAN, colour)
    .replaceAll('currentColor', colour);
  return `  <g transform="translate(${512 + offsetX} ${512 + offsetY}) scale(${scale}) translate(-512 -512)">
    <svg width="1024" height="1024" viewBox="${markViewBox}">
      ${recolouredSegment}
    </svg>
  </g>`;
}

function uiMarkSvg(palette, scale = 1, offsetX = 0, offsetY = 0) {
  return document('', markLayer(palette, scale, offsetX, offsetY));
}

function appIconSvg(appearance, options = {}) {
  const isDark = appearance === 'dark';
  const {
    markScale = 0.88,
    markOffsetX = 0,
    markOffsetY = 0,
  } = options;
  const rolePalette = isDark ? ROLE_DARK : ROLE_LIGHT;
  const surface = isDark ? '#000000' : '#FFFFFF';
  const body = `  <rect width="1024" height="1024" fill="${surface}" />
${markLayer(rolePalette, markScale, markOffsetX, markOffsetY)}`;
  return document('', body);
}

function mobileAppIconSvg(appearance) {
  const isDark = appearance === 'dark';
  const isTinted = appearance === 'tinted';
  const definitions = isTinted
    ? `
    <linearGradient id="mobile-surface" x1="112" y1="88" x2="904" y2="936" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF" />
      <stop offset="0.5" stop-color="#F1F1F1" />
      <stop offset="1" stop-color="#DCDCDC" />
    </linearGradient>
    <radialGradient id="mobile-bloom" cx="0" cy="0" r="1" gradientTransform="translate(746 224) rotate(132) scale(620)">
      <stop stop-color="#FFFFFF" stop-opacity="0.98" />
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="mobile-ambient" cx="0" cy="0" r="1" gradientTransform="translate(270 850) rotate(-48) scale(660)">
      <stop stop-color="#8A8A8A" stop-opacity="0.18" />
      <stop offset="1" stop-color="#8A8A8A" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="mobile-mono" x1="330" y1="248" x2="704" y2="790" gradientUnits="userSpaceOnUse">
      <stop stop-color="#080808" />
      <stop offset="0.55" stop-color="#222222" />
      <stop offset="1" stop-color="#525252" />
    </linearGradient>
    <linearGradient id="mobile-highlight" x1="300" y1="210" x2="660" y2="690" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF" stop-opacity="0.36" />
      <stop offset="0.44" stop-color="#FFFFFF" stop-opacity="0.08" />
      <stop offset="0.68" stop-color="#FFFFFF" stop-opacity="0" />
    </linearGradient>
    <filter id="mobile-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#111111" flood-opacity="0.16" />
    </filter>`
    : isDark
      ? `
    <linearGradient id="mobile-surface" x1="104" y1="72" x2="920" y2="952" gradientUnits="userSpaceOnUse">
      <stop stop-color="#202634" />
      <stop offset="0.52" stop-color="#0E121A" />
      <stop offset="1" stop-color="#030509" />
    </linearGradient>
    <radialGradient id="mobile-bloom" cx="0" cy="0" r="1" gradientTransform="translate(754 210) rotate(132) scale(640)">
      <stop stop-color="#7B91B5" stop-opacity="0.34" />
      <stop offset="1" stop-color="#52627C" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="mobile-ambient" cx="0" cy="0" r="1" gradientTransform="translate(236 854) rotate(-48) scale(700)">
      <stop stop-color="#254A81" stop-opacity="0.22" />
      <stop offset="1" stop-color="#254A81" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="mobile-ai" x1="326" y1="244" x2="704" y2="792" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF" />
      <stop offset="0.52" stop-color="#EEF1F6" />
      <stop offset="1" stop-color="#C8D0DD" />
    </linearGradient>
    <linearGradient id="mobile-human" x1="548" y1="228" x2="790" y2="500" gradientUnits="userSpaceOnUse">
      <stop stop-color="#55B2FF" />
      <stop offset="0.48" stop-color="#168DFF" />
      <stop offset="1" stop-color="#0065DE" />
    </linearGradient>
    <linearGradient id="mobile-highlight" x1="300" y1="210" x2="660" y2="690" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF" stop-opacity="0.34" />
      <stop offset="0.42" stop-color="#FFFFFF" stop-opacity="0.06" />
      <stop offset="0.66" stop-color="#FFFFFF" stop-opacity="0" />
    </linearGradient>
    <filter id="mobile-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="20" stdDeviation="24" flood-color="#000000" flood-opacity="0.42" />
    </filter>`
      : `
    <linearGradient id="mobile-surface" x1="104" y1="72" x2="920" y2="952" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF" />
      <stop offset="0.52" stop-color="#F0F3F9" />
      <stop offset="1" stop-color="#DCE2ED" />
    </linearGradient>
    <radialGradient id="mobile-bloom" cx="0" cy="0" r="1" gradientTransform="translate(754 210) rotate(132) scale(640)">
      <stop stop-color="#FFFFFF" />
      <stop offset="0.5" stop-color="#A8B9E6" stop-opacity="0.28" />
      <stop offset="1" stop-color="#B9C6E8" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="mobile-ambient" cx="0" cy="0" r="1" gradientTransform="translate(250 850) rotate(-48) scale(680)">
      <stop stop-color="#829AD0" stop-opacity="0.24" />
      <stop offset="1" stop-color="#829AD0" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="mobile-ai" x1="326" y1="244" x2="704" y2="792" gradientUnits="userSpaceOnUse">
      <stop stop-color="#07090D" />
      <stop offset="0.52" stop-color="#181D28" />
      <stop offset="1" stop-color="#3D485E" />
    </linearGradient>
    <linearGradient id="mobile-human" x1="548" y1="228" x2="790" y2="500" gradientUnits="userSpaceOnUse">
      <stop stop-color="#42A9FF" />
      <stop offset="0.48" stop-color="#0C84FF" />
      <stop offset="1" stop-color="#005DCE" />
    </linearGradient>
    <linearGradient id="mobile-highlight" x1="300" y1="210" x2="660" y2="690" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF" stop-opacity="0.32" />
      <stop offset="0.42" stop-color="#FFFFFF" stop-opacity="0.06" />
      <stop offset="0.66" stop-color="#FFFFFF" stop-opacity="0" />
    </linearGradient>
    <filter id="mobile-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="20" stdDeviation="24" flood-color="#26334D" flood-opacity="0.24" />
    </filter>`;
  const palette = isTinted
    ? { ai: 'url(#mobile-mono)', human: 'url(#mobile-mono)' }
    : { ai: 'url(#mobile-ai)', human: 'url(#mobile-human)' };
  const body = `  <rect width="1024" height="1024" fill="url(#mobile-surface)" />
  <rect width="1024" height="1024" fill="url(#mobile-ambient)" />
  <rect width="1024" height="1024" fill="url(#mobile-bloom)" />
  <g filter="url(#mobile-shadow)">
${markLayer(palette, MOBILE_MARK_SCALE)}
  </g>
${markLayer({ ai: 'url(#mobile-highlight)', human: 'url(#mobile-highlight)' }, MOBILE_MARK_SCALE)}`;
  return document(definitions, body);
}

function mobileAdaptiveIconSvg(palette) {
  const definitions = `
    <linearGradient id="adaptive-ai" x1="326" y1="244" x2="704" y2="792" gradientUnits="userSpaceOnUse">
      <stop stop-color="#07090D" />
      <stop offset="0.52" stop-color="#181D28" />
      <stop offset="1" stop-color="#3D485E" />
    </linearGradient>
    <linearGradient id="adaptive-human" x1="548" y1="228" x2="790" y2="500" gradientUnits="userSpaceOnUse">
      <stop stop-color="#42A9FF" />
      <stop offset="0.48" stop-color="#0C84FF" />
      <stop offset="1" stop-color="#005DCE" />
    </linearGradient>`;
  const rolePalette = typeof palette === 'string'
    ? palette
    : { ai: 'url(#adaptive-ai)', human: 'url(#adaptive-human)' };
  return document(definitions, markLayer(rolePalette, MOBILE_MARK_SCALE));
}

function adaptiveBackgroundSvg() {
  const definitions = `
    <linearGradient id="adaptive-surface" x1="92" y1="70" x2="930" y2="956" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF" />
      <stop offset="0.52" stop-color="#EEF2F8" />
      <stop offset="1" stop-color="#DCE3EE" />
    </linearGradient>
    <radialGradient id="adaptive-bloom" cx="0" cy="0" r="1" gradientTransform="translate(760 214) rotate(132) scale(650)">
      <stop stop-color="#FFFFFF" />
      <stop offset="0.5" stop-color="#A8B9E6" stop-opacity="0.3" />
      <stop offset="1" stop-color="#B8C5E6" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="adaptive-ambient" cx="0" cy="0" r="1" gradientTransform="translate(246 850) rotate(-48) scale(690)">
      <stop stop-color="#829AD0" stop-opacity="0.26" />
      <stop offset="1" stop-color="#829AD0" stop-opacity="0" />
    </radialGradient>`;
  const body = `  <rect width="1024" height="1024" fill="url(#adaptive-surface)" />
  <rect width="1024" height="1024" fill="url(#adaptive-ambient)" />
  <rect width="1024" height="1024" fill="url(#adaptive-bloom)" />`;
  return document(definitions, body);
}

function harmonyAppIconSvg(foregroundScale = 1) {
  const definitions = `
    <linearGradient id="harmony-surface" x1="92" y1="68" x2="934" y2="960" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF" />
      <stop offset="0.5" stop-color="#EFF3F9" />
      <stop offset="1" stop-color="#DDE5EF" />
    </linearGradient>
    <radialGradient id="harmony-bloom" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(752 202) rotate(132) scale(654)">
      <stop stop-color="#FFFFFF" />
      <stop offset="0.5" stop-color="#A8B9E6" stop-opacity="0.28" />
      <stop offset="1" stop-color="#B8C5E6" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="harmony-ambient" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(244 852) rotate(-48) scale(690)">
      <stop stop-color="#7896CF" stop-opacity="0.24" />
      <stop offset="1" stop-color="#829AD0" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="harmony-glass-sheen" x1="188" y1="102" x2="838" y2="920" gradientUnits="userSpaceOnUse">
      <stop offset="0.22" stop-color="#FFFFFF" stop-opacity="0" />
      <stop offset="0.43" stop-color="#FFFFFF" stop-opacity="0.32" />
      <stop offset="0.56" stop-color="#FFFFFF" stop-opacity="0.1" />
      <stop offset="0.73" stop-color="#FFFFFF" stop-opacity="0" />
    </linearGradient>
    <radialGradient id="harmony-lens" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(438 420) rotate(49) scale(334)">
      <stop stop-color="#FFFFFF" stop-opacity="0.56" />
      <stop offset="0.58" stop-color="#EDF3FB" stop-opacity="0.4" />
      <stop offset="1" stop-color="#B8C6D9" stop-opacity="0.28" />
    </radialGradient>
    <radialGradient id="harmony-lens-glint" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(424 402) rotate(36) scale(176 112)">
      <stop stop-color="#FFFFFF" stop-opacity="0.34" />
      <stop offset="0.46" stop-color="#FFFFFF" stop-opacity="0.1" />
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="harmony-ai" x1="326" y1="244" x2="704" y2="792" gradientUnits="userSpaceOnUse">
      <stop stop-color="#05070B" />
      <stop offset="0.48" stop-color="#1A2130" />
      <stop offset="1" stop-color="#46546B" />
    </linearGradient>
    <linearGradient id="harmony-human" x1="548" y1="228" x2="790" y2="500" gradientUnits="userSpaceOnUse">
      <stop stop-color="#52B0FF" />
      <stop offset="0.46" stop-color="#148DFF" />
      <stop offset="1" stop-color="#0059C7" />
    </linearGradient>
    <linearGradient id="harmony-highlight" x1="300" y1="210" x2="660" y2="690" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF" stop-opacity="0.38" />
      <stop offset="0.4" stop-color="#FFFFFF" stop-opacity="0.07" />
      <stop offset="0.66" stop-color="#FFFFFF" stop-opacity="0" />
    </linearGradient>
    <filter id="harmony-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#26334D" flood-opacity="0.2" />
    </filter>
    <filter id="harmony-lens-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="6" stdDeviation="16" flood-color="#4B6184" flood-opacity="0.08" />
    </filter>`;
  const body = `  <rect width="1024" height="1024" fill="url(#harmony-surface)" />
  <rect width="1024" height="1024" fill="url(#harmony-ambient)" />
  <rect width="1024" height="1024" fill="url(#harmony-bloom)" />
  <rect width="1024" height="1024" fill="url(#harmony-glass-sheen)" />
${foregroundScale === 1 ? '' : `  <g transform="translate(512 512) scale(${foregroundScale}) translate(-512 -512)">\n`}  <circle cx="512" cy="512" r="224" fill="url(#harmony-lens)" filter="url(#harmony-lens-shadow)" />
  <circle cx="512" cy="512" r="218" fill="url(#harmony-lens-glint)" />
  <circle cx="512" cy="512" r="222" fill="none" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="2" />
  <g filter="url(#harmony-shadow)" opacity="0.58">
${markLayer({ ai: '#0C1423', human: '#004CA8' }, HARMONY_MARK_SCALE, 0, 6)}
  </g>
  <g opacity="0.3">
${markLayer({ ai: '#FFFFFF', human: '#B9E2FF' }, HARMONY_MARK_SCALE, 0, -3)}
  </g>
${markLayer({ ai: 'url(#harmony-ai)', human: 'url(#harmony-human)' }, HARMONY_MARK_SCALE)}
${markLayer({ ai: 'url(#harmony-highlight)', human: 'url(#harmony-highlight)' }, HARMONY_MARK_SCALE)}${foregroundScale === 1 ? '' : '\n  </g>'}`;
  return document(definitions, body);
}

function desktopIconSvg(platform = 'mac', size = 1024) {
  const isMicro = size <= 48;
  const plateInset = isMicro ? 48 : platform === 'mac' ? 56 : 64;
  const plateSize = 1024 - plateInset * 2;
  const plateRadius = isMicro ? 244 : platform === 'mac' ? 264 : 228;
  const markScale = isMicro ? 0.86 : DESKTOP_MARK_SCALE;
  const definitions = `
    <linearGradient id="desktop-surface" x1="118" y1="98" x2="900" y2="930" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FCFDFF" />
      <stop offset="0.52" stop-color="#EFF2F8" />
      <stop offset="1" stop-color="#E4E8F1" />
    </linearGradient>
    <radialGradient id="desktop-bloom" cx="0" cy="0" r="1" gradientTransform="translate(760 250) rotate(130) scale(590)">
      <stop stop-color="#FFFFFF" stop-opacity="0.94" />
      <stop offset="0.5" stop-color="#AEB9DF" stop-opacity="0.2" />
      <stop offset="1" stop-color="#AEB9DF" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="desktop-ai" x1="326" y1="244" x2="704" y2="792" gradientUnits="userSpaceOnUse">
      <stop stop-color="#111318" />
      <stop offset="1" stop-color="#303746" />
    </linearGradient>
    <linearGradient id="desktop-human" x1="548" y1="228" x2="790" y2="500" gradientUnits="userSpaceOnUse">
      <stop stop-color="#168DFF" />
      <stop offset="1" stop-color="#0069E8" />
    </linearGradient>`;
  const outline = isMicro
    ? ''
    : `
  <rect x="${plateInset + 1}" y="${plateInset + 1}" width="${plateSize - 2}" height="${plateSize - 2}" rx="${plateRadius - 1}" fill="none" stroke="#FFFFFF" stroke-opacity="0.82" stroke-width="2" />`;
  const bloom = isMicro
    ? ''
    : `
  <rect x="${plateInset}" y="${plateInset}" width="${plateSize}" height="${plateSize}" rx="${plateRadius}" fill="url(#desktop-bloom)" />`;
  const markPalette = isMicro
    ? ROLE_LIGHT
    : { ai: 'url(#desktop-ai)', human: 'url(#desktop-human)' };
  const body = `  <rect x="${plateInset}" y="${plateInset}" width="${plateSize}" height="${plateSize}" rx="${plateRadius}" fill="url(#desktop-surface)" />${bloom}${outline}
${markLayer(markPalette, markScale)}`;
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
${markLayer(ROLE_LIGHT, 0.82)}`;
  return document(definitions, body);
}

function faviconSvg() {
  const body = `  <rect x="40" y="40" width="944" height="944" rx="216" fill="#F8FAFC" />
  <rect x="41" y="41" width="942" height="942" rx="215" fill="none" stroke="#0B1020" stroke-opacity="0.14" stroke-width="2" />
${markLayer(ROLE_LIGHT, 0.9)}`;
  return document('', body);
}

function trayTemplateSvg() {
  return uiMarkSvg(DARK).replace('scale(1)', 'scale(0.9)');
}

function appleIconLayerSvg(role, appearance = 'light') {
  if (role === 'background') {
    const isDark = appearance === 'dark';
    const definitions = isDark
      ? `
    <linearGradient id="apple-layer-surface" x1="104" y1="72" x2="920" y2="952" gradientUnits="userSpaceOnUse">
      <stop stop-color="#171A22" />
      <stop offset="0.56" stop-color="#0D1016" />
      <stop offset="1" stop-color="#05070B" />
    </linearGradient>`
      : `
    <linearGradient id="apple-layer-surface" x1="104" y1="72" x2="920" y2="952" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FCFDFF" />
      <stop offset="0.56" stop-color="#F2F4F9" />
      <stop offset="1" stop-color="#E7EAF2" />
    </linearGradient>`;
    return document(definitions, '  <rect width="1024" height="1024" fill="url(#apple-layer-surface)" />');
  }
  if (role === 'mono') return document('', markLayer('#FFFFFF', MOBILE_MARK_SCALE));
  const isDark = appearance === 'dark';
  const colour = role === 'ai'
    ? (isDark ? AI_DARK : AI_LIGHT)
    : (isDark ? HUMAN_DARK : HUMAN_LIGHT);
  const segment = role === 'ai' ? aiMarkSegment : humanMarkSegment;
  return document('', segmentLayer(segment, colour, MOBILE_MARK_SCALE));
}

function renderSvg(scene, size = 1024) {
  if (scene === 'app-dark') return appIconSvg('dark');
  if (scene === 'app-light') return appIconSvg('light');
  if (scene === 'mobile-app-dark') return mobileAppIconSvg('dark');
  if (scene === 'mobile-app-light') return mobileAppIconSvg('light');
  if (scene === 'mobile-app-tinted') return mobileAppIconSvg('tinted');
  if (scene === 'mobile-adaptive-light') return mobileAdaptiveIconSvg(ROLE_LIGHT);
  if (scene === 'mobile-adaptive-monochrome') return mobileAdaptiveIconSvg(LIGHT);
  if (scene === 'mobile-adaptive-background') return adaptiveBackgroundSvg();
  if (scene === 'harmony-app-light') return harmonyAppIconSvg();
  if (scene === 'ios-app-light') return harmonyAppIconSvg(IOS_MARK_SCALE / HARMONY_MARK_SCALE);
  if (scene === 'desktop-mac') return desktopIconSvg('mac', size);
  if (scene === 'desktop-windows') return desktopIconSvg('windows', size);
  if (scene === 'desktop-linux') return desktopIconSvg('linux', size);
  if (scene === 'apple-layer-background-light') return appleIconLayerSvg('background', 'light');
  if (scene === 'apple-layer-background-dark') return appleIconLayerSvg('background', 'dark');
  if (scene === 'apple-layer-ai-light') return appleIconLayerSvg('ai', 'light');
  if (scene === 'apple-layer-ai-dark') return appleIconLayerSvg('ai', 'dark');
  if (scene === 'apple-layer-human-light') return appleIconLayerSvg('human', 'light');
  if (scene === 'apple-layer-human-dark') return appleIconLayerSvg('human', 'dark');
  if (scene === 'apple-layer-mono') return appleIconLayerSvg('mono');
  if (scene === 'badge') return badgeSvg();
  if (scene === 'favicon') return faviconSvg();
  if (scene === 'tray-template') return trayTemplateSvg();
  if (scene === 'mark-light') return uiMarkSvg(ROLE_LIGHT);
  if (scene === 'mark-dark') return uiMarkSvg(ROLE_DARK);
  if (scene === 'mark-dark-plain') return uiMarkSvg(ROLE_LIGHT);
  if (scene === 'mark-light-plain') return uiMarkSvg(ROLE_DARK);
  throw new Error(`Unknown SVG scene: ${scene}`);
}

function renderPng(scene, size) {
  const resvg = new Resvg(renderSvg(scene, size), {
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
const desktopMacPngs = renderSet('desktop-mac');
const desktopWindowsPngs = renderSet('desktop-windows');
const desktopLinuxPngs = renderSet('desktop-linux');
const badgePngs = renderSet('badge');
const faviconPngs = renderSet('favicon');
const uiLight = renderSvg('mark-light');
const uiDark = renderSvg('mark-dark');

for (const directory of ['docs/public', 'web/public', 'electron/resources', 'packages/browser-ext/icons']) {
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

// Preserve the mobile artwork, compensating for Android's adaptive viewport.
queue('harmony', 'apps/mobile-harmony/AppScope/resources/base/media/app_icon.png', renderPng('harmony-app-light', 1024));
queue('android', 'apps/mobile-android/app/src/main/res/drawable-nodpi/launcher_artwork.png', renderPng('harmony-app-light', 1024));
queue('harmony', 'apps/mobile-harmony/agc-locales/zh-CN/app-icon-1024.png', renderPng('harmony-app-light', 1024));
for (const [appearance, qualifier] of [['light', 'base'], ['dark', 'dark']]) {
  queue('harmony', `apps/mobile-harmony/entry/src/main/resources/${qualifier}/media/brand_logo.svg`,
    readFileSync(join(root, `assets/brand/concepts/xopc-human-ai-loop-role-${appearance}.svg`)));
}

if (isEnabled('ios')) {
  queue('ios', 'apps/mobile-ios/XopcMobile/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png',
    await sharp(renderPng('ios-app-light', 1024)).removeAlpha().png().toBuffer());
}

// Desktop packaging and tray assets. The macOS tray image is a template image: Electron
// recolours it against the current menu-bar appearance after setTemplateImage(true).
queue('electron', 'electron/resources/icon.png', desktopLinuxPngs.get(1024));
queue(
  'electron',
  'electron/resources/icon.ico',
  makeIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, data: desktopWindowsPngs.get(size) }))),
);
queue(
  'electron',
  'electron/resources/icon.icns',
  makeIcns([16, 32, 64, 128, 256, 512, 1024].map((size) => ({ size, data: desktopMacPngs.get(size) }))),
);
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
  queue('electron', `electron/resources/icons/${size}x${size}.png`, renderPng('desktop-linux', size));
}
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
    mkdirSync(dirname(path), { recursive: true });
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
