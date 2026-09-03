import crypto from 'node:crypto';

import { z } from 'zod';

import {
  SNAPSHOT_CHUNK_BYTES,
  SnapshotArtifactStore,
  type SnapshotArtifact,
} from '../execution-artifacts/snapshot-artifact-store.js';
import { resolveStateDir } from '../config/paths-state.js';
import type { ExecutionHostRegistry } from '../execution-hosts/registry.js';
import type { ExecutionEnvironment } from './types.js';

const OPERATION_DEADLINE_MS = 10 * 60_000;

const artifactSchema = z.strictObject({
  artifactId: z.string().min(1).max(160),
  baseSha: z.string().regex(/^[0-9a-f]{40,64}$/i),
  size: z.number().int().positive().max(128 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
});

const chunkSchema = z.strictObject({
  offset: z.number().int().nonnegative(),
  data: z.string(),
  eof: z.boolean(),
});

const beginSchema = z.strictObject({ complete: z.boolean() });

export class SnapshotTransferService {
  private readonly local: SnapshotArtifactStore;

  constructor(private readonly options: {
    getRegistry: () => ExecutionHostRegistry;
    localStore?: SnapshotArtifactStore;
    stateDir?: string;
  }) {
    this.local = options.localStore ?? new SnapshotArtifactStore(options.stateDir ?? resolveStateDir());
  }

  async capture(source: ExecutionEnvironment, artifactId: string, baseSha: string): Promise<SnapshotArtifact> {
    if (source.hostId === 'local') {
      return this.local.create({ artifactId, rootPath: source.rootPath, baseSha });
    }
    this.requireSnapshotCapability(source.hostId);
    const artifact = artifactSchema.parse(await this.execute(source, `snapshot:create:${artifactId}`, {
      action: 'create',
      artifactId,
    }));
    if (artifact.artifactId !== artifactId || artifact.baseSha !== baseSha) {
      throw new Error('Execution host returned snapshot metadata for a different handoff base');
    }
    await this.receiveFromRemote(source, artifact);
    return artifact;
  }

  async apply(target: ExecutionEnvironment, artifact: SnapshotArtifact): Promise<void> {
    if (target.hostId === 'local') {
      await this.local.apply({ artifactId: artifact.artifactId, rootPath: target.rootPath, baseSha: artifact.baseSha });
      return;
    }
    this.requireSnapshotCapability(target.hostId);
    const begin = beginSchema.parse(await this.execute(target, `snapshot:begin:${artifact.artifactId}`, {
      action: 'begin_import',
      ...artifact,
    }));
    if (!begin.complete) {
      let offset = 0;
      while (offset < artifact.size) {
        const chunk = await this.local.readChunk(artifact.artifactId, offset, SNAPSHOT_CHUNK_BYTES);
        await this.execute(target, `snapshot:write:${artifact.artifactId}:${offset}`, {
          action: 'write_import',
          artifactId: artifact.artifactId,
          offset,
          data: chunk.data.toString('base64'),
        });
        offset += chunk.data.length;
      }
      await this.execute(target, `snapshot:finalize:${artifact.artifactId}`, {
        action: 'finalize_import',
        artifactId: artifact.artifactId,
      });
    }
    await this.execute(target, `snapshot:apply:${artifact.artifactId}`, {
      action: 'apply_import',
      artifactId: artifact.artifactId,
    });
  }

  async cleanup(source: ExecutionEnvironment, target: ExecutionEnvironment, artifactId: string): Promise<void> {
    await this.local.remove(artifactId);
    const remoteEnvironments = [...new Map([source, target]
      .filter((environment) => environment.hostId !== 'local')
      .map((environment) => [environment.hostId, environment])).values()];
    await Promise.all(remoteEnvironments
      .map((environment) => this.execute(environment, `snapshot:remove:${artifactId}`, {
        action: 'remove',
        artifactId,
      })));
  }

  private async receiveFromRemote(source: ExecutionEnvironment, artifact: SnapshotArtifact): Promise<void> {
    if (await this.local.beginReceive(artifact)) return;
    let offset = 0;
    while (offset < artifact.size) {
      const result = chunkSchema.parse(await this.execute(source, `snapshot:read:${artifact.artifactId}:${offset}`, {
        action: 'read',
        artifactId: artifact.artifactId,
        offset,
        length: SNAPSHOT_CHUNK_BYTES,
      }));
      if (result.offset !== offset) throw new Error('Execution host returned a non-sequential snapshot chunk');
      const data = Buffer.from(result.data, 'base64');
      if (data.toString('base64') !== result.data || data.length === 0 || data.length > SNAPSHOT_CHUNK_BYTES) {
        throw new Error('Execution host returned an invalid snapshot chunk');
      }
      await this.local.writeChunk(artifact.artifactId, offset, data);
      offset += data.length;
      if (result.eof !== (offset === artifact.size)) throw new Error('Execution host returned an invalid snapshot boundary');
    }
    await this.local.finalizeReceive(artifact.artifactId);
  }

  private requireSnapshotCapability(hostId: string): void {
    const host = this.options.getRegistry().get(hostId);
    if (!host) throw Object.assign(new Error(`Execution host is offline: ${hostId}`), { retryable: true });
    if (!host.hello.capabilities.snapshots) {
      throw new Error(`Execution host does not support workspace snapshots: ${hostId}`);
    }
  }

  private execute(environment: ExecutionEnvironment, idempotencyKey: string, payload: unknown): Promise<unknown> {
    return this.options.getRegistry().execute(environment.hostId, {
      operationId: crypto.randomUUID(),
      environmentId: environment.id,
      bindingEpoch: 0,
      deadlineAt: Date.now() + OPERATION_DEADLINE_MS,
      idempotencyKey,
      command: 'environment.snapshot',
      payload,
    });
  }
}
