import { readdir, readFile, writeFile } from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';
import { extname, join } from 'node:path';

import { type IpcMain, dialog } from 'electron';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.json', '.ts', '.js']);

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

const watchers = new Map<string, ReturnType<typeof fsWatch>>();

export function registerFileIpc(ipcMain: IpcMain): void {
  ipcMain.handle('file:read', async (_, filePath: string) => {
    return readFile(filePath, 'utf-8');
  });

  ipcMain.handle('file:write', async (_, filePath: string, content: string) => {
    await writeFile(filePath, content, 'utf-8');
    return { success: true as const };
  });

  ipcMain.handle('file:list-dir', async (_, dirPath: string): Promise<FileEntry[]> => {
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

  ipcMain.handle('file:open-dir-dialog', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0] ?? null;
  });

  ipcMain.handle('file:watch', async (event, filePath: string) => {
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
