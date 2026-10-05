#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const androidGradlePath = join(root, 'apps/mobile-android/app/build.gradle.kts');
const iosProjectPath = join(root, 'apps/mobile-ios/project.yml');

const androidGradle = readFileSync(androidGradlePath, 'utf8');
const iosProject = readFileSync(iosProjectPath, 'utf8');

const matchOne = (source, pattern, label) => {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label}; found ${matches.length}`);
  }
  return matches[0];
};

const androidVersionMatch = matchOne(
  androidGradle,
  /^\s*versionName\s*=\s*"(\d+\.\d+\.\d+)"\s*$/gm,
  'Android versionName',
);
const androidCodeMatch = matchOne(
  androidGradle,
  /^\s*versionCode\s*=\s*(\d+)\s*$/gm,
  'Android versionCode',
);
const iosVersionMatch = matchOne(
  iosProject,
  /^\s*MARKETING_VERSION:\s*(\d+\.\d+\.\d+)\s*$/gm,
  'iOS MARKETING_VERSION',
);

const androidVersion = androidVersionMatch[1];
const iosVersion = iosVersionMatch[1];
if (androidVersion !== iosVersion) {
  throw new Error(`Native mobile versions differ: Android=${androidVersion}, iOS=${iosVersion}`);
}

const androidVersionCode = Number.parseInt(androidCodeMatch[1], 10);
if (!Number.isSafeInteger(androidVersionCode) || androidVersionCode < 1) {
  throw new Error(`Invalid Android versionCode: ${androidCodeMatch[1]}`);
}

const [major, minor, patch] = androidVersion.split('.').map((part) => Number.parseInt(part, 10));
const nextVersion = `${major}.${minor}.${patch + 1}`;

if (process.argv.includes('--print-current')) {
  process.stdout.write(androidVersion);
  process.exit(0);
}
if (process.argv.includes('--print-next')) {
  process.stdout.write(nextVersion);
  process.exit(0);
}

const nextAndroidGradle = androidGradle
  .replace(androidVersionMatch[0], androidVersionMatch[0].replace(androidVersion, nextVersion))
  .replace(androidCodeMatch[0], androidCodeMatch[0].replace(androidCodeMatch[1], String(androidVersionCode + 1)));
const nextIosProject = iosProject.replace(
  iosVersionMatch[0],
  iosVersionMatch[0].replace(iosVersion, nextVersion),
);

writeFileSync(androidGradlePath, nextAndroidGradle);
writeFileSync(iosProjectPath, nextIosProject);
process.stdout.write(nextVersion);
