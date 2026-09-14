import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import * as childProcess from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import { PACKAGE_VERSION } from '../../package-version.js';
import {
  BROWSER_EXT_REQUIRED_FILES,
  browserExtContentHash,
  browserNativeHostDoctor,
  browserNativeManifestDirectories,
  computeNeedsRefresh,
  createBrowserExtensionArchive,
  ensureBrowserExtensionArtifacts,
  ensureBrowserExtensionOnStartup,
  installBrowserNativeMessagingHost,
  resolveWindowsExtensionManager,
  validateBrowserExtLayout,
} from '../providers/browser-ext-install.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFileSync: vi.fn(),
}));

function writeMinimalExtensionTree(root: string, version = '0.0.1'): void {
  mkdirSync(join(root, 'dist'), { recursive: true });
  mkdirSync(join(root, 'icons'), { recursive: true });
  mkdirSync(join(root, '_locales/en'), { recursive: true });
  mkdirSync(join(root, '_locales/zh_CN'), { recursive: true });
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({ manifest_version: 3, name: 'test', version }, null, 2),
  );
  for (const file of ['background.js', 'sidepanel.html']) {
    writeFileSync(join(root, 'dist', file), `// ${file}`);
  }
  writeFileSync(join(root, 'icons/icon-16.png'), '');
  writeFileSync(join(root, '_locales/en/messages.json'), '{"appName":{"message":"test"}}');
  writeFileSync(join(root, '_locales/zh_CN/messages.json'), '{"appName":{"message":"test"}}');
}

describe('browser-ext-install', () => {
  let tempHome: string;
  let bundledDir: string;
  let binDir: string;
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  const prevBundledRoot = process.env.XOPC_BROWSER_EXT_BUNDLED_ROOT;
  const prevStateDir = process.env.XOPC_STATE_DIR;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'xopc-browser-ext-'));
    bundledDir = join(tempHome, 'bundled');
    binDir = join(tempHome, '.xopc', 'bin');
    mkdirSync(binDir, { recursive: true });
    writeMinimalExtensionTree(bundledDir, PACKAGE_VERSION);

    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    process.env.XOPC_BROWSER_EXT_BUNDLED_ROOT = bundledDir;
    process.env.XOPC_STATE_DIR = join(tempHome, '.xopc');
  });

  afterEach(() => {
    vi.resetAllMocks();
    process.env.HOME = prevHome;
    process.env.USERPROFILE = prevUserProfile;
    if (prevBundledRoot === undefined) {
      delete process.env.XOPC_BROWSER_EXT_BUNDLED_ROOT;
    } else {
      process.env.XOPC_BROWSER_EXT_BUNDLED_ROOT = prevBundledRoot;
    }
    if (prevStateDir === undefined) {
      delete process.env.XOPC_STATE_DIR;
    } else {
      process.env.XOPC_STATE_DIR = prevStateDir;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('validateBrowserExtLayout requires core files', () => {
    expect(validateBrowserExtLayout(bundledDir)).toBe(true);
    expect(BROWSER_EXT_REQUIRED_FILES.length).toBeGreaterThan(0);
    rmSync(join(bundledDir, 'dist/background.js'));
    expect(validateBrowserExtLayout(bundledDir)).toBe(false);
  });

  it('creates a load-unpacked archive with only browser extension artifacts', async () => {
    const archive = await createBrowserExtensionArchive();
    const zip = new AdmZip(archive.data);

    expect(archive.filename).toBe(`xopc-browser-extension-${PACKAGE_VERSION}.zip`);
    expect(zip.getEntry('xopc-browser-extension/manifest.json')).not.toBeNull();
    expect(zip.getEntry('xopc-browser-extension/dist/background.js')).not.toBeNull();
    expect(zip.getEntry('xopc-browser-extension/dist/sidepanel.html')).not.toBeNull();
    expect(zip.getEntry('xopc-browser-extension/icons/icon-16.png')).not.toBeNull();
    expect(zip.getEntries().some(entry => entry.entryName.includes('.meta.json'))).toBe(false);
  });

  it('declares debugger as a required Chrome permission', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'packages/browser-ext/manifest.json'), 'utf8'),
    ) as { permissions?: string[]; optional_permissions?: string[] };

    expect(manifest.permissions).toContain('debugger');
    expect(manifest.optional_permissions ?? []).not.toContain('debugger');
  });

  it('ships matching English and Simplified Chinese locale catalogs', () => {
    const extensionRoot = join(process.cwd(), 'packages/browser-ext');
    const manifest = JSON.parse(readFileSync(join(extensionRoot, 'manifest.json'), 'utf8')) as {
      default_locale?: string;
      name?: string;
      description?: string;
      action?: { default_title?: string };
    };
    const english = JSON.parse(readFileSync(join(extensionRoot, '_locales/en/messages.json'), 'utf8')) as Record<string, { message?: string }>;
    const chinese = JSON.parse(readFileSync(join(extensionRoot, '_locales/zh_CN/messages.json'), 'utf8')) as Record<string, { message?: string }>;

    expect(manifest.default_locale).toBe('en');
    expect(manifest.name).toBe('__MSG_appName__');
    expect(manifest.description).toBe('__MSG_appDescription__');
    expect(manifest.action?.default_title).toBe('__MSG_actionTitle__');
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
    expect(Object.values(english).every((entry) => Boolean(entry.message?.trim()))).toBe(true);
    expect(Object.values(chinese).every((entry) => Boolean(entry.message?.trim()))).toBe(true);
  });

  it('computeNeedsRefresh when meta missing or force', () => {
    expect(
      computeNeedsRefresh({
        bundledManifestVersion: PACKAGE_VERSION,
        bundledContentHash: browserExtContentHash(bundledDir),
        installedPath: null,
        meta: null,
      }),
    ).toBe(true);

    expect(
      computeNeedsRefresh({
        force: true,
        bundledManifestVersion: PACKAGE_VERSION,
        bundledContentHash: browserExtContentHash(bundledDir),
        installedPath: bundledDir,
        meta: {
          xopcVersion: PACKAGE_VERSION,
          manifestVersion: PACKAGE_VERSION,
          contentHash: browserExtContentHash(bundledDir),
          source: 'bundled',
          bundledFrom: 'env-override',
          installedAt: new Date().toISOString(),
          installPath: bundledDir,
        },
      }),
    ).toBe(true);
  });

  it('ensure is idempotent on second run', async () => {
    const extensionRoot = join(binDir, 'browser-ext');
    const first = await ensureBrowserExtensionArtifacts({ cacheDir: binDir });
    expect(first.copied).toBe(true);
    expect(validateBrowserExtLayout(first.extensionDir)).toBe(true);
    expect(first.extensionDir).toBe(extensionRoot);

    const second = await ensureBrowserExtensionArtifacts({ cacheDir: binDir });
    expect(second.copied).toBe(false);
    expect(second.extensionDir).toBe(first.extensionDir);
  });

  it('refreshes artifacts when bundled code changes without a version bump', async () => {
    const first = await ensureBrowserExtensionArtifacts({ cacheDir: binDir });
    expect(first.copied).toBe(true);

    writeFileSync(join(bundledDir, 'dist/background.js'), '// changed protocol implementation');

    const refreshed = await ensureBrowserExtensionArtifacts({ cacheDir: binDir });
    expect(refreshed.copied).toBe(true);
    expect(readFileSync(join(refreshed.extensionDir, 'dist/background.js'), 'utf8')).toContain('changed protocol');
  });

  it('refreshes installed artifacts when a locale changes', async () => {
    await ensureBrowserExtensionArtifacts({ cacheDir: binDir });
    const updatedCatalog = '{"appName":{"message":"本地化测试"}}';
    writeFileSync(join(bundledDir, '_locales/zh_CN/messages.json'), updatedCatalog);

    const refreshed = await ensureBrowserExtensionArtifacts({ cacheDir: binDir });

    expect(refreshed.copied).toBe(true);
    expect(readFileSync(join(refreshed.extensionDir, '_locales/zh_CN/messages.json'), 'utf8')).toBe(updatedCatalog);
  });

  it('skips startup artifact sync when browser tools are disabled', async () => {
    const extensionRoot = join(binDir, 'browser-ext');

    await ensureBrowserExtensionOnStartup({
      browser: { enabled: false, driver: { kind: 'extension' } },
    } as unknown as Config);

    expect(existsSync(extensionRoot)).toBe(false);
  });

  it('syncs startup artifacts for the enabled extension driver only', async () => {
    const extensionRoot = join(binDir, 'browser-ext');

    await ensureBrowserExtensionOnStartup({
      browser: { enabled: true, driver: { kind: 'playwright', headless: true } },
    } as unknown as Config);
    expect(existsSync(extensionRoot)).toBe(false);

    await ensureBrowserExtensionOnStartup({
      browser: { enabled: true, driver: { kind: 'extension' } },
    } as unknown as Config);
    expect(validateBrowserExtLayout(extensionRoot)).toBe(true);
  });

  it('ensure overwrites the same directory when bundled manifest version changes', async () => {
    const extensionRoot = join(binDir, 'browser-ext');
    const nextVersion = '9.9.9';
    await ensureBrowserExtensionArtifacts({ cacheDir: binDir });
    writeFileSync(
      join(bundledDir, 'manifest.json'),
      JSON.stringify({ manifest_version: 3, name: 'test', version: nextVersion }, null, 2),
    );

    const upgraded = await ensureBrowserExtensionArtifacts({ cacheDir: binDir });
    expect(upgraded.copied).toBe(true);
    expect(upgraded.extensionDir).toBe(extensionRoot);
    const manifest = JSON.parse(readFileSync(join(extensionRoot, 'manifest.json'), 'utf8')) as {
      version: string;
    };
    expect(manifest.version).toBe(nextVersion);
    expect(existsSync(join(extensionRoot, 'manifest.json'))).toBe(true);
  });

  it('rejects cacheDir outside home', async () => {
    await expect(
      ensureBrowserExtensionArtifacts({ cacheDir: '/tmp/not-allowed' }),
    ).rejects.toThrow(/home directory/i);
  });

  it('uses Chrome for the extension manager and falls back to Edge on Windows', () => {
    const localAppData = join(tempHome, 'AppData', 'Local');
    const chromePath = join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe');
    const edgePath = join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe');

    mkdirSync(join(chromePath, '..'), { recursive: true });
    mkdirSync(join(edgePath, '..'), { recursive: true });
    writeFileSync(chromePath, '');
    writeFileSync(edgePath, '');

    expect(resolveWindowsExtensionManager({ LOCALAPPDATA: localAppData })).toMatchObject({
      browser: 'chrome',
      executablePath: chromePath,
      url: 'chrome://extensions/',
    });

    rmSync(chromePath);
    expect(resolveWindowsExtensionManager({ LOCALAPPDATA: localAppData })).toMatchObject({
      browser: 'edge',
      executablePath: edgePath,
      url: 'edge://extensions/',
    });
  });

  it('installs the fixed-id native bootstrap manifest for Chromium browsers', async () => {
    const nativeHome = join(tempHome, 'native-home');
    const result = await installBrowserNativeMessagingHost({
      cacheDir: binDir,
      cliPath: '/opt/xopc/cli.js',
      nodePath: '/opt/node',
      platform: 'linux',
      home: nativeHome,
      configPath: join(tempHome, '.xopc/xopc.json'),
      stateDir: join(tempHome, '.xopc'),
    });

    expect(result.installed).toBe(true);
    expect(result.manifestPaths).toHaveLength(5);
    expect(browserNativeManifestDirectories('linux', nativeHome)).toHaveLength(5);
    const manifest = JSON.parse(readFileSync(result.manifestPaths[0]!, 'utf8')) as {
      name: string;
      path: string;
      allowed_origins: string[];
    };
    expect(manifest.name).toBe('ai.xopc.browser');
    expect(manifest.path).toBe(join(binDir, 'browser-native-host'));
    expect(manifest.allowed_origins).toEqual([
      'chrome-extension://gopbfhaojnnhiheiikblejnpgmfmkmgd/',
    ]);
    expect(readFileSync(manifest.path, 'utf8')).toContain("'/opt/node' '/opt/xopc/cli.js' 'browser' 'extension' 'native-host'");
    expect(readFileSync(manifest.path, 'utf8')).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(readFileSync(manifest.path, 'utf8')).toContain('XOPC_LOG_CONSOLE=false');
    expect(browserNativeHostDoctor('linux', nativeHome)).toMatchObject({
      installed: true,
      manifestPaths: result.manifestPaths,
    });
  });

  it('registers a Windows batch host and diagnoses the registry manifest', async () => {
    const registry = vi.mocked(childProcess.execFileSync).mockReturnValue('');
    const result = await installBrowserNativeMessagingHost({
      cacheDir: binDir,
      platform: 'win32',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      cliPath: 'C:\\xopc & tools\\cli.js',
      stateDir: 'C:\\Users\\100%name!\\.xopc',
      configPath: 'C:\\Users\\100%name!\\.xopc\\xopc.json',
    });
    expect(result.installed).toBe(true);
    expect(result.manifestPaths).toHaveLength(1);
    expect(registry).toHaveBeenCalledWith('reg.exe', [
      'add', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\ai.xopc.browser',
      '/ve', '/t', 'REG_SZ', '/d', result.manifestPaths[0], '/f', '/reg:32',
    ], expect.objectContaining({ windowsHide: true }));
    const manifest = JSON.parse(readFileSync(result.manifestPaths[0]!, 'utf8'));
    expect(manifest.path).toBe(join(binDir, 'browser-native-host.cmd'));
    expect(manifest.allowed_origins).toEqual(['chrome-extension://gopbfhaojnnhiheiikblejnpgmfmkmgd/']);
    const wrapper = readFileSync(manifest.path, 'utf8');
    expect(wrapper).toContain('@echo off\r\nsetlocal DisableDelayedExpansion');
    expect(wrapper).toContain('"C:\\Program Files\\nodejs\\node.exe" "C:\\xopc & tools\\cli.js"');
    expect(wrapper).toContain('set "XOPC_STATE_DIR=C:\\Users\\100%%name!\\.xopc"');
    expect(wrapper).toContain('set "XOPC_LOG_CONSOLE=false"');
    registry.mockReturnValue(`    (Default)    REG_SZ    ${result.manifestPaths[0]}\r\n`);
    expect(browserNativeHostDoctor('win32')).toMatchObject({ installed: true, manifestPaths: result.manifestPaths });
    rmSync(manifest.path);
    expect(browserNativeHostDoctor('win32').installed).toBe(false);
  });

  it('reports Windows registry failures instead of claiming the host is installed', async () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(() => { throw new Error('Access denied'); });
    const result = await installBrowserNativeMessagingHost({
      cacheDir: binDir, platform: 'win32', cliPath: 'C:\\xopc\\cli.js',
    });
    expect(result).toMatchObject({ installed: false, reason: expect.stringContaining('Access denied') });
    expect(browserNativeHostDoctor('win32').installed).toBe(false);
  });

  it('uses absolute Node and tsx entries for a development native host', async () => {
    const nativeHome = join(tempHome, 'native-dev-home');
    const tsxCliPath = join(tempHome, 'tsx-cli.mjs');
    writeFileSync(tsxCliPath, '');
    const result = await installBrowserNativeMessagingHost({
      cacheDir: binDir,
      cliPath: '/opt/xopc/src/cli/bin.ts',
      nodePath: '/opt/node/bin/node',
      tsxCliPath,
      platform: 'linux',
      home: nativeHome,
    });

    const manifest = JSON.parse(readFileSync(result.manifestPaths[0]!, 'utf8')) as { path: string };
    const wrapper = readFileSync(manifest.path, 'utf8');
    expect(wrapper).toContain("'/opt/node/bin/node'");
    expect(wrapper).toContain(`'${realpathSync(tsxCliPath)}' '/opt/xopc/src/cli/bin.ts'`);
    expect(wrapper).not.toContain('node_modules/.bin/tsx');
  });
});
