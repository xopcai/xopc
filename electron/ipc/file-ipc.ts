import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { type IpcMain, app, dialog, shell } from 'electron';

import { assertTrustedRenderer } from './trusted-renderer.js';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.json', '.ts', '.js']);

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

const watchers = new Map<string, ReturnType<typeof fsWatch>>();

export type ShellOpenErrorCode =
  | 'CANCELED'
  | 'INVALID_PATH'
  | 'NOT_FOUND'
  | 'NOT_OPENABLE'
  | 'INVALID_APP'
  | 'OPEN_FAILED';

export type ShellOpenResult =
  | { ok: true }
  | { ok: false; error: string; code: ShellOpenErrorCode };

export type RecentOpenWithApp = {
  name: string;
  path: string;
  platform: NodeJS.Platform;
  lastUsedAt: number;
};

export type RecommendedOpenWithApp = {
  name: string;
  path: string;
  platform: NodeJS.Platform;
  source: 'known';
};

const RECENT_OPEN_WITH_LIMIT = 8;
const SHELL_PREFS_NAME = 'electron-shell-open-with.json';

export type FileIpcOptions = {
  allowedRoots?: string[];
};

type KnownAppCandidate = {
  name: string;
  paths: string[];
  categories: Array<'code' | 'document' | 'image' | 'pdf' | 'office' | 'browser' | 'archive' | 'media'>;
};

const EXTENSION_CATEGORIES: Record<string, KnownAppCandidate['categories'][number][]> = {
  '.ts': ['code'],
  '.tsx': ['code'],
  '.js': ['code'],
  '.jsx': ['code'],
  '.mjs': ['code'],
  '.cjs': ['code'],
  '.json': ['code'],
  '.jsonl': ['code'],
  '.md': ['code', 'document'],
  '.txt': ['code', 'document'],
  '.html': ['code', 'browser'],
  '.htm': ['code', 'browser'],
  '.css': ['code'],
  '.scss': ['code'],
  '.yaml': ['code'],
  '.yml': ['code'],
  '.toml': ['code'],
  '.xml': ['code'],
  '.pdf': ['pdf', 'browser'],
  '.png': ['image'],
  '.jpg': ['image'],
  '.jpeg': ['image'],
  '.webp': ['image'],
  '.gif': ['image', 'browser'],
  '.svg': ['code', 'image', 'browser'],
  '.doc': ['office', 'document'],
  '.docx': ['office', 'document'],
  '.xls': ['office'],
  '.xlsx': ['office'],
  '.ppt': ['office'],
  '.pptx': ['office'],
  '.zip': ['archive'],
  '.tar': ['archive'],
  '.gz': ['archive'],
  '.mp3': ['media'],
  '.mp4': ['media'],
  '.mov': ['media'],
};

function homePath(): string {
  return app.getPath('home');
}

function pathEnvExecutableCandidates(commands: string[]): string[] {
  const pathEnv = process.env.PATH ?? '';
  const dirs = pathEnv.split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .map((x) => x.toLowerCase())
          .filter(Boolean)
      : [''];
  const out: string[] = [];
  for (const dir of dirs) {
    for (const command of commands) {
      const hasExt = extname(command).length > 0;
      if (hasExt || process.platform !== 'win32') {
        out.push(join(dir, command));
        continue;
      }
      for (const ext of extensions) {
        out.push(join(dir, `${command}${ext}`));
      }
    }
  }
  return out;
}

function knownAppCandidates(): KnownAppCandidate[] {
  const home = homePath();
  if (process.platform === 'darwin') {
    return [
      {
        name: 'Visual Studio Code',
        paths: ['/Applications/Visual Studio Code.app', join(home, 'Applications/Visual Studio Code.app')],
        categories: ['code'],
      },
      {
        name: 'Cursor',
        paths: ['/Applications/Cursor.app', join(home, 'Applications/Cursor.app')],
        categories: ['code'],
      },
      {
        name: 'Zed',
        paths: ['/Applications/Zed.app', join(home, 'Applications/Zed.app')],
        categories: ['code'],
      },
      {
        name: 'Sublime Text',
        paths: ['/Applications/Sublime Text.app', join(home, 'Applications/Sublime Text.app')],
        categories: ['code'],
      },
      {
        name: 'WebStorm',
        paths: ['/Applications/WebStorm.app', join(home, 'Applications/WebStorm.app')],
        categories: ['code'],
      },
      {
        name: 'Preview',
        paths: ['/System/Applications/Preview.app', '/Applications/Preview.app'],
        categories: ['pdf', 'image'],
      },
      {
        name: 'Google Chrome',
        paths: ['/Applications/Google Chrome.app', join(home, 'Applications/Google Chrome.app')],
        categories: ['browser', 'pdf', 'image'],
      },
      {
        name: 'Microsoft Word',
        paths: ['/Applications/Microsoft Word.app'],
        categories: ['office', 'document'],
      },
      {
        name: 'Microsoft Excel',
        paths: ['/Applications/Microsoft Excel.app'],
        categories: ['office'],
      },
      {
        name: 'Microsoft PowerPoint',
        paths: ['/Applications/Microsoft PowerPoint.app'],
        categories: ['office'],
      },
      { name: 'Pages', paths: ['/Applications/Pages.app'], categories: ['document', 'office'] },
      { name: 'Numbers', paths: ['/Applications/Numbers.app'], categories: ['office'] },
      { name: 'Keynote', paths: ['/Applications/Keynote.app'], categories: ['office'] },
      { name: 'The Unarchiver', paths: ['/Applications/The Unarchiver.app'], categories: ['archive'] },
      { name: 'QuickTime Player', paths: ['/System/Applications/QuickTime Player.app'], categories: ['media'] },
    ];
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    return [
      {
        name: 'Visual Studio Code',
        paths: [
          join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
          join(local, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
          join(programFiles, 'Microsoft VS Code', 'Code.exe'),
          ...pathEnvExecutableCandidates(['code']),
        ],
        categories: ['code'],
      },
      {
        name: 'Cursor',
        paths: [
          join(local, 'Programs', 'cursor', 'Cursor.exe'),
          join(local, 'Programs', 'Cursor', 'Cursor.exe'),
          join(programFiles, 'Cursor', 'Cursor.exe'),
          ...pathEnvExecutableCandidates(['cursor']),
        ],
        categories: ['code'],
      },
      {
        name: 'Windsurf',
        paths: [
          join(local, 'Programs', 'Windsurf', 'Windsurf.exe'),
          join(programFiles, 'Windsurf', 'Windsurf.exe'),
          ...pathEnvExecutableCandidates(['windsurf']),
        ],
        categories: ['code'],
      },
      {
        name: 'Zed',
        paths: [
          join(local, 'Programs', 'Zed', 'Zed.exe'),
          join(programFiles, 'Zed', 'Zed.exe'),
          ...pathEnvExecutableCandidates(['zed']),
        ],
        categories: ['code'],
      },
      {
        name: 'Sublime Text',
        paths: [
          join(programFiles, 'Sublime Text', 'sublime_text.exe'),
          join(programFilesX86, 'Sublime Text', 'sublime_text.exe'),
          ...pathEnvExecutableCandidates(['sublime_text', 'subl']),
        ],
        categories: ['code'],
      },
      {
        name: 'Notepad++',
        paths: [
          join(programFiles, 'Notepad++', 'notepad++.exe'),
          join(programFilesX86, 'Notepad++', 'notepad++.exe'),
          ...pathEnvExecutableCandidates(['notepad++']),
        ],
        categories: ['code', 'document'],
      },
      {
        name: 'Notepad',
        paths: [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'notepad.exe')],
        categories: ['code'],
      },
      {
        name: 'Google Chrome',
        paths: [
          join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          ...pathEnvExecutableCandidates(['chrome', 'google-chrome']),
        ],
        categories: ['browser', 'pdf', 'image'],
      },
      {
        name: 'Microsoft Edge',
        paths: [
          join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          ...pathEnvExecutableCandidates(['msedge']),
        ],
        categories: ['browser', 'pdf', 'image'],
      },
      {
        name: 'Firefox',
        paths: [
          join(programFiles, 'Mozilla Firefox', 'firefox.exe'),
          join(programFilesX86, 'Mozilla Firefox', 'firefox.exe'),
          ...pathEnvExecutableCandidates(['firefox']),
        ],
        categories: ['browser', 'pdf', 'image'],
      },
      {
        name: 'SumatraPDF',
        paths: [
          join(local, 'SumatraPDF', 'SumatraPDF.exe'),
          join(programFiles, 'SumatraPDF', 'SumatraPDF.exe'),
          join(programFilesX86, 'SumatraPDF', 'SumatraPDF.exe'),
        ],
        categories: ['pdf'],
      },
      {
        name: 'Adobe Acrobat',
        paths: [
          join(programFiles, 'Adobe', 'Acrobat DC', 'Acrobat', 'Acrobat.exe'),
          join(programFiles, 'Adobe', 'Acrobat', 'Acrobat.exe'),
          join(programFilesX86, 'Adobe', 'Acrobat Reader DC', 'Reader', 'AcroRd32.exe'),
          join(programFilesX86, 'Adobe', 'Acrobat Reader', 'Reader', 'AcroRd32.exe'),
        ],
        categories: ['pdf'],
      },
      {
        name: 'IrfanView',
        paths: [join(programFiles, 'IrfanView', 'i_view64.exe'), join(programFilesX86, 'IrfanView', 'i_view32.exe')],
        categories: ['image'],
      },
      {
        name: 'Paint',
        paths: [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'mspaint.exe')],
        categories: ['image'],
      },
      {
        name: 'Microsoft Word',
        paths: [
          join(programFiles, 'Microsoft Office', 'root', 'Office16', 'WINWORD.EXE'),
          join(programFilesX86, 'Microsoft Office', 'root', 'Office16', 'WINWORD.EXE'),
          join(programFiles, 'Microsoft Office', 'Office16', 'WINWORD.EXE'),
          join(programFilesX86, 'Microsoft Office', 'Office16', 'WINWORD.EXE'),
        ],
        categories: ['office', 'document'],
      },
      {
        name: 'Microsoft Excel',
        paths: [
          join(programFiles, 'Microsoft Office', 'root', 'Office16', 'EXCEL.EXE'),
          join(programFilesX86, 'Microsoft Office', 'root', 'Office16', 'EXCEL.EXE'),
          join(programFiles, 'Microsoft Office', 'Office16', 'EXCEL.EXE'),
          join(programFilesX86, 'Microsoft Office', 'Office16', 'EXCEL.EXE'),
        ],
        categories: ['office'],
      },
      {
        name: 'Microsoft PowerPoint',
        paths: [
          join(programFiles, 'Microsoft Office', 'root', 'Office16', 'POWERPNT.EXE'),
          join(programFilesX86, 'Microsoft Office', 'root', 'Office16', 'POWERPNT.EXE'),
          join(programFiles, 'Microsoft Office', 'Office16', 'POWERPNT.EXE'),
          join(programFilesX86, 'Microsoft Office', 'Office16', 'POWERPNT.EXE'),
        ],
        categories: ['office'],
      },
      {
        name: 'LibreOffice',
        paths: [
          join(programFiles, 'LibreOffice', 'program', 'soffice.exe'),
          join(programFilesX86, 'LibreOffice', 'program', 'soffice.exe'),
          ...pathEnvExecutableCandidates(['soffice', 'libreoffice']),
        ],
        categories: ['office', 'document'],
      },
      {
        name: '7-Zip',
        paths: [
          join(programFiles, '7-Zip', '7zFM.exe'),
          join(programFilesX86, '7-Zip', '7zFM.exe'),
        ],
        categories: ['archive'],
      },
      {
        name: 'VLC',
        paths: [
          join(programFiles, 'VideoLAN', 'VLC', 'vlc.exe'),
          join(programFilesX86, 'VideoLAN', 'VLC', 'vlc.exe'),
          ...pathEnvExecutableCandidates(['vlc']),
        ],
        categories: ['media'],
      },
      {
        name: 'Typora',
        paths: [
          join(programFiles, 'Typora', 'Typora.exe'),
          join(programFilesX86, 'Typora', 'Typora.exe'),
          join(roaming, 'Typora', 'Typora.exe'),
        ],
        categories: ['document'],
      },
    ];
  }
  return [
    { name: 'Visual Studio Code', paths: ['/usr/bin/code', '/snap/bin/code', '/var/lib/flatpak/exports/bin/com.visualstudio.code', ...pathEnvExecutableCandidates(['code'])], categories: ['code'] },
    { name: 'Cursor', paths: ['/usr/bin/cursor', '/usr/local/bin/cursor', '/opt/Cursor/cursor', '/var/lib/flatpak/exports/bin/com.cursor.Cursor', ...pathEnvExecutableCandidates(['cursor'])], categories: ['code'] },
    { name: 'Windsurf', paths: ['/usr/bin/windsurf', '/usr/local/bin/windsurf', '/opt/Windsurf/windsurf', ...pathEnvExecutableCandidates(['windsurf'])], categories: ['code'] },
    { name: 'Zed', paths: ['/usr/bin/zed', '/usr/local/bin/zed', '/var/lib/flatpak/exports/bin/dev.zed.Zed', ...pathEnvExecutableCandidates(['zed'])], categories: ['code'] },
    { name: 'Sublime Text', paths: ['/usr/bin/subl', '/opt/sublime_text/sublime_text', ...pathEnvExecutableCandidates(['subl', 'sublime_text'])], categories: ['code'] },
    { name: 'Kate', paths: ['/usr/bin/kate', ...pathEnvExecutableCandidates(['kate'])], categories: ['code', 'document'] },
    { name: 'Gedit', paths: ['/usr/bin/gedit', ...pathEnvExecutableCandidates(['gedit'])], categories: ['code', 'document'] },
    { name: 'Typora', paths: ['/usr/bin/typora', '/opt/Typora/Typora', ...pathEnvExecutableCandidates(['typora'])], categories: ['document'] },
    { name: 'Google Chrome', paths: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', ...pathEnvExecutableCandidates(['google-chrome', 'google-chrome-stable'])], categories: ['browser', 'pdf', 'image'] },
    { name: 'Chromium', paths: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', ...pathEnvExecutableCandidates(['chromium', 'chromium-browser'])], categories: ['browser', 'pdf', 'image'] },
    { name: 'Firefox', paths: ['/usr/bin/firefox', '/snap/bin/firefox', ...pathEnvExecutableCandidates(['firefox'])], categories: ['browser', 'pdf', 'image'] },
    { name: 'Evince', paths: ['/usr/bin/evince', ...pathEnvExecutableCandidates(['evince'])], categories: ['pdf'] },
    { name: 'Okular', paths: ['/usr/bin/okular', '/var/lib/flatpak/exports/bin/org.kde.okular', ...pathEnvExecutableCandidates(['okular'])], categories: ['pdf'] },
    { name: 'Document Viewer', paths: ['/usr/bin/xreader', ...pathEnvExecutableCandidates(['xreader'])], categories: ['pdf'] },
    { name: 'Image Viewer', paths: ['/usr/bin/eog', '/usr/bin/loupe', ...pathEnvExecutableCandidates(['eog', 'loupe'])], categories: ['image'] },
    { name: 'GIMP', paths: ['/usr/bin/gimp', '/snap/bin/gimp', ...pathEnvExecutableCandidates(['gimp'])], categories: ['image'] },
    { name: 'LibreOffice', paths: ['/usr/bin/libreoffice', '/snap/bin/libreoffice', ...pathEnvExecutableCandidates(['libreoffice', 'soffice'])], categories: ['office', 'document'] },
    { name: 'VLC', paths: ['/usr/bin/vlc', '/snap/bin/vlc', ...pathEnvExecutableCandidates(['vlc'])], categories: ['media'] },
    { name: 'File Roller', paths: ['/usr/bin/file-roller', ...pathEnvExecutableCandidates(['file-roller'])], categories: ['archive'] },
    { name: 'Ark', paths: ['/usr/bin/ark', ...pathEnvExecutableCandidates(['ark'])], categories: ['archive'] },
  ];
}

function shellPrefsPath(): string {
  return join(app.getPath('userData'), SHELL_PREFS_NAME);
}

function appNameFromPath(appPath: string): string {
  const base = basename(appPath);
  return process.platform === 'darwin' && base.endsWith('.app') ? base.slice(0, -4) : base;
}

async function readRecentOpenWithApps(): Promise<RecentOpenWithApp[]> {
  try {
    const raw = await readFile(shellPrefsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as { recentOpenWithApps?: unknown };
    if (!Array.isArray(parsed.recentOpenWithApps)) return [];
    const currentPlatform = process.platform;
    const entries = parsed.recentOpenWithApps
      .filter((x): x is RecentOpenWithApp => {
        const rec = x as Partial<RecentOpenWithApp>;
        return (
          typeof rec.name === 'string' &&
          typeof rec.path === 'string' &&
          rec.platform === currentPlatform &&
          typeof rec.lastUsedAt === 'number'
        );
      })
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, RECENT_OPEN_WITH_LIMIT);

    const existing: RecentOpenWithApp[] = [];
    for (const entry of entries) {
      try {
        await stat(entry.path);
        existing.push(entry);
      } catch {
        /* drop moved applications */
      }
    }
    return existing;
  } catch {
    return [];
  }
}

async function writeRecentOpenWithApps(apps: RecentOpenWithApp[]): Promise<void> {
  const path = shellPrefsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ recentOpenWithApps: apps }, null, 2), 'utf-8');
}

async function recordRecentOpenWithApp(appPath: string): Promise<RecentOpenWithApp[]> {
  const existing = await readRecentOpenWithApps();
  const nextEntry: RecentOpenWithApp = {
    name: appNameFromPath(appPath),
    path: appPath,
    platform: process.platform,
    lastUsedAt: Date.now(),
  };
  const next = [nextEntry, ...existing.filter((x) => x.path !== appPath)].slice(
    0,
    RECENT_OPEN_WITH_LIMIT,
  );
  await writeRecentOpenWithApps(next);
  return next;
}

async function firstExistingPath(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    try {
      await stat(p);
      return p;
    } catch {
      /* try next known path */
    }
  }
  return null;
}

async function getRecommendedOpenWithAppsForPath(filePath: string): Promise<RecommendedOpenWithApp[]> {
  let targetStat: Awaited<ReturnType<typeof stat>>;
  try {
    targetStat = await stat(filePath);
  } catch {
    return [];
  }
  const ext = extname(filePath).toLowerCase();
  /** A folder is a development workspace, so only offer code editors. */
  const categories = targetStat.isDirectory() ? ['code'] : EXTENSION_CATEGORIES[ext] ?? ['code', 'document'];
  const categorySet = new Set(categories);
  const candidates = knownAppCandidates().filter((candidate) =>
    candidate.categories.some((category) => categorySet.has(category)),
  );
  const out: RecommendedOpenWithApp[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const path = await firstExistingPath(candidate.paths);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push({
      name: candidate.name,
      path,
      platform: process.platform,
      source: 'known',
    });
  }
  return out.slice(0, 8);
}

/** Validate a workspace file or directory before passing it to an external application. */
async function validateOpenWithTargetPath(targetPath: string): Promise<ShellOpenResult> {
  if (typeof targetPath !== 'string' || !isAbsolute(targetPath)) {
    return { ok: false, code: 'INVALID_PATH', error: 'Path must be absolute.' };
  }
  try {
    const s = await stat(targetPath);
    if (!s.isFile() && !s.isDirectory()) {
      return { ok: false, code: 'NOT_OPENABLE', error: 'Path is not a file or directory.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: 'NOT_FOUND', error: 'Path does not exist.' };
  }
}

async function validateOpenPath(filePath: string): Promise<ShellOpenResult> {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) {
    return { ok: false, code: 'INVALID_PATH', error: 'Path must be absolute.' };
  }
  try {
    await stat(filePath);
    return { ok: true };
  } catch {
    return { ok: false, code: 'NOT_FOUND', error: 'Path does not exist.' };
  }
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = resolve(candidate);
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, resolvedCandidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function validateManagedPath(filePath: string, allowedRoots: string[]): ShellOpenResult {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) {
    return { ok: false, code: 'INVALID_PATH', error: 'Path must be absolute.' };
  }
  if (allowedRoots.length === 0 || allowedRoots.some((root) => isPathInsideRoot(filePath, root))) {
    return { ok: true };
  }
  return { ok: false, code: 'INVALID_PATH', error: 'Path is outside the Electron-managed workspace.' };
}

async function validateAppPath(appPath: string): Promise<ShellOpenResult> {
  if (typeof appPath !== 'string' || !isAbsolute(appPath)) {
    return { ok: false, code: 'INVALID_APP', error: 'Application path must be absolute.' };
  }
  try {
    const s = await stat(appPath);
    if (process.platform === 'darwin') {
      if (s.isDirectory() && appPath.toLowerCase().endsWith('.app')) return { ok: true };
      return { ok: false, code: 'INVALID_APP', error: 'Select a macOS .app bundle.' };
    }
    if (!s.isFile()) return { ok: false, code: 'INVALID_APP', error: 'Application path is not a file.' };
    return { ok: true };
  } catch {
    return { ok: false, code: 'INVALID_APP', error: 'Application does not exist.' };
  }
}

async function spawnOpenWithApp(filePath: string, appPath: string): Promise<ShellOpenResult> {
  const targetValidation = await validateOpenWithTargetPath(filePath);
  if (!targetValidation.ok) return targetValidation;
  const appValidation = await validateAppPath(appPath);
  if (!appValidation.ok) return appValidation;

  const command = process.platform === 'darwin' ? 'open' : appPath;
  const args = process.platform === 'darwin' ? ['-a', appPath, filePath] : [filePath];

  return new Promise<ShellOpenResult>((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', (err) => {
      resolve({ ok: false, code: 'OPEN_FAILED', error: err.message });
    });
    child.once('spawn', () => {
      child.unref();
      void recordRecentOpenWithApp(appPath).catch(() => undefined);
      resolve({ ok: true });
    });
  });
}

export function registerFileIpc(ipcMain: IpcMain, options: FileIpcOptions = {}): void {
  const allowedRoots = options.allowedRoots ?? [];

  ipcMain.handle('file:read', async (event, filePath: string) => {
    assertTrustedRenderer(event);
    const validation = validateManagedPath(filePath, allowedRoots);
    if (!validation.ok) throw new Error(validation.error);
    return readFile(filePath, 'utf-8');
  });

  ipcMain.handle('file:write', async (event, filePath: string, content: string) => {
    assertTrustedRenderer(event);
    const validation = validateManagedPath(filePath, allowedRoots);
    if (!validation.ok) throw new Error(validation.error);
    await writeFile(filePath, content, 'utf-8');
    return { success: true as const };
  });

  ipcMain.handle('file:list-dir', async (event, dirPath: string): Promise<FileEntry[]> => {
    assertTrustedRenderer(event);
    const validation = validateManagedPath(dirPath, allowedRoots);
    if (!validation.ok) throw new Error(validation.error);
    const entries = await readdir(dirPath, { withFileTypes: true });
    const result: FileEntry[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        result.push({ name: entry.name, path: fullPath, isDirectory: true });
      } else if (SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        result.push({ name: entry.name, path: fullPath, isDirectory: false });
      }
    }

    return result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  });

  ipcMain.handle('file:open-dir-dialog', async (event, options?: { defaultPath?: string }) => {
    assertTrustedRenderer(event);
    const defaultPath =
      typeof options?.defaultPath === 'string' && options.defaultPath.trim()
        ? options.defaultPath.trim()
        : undefined;
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      ...(defaultPath ? { defaultPath } : {}),
    });
    return res.canceled ? null : res.filePaths[0] ?? null;
  });

  ipcMain.handle('shell:open-path', async (event, filePath: string) => {
    assertTrustedRenderer(event);
    const validation = await validateOpenPath(filePath);
    if (!validation.ok) return validation;
    const err = await shell.openPath(filePath);
    return err ? { ok: false as const, code: 'OPEN_FAILED' as const, error: err } : { ok: true as const };
  });

  ipcMain.handle('shell:show-item-in-folder', async (event, filePath: string) => {
    assertTrustedRenderer(event);
    const validation = await validateOpenPath(filePath);
    if (!validation.ok) return { success: false as const };
    shell.showItemInFolder(filePath);
    return { success: true as const };
  });

  ipcMain.handle('shell:choose-app-and-open-path', async (event, filePath: string): Promise<ShellOpenResult> => {
    assertTrustedRenderer(event);
    const validation = await validateOpenWithTargetPath(filePath);
    if (!validation.ok) return validation;
    const defaultPath =
      process.platform === 'darwin'
        ? '/Applications'
        : process.platform === 'win32'
          ? 'C:\\Program Files'
          : '/usr/bin';
    const res = await dialog.showOpenDialog({
      title: 'Choose application',
      defaultPath,
      properties: process.platform === 'darwin' ? ['openFile', 'openDirectory'] : ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Applications', extensions: ['exe'] }]
          : undefined,
    });
    const appPath = res.filePaths[0];
    if (res.canceled || !appPath) {
      return { ok: false, code: 'CANCELED', error: 'Application selection canceled.' };
    }
    return spawnOpenWithApp(filePath, appPath);
  });

  ipcMain.handle(
    'shell:open-path-with-app',
    async (event, filePath: string, appPath: string): Promise<ShellOpenResult> => {
      assertTrustedRenderer(event);
      return spawnOpenWithApp(filePath, appPath);
    },
  );

  ipcMain.handle('shell:get-recent-open-with-apps', async (event) => {
    assertTrustedRenderer(event);
    return readRecentOpenWithApps();
  });

  ipcMain.handle('shell:get-open-with-apps-for-path', async (event, filePath: string) => {
    assertTrustedRenderer(event);
    const validation = await validateOpenWithTargetPath(filePath);
    if (!validation.ok) return { recommended: [], recent: [] };
    const [recommended, recent] = await Promise.all([
      getRecommendedOpenWithAppsForPath(filePath),
      readRecentOpenWithApps(),
    ]);
    const recommendedPaths = new Set(recommended.map((app) => app.path));
    return {
      recommended,
      recent: recent.filter((app) => !recommendedPaths.has(app.path)),
    };
  });

  ipcMain.handle('shell:clear-recent-open-with-apps', async (event) => {
    assertTrustedRenderer(event);
    await writeRecentOpenWithApps([]);
    return { ok: true as const };
  });

  ipcMain.handle('file:watch', async (event, filePath: string) => {
    assertTrustedRenderer(event);
    const validation = validateManagedPath(filePath, allowedRoots);
    if (!validation.ok) throw new Error(validation.error);
    if (watchers.has(filePath)) return;
    const w = fsWatch(filePath, async () => {
      try {
        const content = await readFile(filePath, 'utf-8');
        event.sender.send('file:changed', { path: filePath, content });
      } catch {
        /* ignore */
      }
    });
    watchers.set(filePath, w);
  });
}
