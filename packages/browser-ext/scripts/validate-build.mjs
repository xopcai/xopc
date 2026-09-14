#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, '..');
const repositoryRoot = resolve(packageRoot, '../..');
const manifestPath = join(packageRoot, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const rootPackage = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
const errors = [];

function cssBlock(source, selector, occurrence = 0) {
  let selectorIndex = -1;
  let searchFrom = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    selectorIndex = source.indexOf(selector, searchFrom);
    if (selectorIndex < 0) return undefined;
    searchFrom = selectorIndex + selector.length;
  }

  const openIndex = source.indexOf('{', selectorIndex + selector.length);
  if (openIndex < 0) return undefined;
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openIndex + 1, index);
  }
  return undefined;
}

function cssVariable(block, name) {
  if (!block) return undefined;
  return new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^;]+);`)
    .exec(block)?.[1]
    ?.trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function extensionIdFromManifestKey(key) {
  const digest = createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16);
  return [...digest].map((byte) =>
    `${String.fromCharCode(97 + (byte >> 4))}${String.fromCharCode(97 + (byte & 0x0f))}`,
  ).join('');
}

if (manifest.version !== rootPackage.version) {
  errors.push(
    `manifest version ${manifest.version ?? 'missing'} does not match root package version ${rootPackage.version ?? 'missing'}`,
  );
}

const identitySource = readFileSync(join(repositoryRoot, 'src/browser/extension-identity.ts'), 'utf8');
const configuredExtensionId = /BROWSER_EXTENSION_ID\s*=\s*'([a-p]{32})'/.exec(identitySource)?.[1];
const manifestExtensionId = typeof manifest.key === 'string'
  ? extensionIdFromManifestKey(manifest.key)
  : undefined;
if (!configuredExtensionId || !manifestExtensionId || configuredExtensionId !== manifestExtensionId) {
  errors.push(
    `manifest key resolves to ${manifestExtensionId ?? 'missing'}, but gateway expects ${configuredExtensionId ?? 'missing'}`,
  );
}

const manifestPermissions = new Set(manifest.permissions ?? []);
if (!manifestPermissions.has('scripting') || !manifestPermissions.has('tabs')) {
  errors.push('manifest must include scripting and tabs permissions for page context capture');
}
const optionalHostPermissions = new Set(manifest.optional_host_permissions ?? []);
if (!optionalHostPermissions.has('http://*/*') || !optionalHostPermissions.has('https://*/*')) {
  errors.push('manifest must allow optional per-site http(s) access for page context capture');
}

if (manifest.default_locale !== 'en') {
  errors.push('manifest default_locale must be en');
}
for (const [field, value] of [
  ['name', manifest.name],
  ['description', manifest.description],
  ['action.default_title', manifest.action?.default_title],
]) {
  if (typeof value !== 'string' || !/^__MSG_[A-Za-z0-9_]+__$/.test(value)) {
    errors.push(`manifest ${field} must use a localized __MSG_*__ value`);
  }
}

const localeCatalogs = new Map();
for (const locale of ['en', 'zh_CN']) {
  const localePath = join(packageRoot, '_locales', locale, 'messages.json');
  if (!existsSync(localePath)) {
    errors.push(`missing locale catalog: _locales/${locale}/messages.json`);
    continue;
  }
  try {
    const catalog = JSON.parse(readFileSync(localePath, 'utf8'));
    localeCatalogs.set(locale, catalog);
    for (const [key, entry] of Object.entries(catalog)) {
      if (!entry || typeof entry !== 'object' || typeof entry.message !== 'string' || !entry.message.trim()) {
        errors.push(`locale ${locale} has an invalid message: ${key}`);
      }
    }
  } catch (cause) {
    errors.push(`locale ${locale} is invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

const englishKeys = Object.keys(localeCatalogs.get('en') ?? {}).sort();
const chineseKeys = Object.keys(localeCatalogs.get('zh_CN') ?? {}).sort();
if (englishKeys.join('\n') !== chineseKeys.join('\n')) {
  errors.push('English and Simplified Chinese locale catalogs must contain the same message keys');
}

const englishCatalog = localeCatalogs.get('en') ?? {};
for (const value of [manifest.name, manifest.description, manifest.action?.default_title]) {
  const key = typeof value === 'string' ? /^__MSG_([A-Za-z0-9_]+)__$/.exec(value)?.[1] : undefined;
  if (key && !englishCatalog[key]) errors.push(`manifest references missing locale message: ${key}`);
}

function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

for (const sourcePath of collectSourceFiles(join(packageRoot, 'src'))) {
  const source = readFileSync(sourcePath, 'utf8');
  for (const match of source.matchAll(/\bt\('([^']+)'/g)) {
    if (!englishCatalog[match[1]]) errors.push(`source references missing locale message: ${match[1]}`);
  }
}

const gatewayThemeSource = readFileSync(join(repositoryRoot, 'web/src/styles/globals.css'), 'utf8');
const extensionThemeSource = readFileSync(join(packageRoot, 'src/sidepanel/styles.css'), 'utf8');
const gatewayThemeBlocks = {
  light: cssBlock(gatewayThemeSource, '@theme'),
  dark: cssBlock(gatewayThemeSource, 'html.dark'),
};
const extensionThemeBlocks = {
  light: cssBlock(extensionThemeSource, ':root'),
  dark: cssBlock(extensionThemeSource, ":root[data-theme='dark']"),
};
const extensionThemeTokens = [
  'surface-base',
  'surface-panel',
  'surface-hover',
  'surface-active',
  'fg',
  'fg-muted',
  'fg-subtle',
  'fg-disabled',
  'edge-subtle',
  'edge',
  'edge-strong',
  'accent',
  'accent-hover',
  'accent-soft',
  'accent-fg',
  'success',
  'success-soft',
  'danger',
  'danger-soft',
  'warning',
  'warning-soft',
];

for (const mode of ['light', 'dark']) {
  for (const token of extensionThemeTokens) {
    const gatewayValue = cssVariable(gatewayThemeBlocks[mode], `--color-${token}`);
    const extensionValue = cssVariable(extensionThemeBlocks[mode], `--${token}`);
    if (!gatewayValue || !extensionValue || gatewayValue !== extensionValue) {
      errors.push(
        `${mode} theme token ${token} differs: extension=${extensionValue ?? 'missing'}, gateway=${gatewayValue ?? 'missing'}`,
      );
    }
  }
}

const requiredPaths = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...(manifest.content_scripts ?? []).flatMap(contentScript => contentScript.js ?? []),
].filter((value) => typeof value === 'string' && value.length > 0);

for (const requiredPath of requiredPaths) {
  if (!existsSync(join(packageRoot, requiredPath))) {
    errors.push(`manifest references missing file: ${requiredPath}`);
  }
}

const sidePanelPath = join(packageRoot, manifest.side_panel?.default_path ?? 'dist/sidepanel.html');
if (existsSync(sidePanelPath)) {
  const html = readFileSync(sidePanelPath, 'utf8');
  const references = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]);

  for (const reference of references) {
    if (/^(?:[a-z]+:|#|\/\/)/i.test(reference)) continue;
    if (reference.startsWith('/')) {
      errors.push(`side panel asset must use a relative URL: ${reference}`);
      continue;
    }

    const assetPath = resolve(dirname(sidePanelPath), reference);
    const relativeAssetPath = relative(packageRoot, assetPath);
    if (relativeAssetPath === '..' || relativeAssetPath.startsWith(`..${sep}`)) {
      errors.push(`side panel asset escapes the extension package: ${reference}`);
    } else if (!existsSync(assetPath)) {
      errors.push(`side panel references missing asset: ${relativeAssetPath}`);
    }
  }
}

if (errors.length > 0) {
  console.error(['Browser extension build validation failed:', ...errors.map((error) => `- ${error}`)].join('\n'));
  process.exit(1);
}

console.log('Browser extension build validation passed.');
