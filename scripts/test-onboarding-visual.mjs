import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { createServer } from 'vite';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const webRoot = path.join(repoRoot, 'web');
const snapshotsDir = path.join(webRoot, 'src', 'visual-tests', '__screenshots__');
const webRequire = createRequire(path.join(webRoot, 'package.json'));
const { default: react } = await import(webRequire.resolve('@vitejs/plugin-react'));
const update = process.argv.includes('--update');
const themes = ['default', 'emerald', 'clay', 'dawn'];
const modes = ['light', 'dark'];
const stages = ['setup', 'work'];
const desktopViewport = { width: 1280, height: 800 };
const regressionCases = [
  ...themes.flatMap((theme) => modes.flatMap((mode) => stages.map((stage) => ({
    theme,
    mode,
    stage,
    viewport: desktopViewport,
    name: `${stage}-${theme}-${mode}.png`,
  })))),
  ...stages.flatMap((stage) => ([
    {
      theme: 'default',
      mode: 'light',
      stage,
      viewport: { width: 375, height: 812 },
      name: `${stage}-default-light-mobile.png`,
    },
    {
      theme: 'default',
      mode: 'light',
      stage,
      viewport: { width: 812, height: 375 },
      name: `${stage}-default-light-landscape.png`,
    },
  ])),
];

async function screenshotsMatch(actual, expected) {
  if (actual.equals(expected)) return true;
  const [actualPixels, expectedPixels] = await Promise.all([
    sharp(actual).raw().toBuffer({ resolveWithObject: true }),
    sharp(expected).raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (
    actualPixels.info.width !== expectedPixels.info.width ||
    actualPixels.info.height !== expectedPixels.info.height ||
    actualPixels.info.channels !== expectedPixels.info.channels
  ) return false;

  const { channels, width, height } = actualPixels.info;
  let changedPixels = 0;
  for (let offset = 0; offset < actualPixels.data.length; offset += channels) {
    let maxChannelDelta = 0;
    for (let channel = 0; channel < Math.min(channels, 3); channel += 1) {
      maxChannelDelta = Math.max(
        maxChannelDelta,
        Math.abs(actualPixels.data[offset + channel] - expectedPixels.data[offset + channel]),
      );
    }
    if (maxChannelDelta > 8) changedPixels += 1;
  }
  return changedPixels / (width * height) <= 0.0005;
}

await mkdir(snapshotsDir, { recursive: true });

const server = await createServer({
  root: webRoot,
  configFile: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.join(webRoot, 'src') } },
  server: { host: '127.0.0.1', port: 0 },
});

let browser;
let failures = 0;

try {
  await server.listen();
  const baseUrl = server.resolvedUrls?.local[0];
  if (!baseUrl) throw new Error('Vite did not expose a local visual-test URL.');

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: desktopViewport,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  for (const { theme, mode, stage, viewport, name } of regressionCases) {
        await page.setViewportSize(viewport);
        const snapshotPath = path.join(snapshotsDir, name);
        const url = new URL('/onboarding-visual.html', baseUrl);
        url.searchParams.set('theme', theme);
        url.searchParams.set('mode', mode);
        url.searchParams.set('stage', stage);

        await page.goto(url.href, { waitUntil: 'networkidle' });
        await page.addStyleTag({
          content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
        });
        await page.locator(stage === 'setup' ? '.xopc-onboarding-stage' : '.xopc-discovery-logo').waitFor();
        const actual = await page.screenshot({ animations: 'disabled', fullPage: false });

        if (update) {
          await writeFile(snapshotPath, actual);
          console.log(`updated ${name}`);
          continue;
        }

        let expected;
        try {
          expected = await readFile(snapshotPath);
        } catch {
          console.error(`missing ${name}; run pnpm test:web:onboarding-visual:update`);
          failures += 1;
          continue;
        }
        if (!(await screenshotsMatch(actual, expected))) {
          const actualPath = path.join(snapshotsDir, `${name.slice(0, -4)}.actual.png`);
          await writeFile(actualPath, actual);
          console.error(`changed ${name}; actual image written to ${path.relative(repoRoot, actualPath)}`);
          failures += 1;
        } else {
          console.log(`matched ${name}`);
        }
  }

  await context.close();
} finally {
  await browser?.close();
  await server.close();
}

if (failures > 0) process.exitCode = 1;
