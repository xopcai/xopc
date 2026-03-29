#!/usr/bin/env node
/**
 * Writes src/generated/bundled-channel-plugins.ts (OpenClaw-style: one module that
 * re-exports built-in channels from extensions/* so tsc emits dist/extensions/**).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outPath = path.join(root, 'src/generated/bundled-channel-plugins.ts');

const header = `/**
 * Built-in channel plugins: sources under extensions/*, compiled to dist/extensions/*.
 * Regenerate: node scripts/generate-bundled-channel-plugins.mjs
 */

`;

const body = `export { telegramPlugin } from '../../extensions/telegram/src/index.js';
export { weixinPlugin } from '../../extensions/weixin/src/index.js';
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, header + body, 'utf8');
console.log('Wrote', path.relative(root, outPath));
