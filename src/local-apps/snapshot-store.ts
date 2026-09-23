import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  LocalAppPreviewSnapshotSchema,
  LocalAppSourceHashSchema,
  type LocalAppPreviewSnapshot,
} from '@xopcai/gateway-contract';

import { resolveStateDir } from '../config/paths.js';
import { hashLocalAppDirectory, shouldCopyLocalAppPath } from './artifact-files.js';

function assertAppId(appId: string): void {
  if (!/^[a-zA-Z0-9-]+$/.test(appId)) throw new Error('Invalid local app id');
}

export class LocalAppSnapshotStore {
  private appRoot(appId: string): string {
    assertAppId(appId);
    return join(resolveStateDir(), 'local-apps', 'snapshots', appId);
  }

  private snapshotRoot(appId: string, sourceHash: string): string {
    LocalAppSourceHashSchema.parse(sourceHash);
    return join(this.appRoot(appId), sourceHash);
  }

  get(appId: string, sourceHash: string): LocalAppPreviewSnapshot | null {
    const root = this.snapshotRoot(appId, sourceHash);
    const metadataPath = join(root, 'snapshot.json');
    const packageRoot = join(root, 'package');
    if (!existsSync(metadataPath) || !existsSync(packageRoot)) return null;
    const snapshot = LocalAppPreviewSnapshotSchema.parse(JSON.parse(readFileSync(metadataPath, 'utf8')));
    if (snapshot.appId !== appId || snapshot.sourceHash !== sourceHash) {
      throw new Error('Local app snapshot metadata does not match its path');
    }
    return snapshot;
  }

  packageRoot(appId: string, sourceHash: string): string | null {
    return this.get(appId, sourceHash)?.status === 'ready'
      ? join(this.snapshotRoot(appId, sourceHash), 'package')
      : null;
  }

  materialize(
    appId: string,
    sourceRoot: string,
    build: (packageRoot: string, sourceHash: string, createdAt: number) => LocalAppPreviewSnapshot,
  ): LocalAppPreviewSnapshot {
    const appRoot = this.appRoot(appId);
    mkdirSync(appRoot, { recursive: true });
    const stagingRoot = mkdtempSync(join(appRoot, '.snapshot-'));
    const stagedPackage = join(stagingRoot, 'package');
    try {
      cpSync(sourceRoot, stagedPackage, { recursive: true, filter: shouldCopyLocalAppPath });
      const sourceHash = hashLocalAppDirectory(stagedPackage);
      const existing = this.get(appId, sourceHash);
      if (existing) return existing;
      const snapshot = LocalAppPreviewSnapshotSchema.parse(build(stagedPackage, sourceHash, Date.now()));
      writeFileSync(join(stagingRoot, 'snapshot.json'), `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
      const target = this.snapshotRoot(appId, sourceHash);
      try {
        renameSync(stagingRoot, target);
      } catch (error) {
        const raced = this.get(appId, sourceHash);
        if (raced) return raced;
        throw error;
      }
      return snapshot;
    } finally {
      if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}
