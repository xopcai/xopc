import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve as pathResolve } from 'node:path';

import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { AgentCatalogService } from '../agent-catalog/service.js';
import { resolveStateDir } from '../config/paths-state.js';
import {
  deleteAgentAvatarFile,
  readAgentAvatarFile,
  writeAgentAvatarFromBase64,
} from '../gateway/agents-admin.js';
import { readMediaReference } from '../media/media-reference.js';
import { getPersonalAgent } from '../personal-agent/repository.js';
import {
  patchPersonalProfile,
  type PersonalAppearance,
} from '../personal-agent/service.js';
import {
  deleteUserAvatar,
  readUserAvatar,
  USER_AVATAR_MAX_BYTES,
  writeUserAvatar,
} from '../user-context/user-avatar.js';
import type { SelfConfigAvatarTarget } from './types.js';

type SupportedImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface AvatarMutationDeps {
  workspace?: string;
  ownerId?: string;
  onAgentCatalogMutate?: () => void;
  evictSessionAgent?: (conversationId: string) => void;
  emitEvent?: (event: string, payload: unknown) => void;
}

export interface AvatarRollbackSnapshot {
  target: SelfConfigAvatarTarget;
  agentId?: string;
  hadBinary: boolean;
  appliedBinaryDigest: string | null;
  appliedAvatarValue?: string;
  previousBinary?: { base64: string; mimeType: SupportedImageMime };
  previousProfileAvatar?: string;
  previousPersonalAppearance?: PersonalAppearance;
}

export interface SetAvatarInput {
  target: SelfConfigAvatarTarget;
  agentId?: string;
  /** media:// URI or local workspace/state image path */
  source?: string;
  /** Preset avatar string (Agent: xopc:loopi:*, xopc:dicebear:*, https://...; Personal AI: loopi | loopi-curious | loopi-care) */
  preset?: string;
}

export interface AvatarMutationOutcome {
  ok: true;
  target: SelfConfigAvatarTarget;
  agentId?: string;
  beforeLabel: string;
  afterLabel: string;
  settingsSection: string;
  rollback: AvatarRollbackSnapshot;
}

const VALID_PERSONAL_PRESETS = new Set<PersonalAppearance>(['loopi', 'loopi-curious', 'loopi-care']);

function avatarDigest(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function assertAvatarUnchanged(
  snapshot: AvatarRollbackSnapshot,
  avatar: { ok: true; data: { buffer: Buffer } } | { ok: false },
  value?: string,
): void {
  const digest = avatar.ok ? avatarDigest(avatar.data.buffer) : null;
  if (digest !== snapshot.appliedBinaryDigest || value !== snapshot.appliedAvatarValue) {
    throw new Error('Avatar changed since this receipt was issued; rollback was skipped.');
  }
}

export function detectAvatarImageMime(buffer: Uint8Array): SupportedImageMime | null {
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12
    && buffer[0] === 0x52
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x46
    && buffer[8] === 0x57
    && buffer[9] === 0x45
    && buffer[10] === 0x42
    && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export async function resolveAvatarBinarySource(
  source: string,
  workspace?: string,
): Promise<{ base64: string; mimeType: SupportedImageMime; byteLength: number }> {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error('Avatar source is required.');
  }

  let buffer: Buffer;
  if (trimmed.startsWith('media://')) {
    const media = await readMediaReference(trimmed, USER_AVATAR_MAX_BYTES);
    buffer = media.buffer;
  } else {
    const candidate = isAbsolute(trimmed)
      ? pathResolve(trimmed)
      : workspace
        ? pathResolve(workspace, trimmed)
        : pathResolve(trimmed);
    const allowedRoots: string[] = [];
    for (const dir of [workspace, resolveStateDir()]) {
      if (!dir) continue;
      try {
        allowedRoots.push(await realpath(dir));
      } catch {
        allowedRoots.push(pathResolve(dir));
      }
    }
    let resolvedReal: string;
    try {
      resolvedReal = await realpath(candidate);
    } catch {
      throw new Error(`Image file not found: ${trimmed}`);
    }
    if (allowedRoots.length > 0 && !allowedRoots.some((root) => isInsideRoot(root, resolvedReal))) {
      throw new Error('Avatar file path must be inside the workspace or xopc state directory (or pass a media:// URI).');
    }
    const metadata = await stat(resolvedReal);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > USER_AVATAR_MAX_BYTES) {
      throw new Error(`Avatar image must be non-empty and at most ${USER_AVATAR_MAX_BYTES} bytes.`);
    }
    buffer = await readFile(resolvedReal);
  }

  if (buffer.byteLength === 0 || buffer.byteLength > USER_AVATAR_MAX_BYTES) {
    throw new Error(`Avatar image must be non-empty and at most ${USER_AVATAR_MAX_BYTES} bytes.`);
  }
  const mimeType = detectAvatarImageMime(buffer);
  if (!mimeType) {
    throw new Error('Unsupported avatar image format. Use PNG, JPEG, or WebP.');
  }
  return { base64: buffer.toString('base64'), mimeType, byteLength: buffer.byteLength };
}

function personalHost(deps: AvatarMutationDeps) {
  return {
    refreshAgentCatalog: () => deps.onAgentCatalogMutate?.(),
    agentService: {
      evictSessionAgent: (conversationId: string) => deps.evictSessionAgent?.(conversationId),
    },
  };
}

export async function setAvatarFromSource(
  input: SetAvatarInput,
  deps: AvatarMutationDeps,
): Promise<AvatarMutationOutcome> {
  const ownerId = deps.ownerId ?? 'local-owner';

  if (input.target === 'user') {
    if (!input.source) {
      throw new Error('Setting the user avatar requires an image source (media:// URI or image file path).');
    }
    const resolved = await resolveAvatarBinarySource(input.source, deps.workspace);
    const previous = await readUserAvatar();
    const written = await writeUserAvatar(resolved.base64, resolved.mimeType);
    if (written.ok === false) {
      throw new Error(written.error);
    }
    deps.emitEvent?.('user.avatar.updated', { configured: true, contentType: resolved.mimeType });
    return {
      ok: true,
      target: 'user',
      beforeLabel: previous.ok ? previous.data.contentType : 'none',
      afterLabel: `${resolved.mimeType} (${Math.round(resolved.byteLength / 1024)} KB)`,
      settingsSection: 'appearance',
      rollback: {
        target: 'user',
        appliedBinaryDigest: avatarDigest(Buffer.from(resolved.base64, 'base64')),
        hadBinary: previous.ok,
        ...(previous.ok
          ? {
              previousBinary: {
                base64: previous.data.buffer.toString('base64'),
                mimeType: previous.data.contentType,
              },
            }
          : {}),
      },
    };
  }

  if (input.target === 'personal_agent') {
    const record = getPersonalAgent(ownerId);
    if (!record || record.state !== 'ready') {
      throw new Error('Personal AI is not initialized yet.');
    }
    const previousBinary = await readAgentAvatarFile(record.agentId);
    const previousAppearance = record.appearance;
    if (input.source) {
      const resolved = await resolveAvatarBinarySource(input.source, deps.workspace);
      const written = await writeAgentAvatarFromBase64(record.agentId, resolved.base64, resolved.mimeType);
      if (written.ok === false) throw new Error(written.error);
      const updated = await patchPersonalProfile(
        personalHost(deps),
        ownerId,
        record.revision,
        record.displayName,
        'custom',
      );
      if (!updated) throw new Error('Personal AI profile changed concurrently; retry.');
      deps.emitEvent?.('agent.avatar.updated', { agentId: record.agentId });
      deps.emitEvent?.('personal.agent.updated', updated);
      return {
        ok: true,
        target: 'personal_agent',
        agentId: record.agentId,
        beforeLabel: previousAppearance,
        afterLabel: `custom (${resolved.mimeType})`,
        settingsSection: 'personal',
        rollback: {
          target: 'personal_agent',
          agentId: record.agentId,
          appliedBinaryDigest: avatarDigest(Buffer.from(resolved.base64, 'base64')),
          appliedAvatarValue: 'custom',
          hadBinary: previousBinary.ok,
          ...(previousBinary.ok
            ? {
                previousBinary: {
                  base64: previousBinary.data.buffer.toString('base64'),
                  mimeType: previousBinary.data.contentType as SupportedImageMime,
                },
              }
            : {}),
          previousPersonalAppearance: previousAppearance,
        },
      };
    }

    const preset = input.preset?.trim() as PersonalAppearance | undefined;
    if (!preset || !VALID_PERSONAL_PRESETS.has(preset)) {
      throw new Error('Provide an image source or a valid Personal AI preset: loopi, loopi-curious, or loopi-care.');
    }
    const updated = await patchPersonalProfile(
      personalHost(deps),
      ownerId,
      record.revision,
      record.displayName,
      preset,
    );
    if (!updated) throw new Error('Personal AI profile changed concurrently; retry.');
    deps.emitEvent?.('personal.agent.updated', updated);
    return {
      ok: true,
      target: 'personal_agent',
      agentId: record.agentId,
      beforeLabel: previousAppearance,
      afterLabel: preset,
      settingsSection: 'personal',
      rollback: {
        target: 'personal_agent',
        agentId: record.agentId,
        appliedBinaryDigest: previousBinary.ok ? avatarDigest(previousBinary.data.buffer) : null,
        appliedAvatarValue: preset,
        hadBinary: previousBinary.ok,
        ...(previousBinary.ok
          ? {
              previousBinary: {
                base64: previousBinary.data.buffer.toString('base64'),
                mimeType: previousBinary.data.contentType as SupportedImageMime,
              },
            }
          : {}),
        previousPersonalAppearance: previousAppearance,
      },
    };
  }

  // target === 'agent'
  const agentId = input.agentId?.trim();
  if (!agentId) {
    throw new Error('agentId is required when setting an Agent avatar.');
  }
  const repository = new AgentCatalogRepository();
  const current = repository.get(agentId);
  if (!current) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  const previousBinary = await readAgentAvatarFile(agentId);
  const previousProfileAvatar = current.profile?.avatar;

  let nextAvatarValue: string;
  let afterLabel: string;
  let appliedBinaryDigest = previousBinary.ok ? avatarDigest(previousBinary.data.buffer) : null;
  if (input.source) {
    const resolved = await resolveAvatarBinarySource(input.source, deps.workspace);
    const written = await writeAgentAvatarFromBase64(agentId, resolved.base64, resolved.mimeType);
    if (written.ok === false) throw new Error(written.error);
    appliedBinaryDigest = avatarDigest(Buffer.from(resolved.base64, 'base64'));
    nextAvatarValue = 'xopc:custom';
    afterLabel = `custom (${resolved.mimeType})`;
  } else if (input.preset?.trim()) {
    nextAvatarValue = input.preset.trim();
    afterLabel = nextAvatarValue;
  } else {
    throw new Error('Provide either source (media:// URI or file path) or preset for Agent avatar.');
  }

  const catalogService = new AgentCatalogService();
  await catalogService.update(
    agentId,
    {
      profile: {
        name: current.profile?.name ?? agentId,
        ...current.profile,
        avatar: nextAvatarValue,
      },
    },
    current.revision,
  );
  deps.onAgentCatalogMutate?.();
  deps.emitEvent?.('agent.avatar.updated', { agentId });

  return {
    ok: true,
    target: 'agent',
    agentId,
    beforeLabel: previousProfileAvatar ?? 'default',
    afterLabel,
    settingsSection: 'agents',
    rollback: {
      target: 'agent',
      agentId,
      appliedBinaryDigest,
      appliedAvatarValue: nextAvatarValue,
      hadBinary: previousBinary.ok,
      ...(previousBinary.ok
        ? {
            previousBinary: {
              base64: previousBinary.data.buffer.toString('base64'),
              mimeType: previousBinary.data.contentType as SupportedImageMime,
            },
          }
        : {}),
      previousProfileAvatar,
    },
  };
}

export async function deleteAvatarForTarget(
  input: { target: SelfConfigAvatarTarget; agentId?: string },
  deps: AvatarMutationDeps,
): Promise<AvatarMutationOutcome> {
  const ownerId = deps.ownerId ?? 'local-owner';

  if (input.target === 'user') {
    const previous = await readUserAvatar();
    await deleteUserAvatar();
    deps.emitEvent?.('user.avatar.updated', { configured: false });
    return {
      ok: true,
      target: 'user',
      beforeLabel: previous.ok ? previous.data.contentType : 'none',
      afterLabel: 'none',
      settingsSection: 'appearance',
      rollback: {
        target: 'user',
        appliedBinaryDigest: null,
        hadBinary: previous.ok,
        ...(previous.ok
          ? {
              previousBinary: {
                base64: previous.data.buffer.toString('base64'),
                mimeType: previous.data.contentType,
              },
            }
          : {}),
      },
    };
  }

  if (input.target === 'personal_agent') {
    const record = getPersonalAgent(ownerId);
    if (!record || record.state !== 'ready') {
      throw new Error('Personal AI is not initialized yet.');
    }
    const previousBinary = await readAgentAvatarFile(record.agentId);
    const previousAppearance = record.appearance;
    await deleteAgentAvatarFile(record.agentId);
    const updated = await patchPersonalProfile(
      personalHost(deps),
      ownerId,
      record.revision,
      record.displayName,
      'loopi',
    );
    if (!updated) throw new Error('Personal AI profile changed concurrently; retry.');
    deps.emitEvent?.('agent.avatar.updated', { agentId: record.agentId });
    deps.emitEvent?.('personal.agent.updated', updated);
    return {
      ok: true,
      target: 'personal_agent',
      agentId: record.agentId,
      beforeLabel: previousAppearance,
      afterLabel: 'loopi',
      settingsSection: 'personal',
      rollback: {
        target: 'personal_agent',
        agentId: record.agentId,
        appliedBinaryDigest: null,
        appliedAvatarValue: 'loopi',
        hadBinary: previousBinary.ok,
        ...(previousBinary.ok
          ? {
              previousBinary: {
                base64: previousBinary.data.buffer.toString('base64'),
                mimeType: previousBinary.data.contentType as SupportedImageMime,
              },
            }
          : {}),
        previousPersonalAppearance: previousAppearance,
      },
    };
  }

  const agentId = input.agentId?.trim();
  if (!agentId) {
    throw new Error('agentId is required when deleting an Agent avatar.');
  }
  const repository = new AgentCatalogRepository();
  const current = repository.get(agentId);
  if (!current) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  const previousBinary = await readAgentAvatarFile(agentId);
  const previousProfileAvatar = current.profile?.avatar;
  await deleteAgentAvatarFile(agentId);
  const nextProfile = {
    name: current.profile?.name ?? agentId,
    ...current.profile,
  };
  delete nextProfile.avatar;
  await new AgentCatalogService().update(agentId, { profile: nextProfile }, current.revision);
  deps.onAgentCatalogMutate?.();
  deps.emitEvent?.('agent.avatar.updated', { agentId });

  return {
    ok: true,
    target: 'agent',
    agentId,
    beforeLabel: previousProfileAvatar ?? 'default',
    afterLabel: 'default',
    settingsSection: 'agents',
    rollback: {
      target: 'agent',
      agentId,
      appliedBinaryDigest: null,
      hadBinary: previousBinary.ok,
      ...(previousBinary.ok
        ? {
            previousBinary: {
              base64: previousBinary.data.buffer.toString('base64'),
              mimeType: previousBinary.data.contentType as SupportedImageMime,
            },
          }
        : {}),
      previousProfileAvatar,
    },
  };
}

export async function restoreAvatarFromSnapshot(
  snapshot: AvatarRollbackSnapshot,
  deps: AvatarMutationDeps,
): Promise<void> {
  const ownerId = deps.ownerId ?? 'local-owner';
  if (snapshot.target === 'user') {
    assertAvatarUnchanged(snapshot, await readUserAvatar());
    if (snapshot.hadBinary && snapshot.previousBinary) {
      const res = await writeUserAvatar(snapshot.previousBinary.base64, snapshot.previousBinary.mimeType);
      if (res.ok === false) throw new Error(res.error);
      deps.emitEvent?.('user.avatar.updated', { configured: true, contentType: snapshot.previousBinary.mimeType });
    } else {
      await deleteUserAvatar();
      deps.emitEvent?.('user.avatar.updated', { configured: false });
    }
    return;
  }

  if (snapshot.target === 'personal_agent') {
    const record = getPersonalAgent(ownerId);
    if (!record || record.state !== 'ready' || record.agentId !== snapshot.agentId) throw new Error('Personal AI is unavailable');
    assertAvatarUnchanged(snapshot, await readAgentAvatarFile(record.agentId), record.appearance);
    if (snapshot.hadBinary && snapshot.previousBinary) {
      const restored = await writeAgentAvatarFromBase64(record.agentId, snapshot.previousBinary.base64, snapshot.previousBinary.mimeType);
      if (restored.ok === false) throw new Error(restored.error);
    } else {
      await deleteAgentAvatarFile(record.agentId);
    }
    const updated = await patchPersonalProfile(
      personalHost(deps),
      ownerId,
      record.revision,
      record.displayName,
      snapshot.previousPersonalAppearance ?? 'loopi',
    );
    if (!updated) throw new Error('Personal AI profile changed concurrently; rollback failed.');
    deps.emitEvent?.('agent.avatar.updated', { agentId: record.agentId });
    deps.emitEvent?.('personal.agent.updated', updated);
    return;
  }

  const agentId = snapshot.agentId;
  if (!agentId) throw new Error('Missing agentId for avatar rollback');
  const current = new AgentCatalogRepository().get(agentId);
  if (!current) throw new Error(`Agent not found: ${agentId}`);
  assertAvatarUnchanged(snapshot, await readAgentAvatarFile(agentId), current.profile?.avatar);
  if (snapshot.hadBinary && snapshot.previousBinary) {
    const restored = await writeAgentAvatarFromBase64(agentId, snapshot.previousBinary.base64, snapshot.previousBinary.mimeType);
    if (restored.ok === false) throw new Error(restored.error);
  } else {
    await deleteAgentAvatarFile(agentId);
  }
  const nextProfile = {
    name: current.profile?.name ?? agentId,
    ...current.profile,
  };
  if (snapshot.previousProfileAvatar !== undefined) {
    nextProfile.avatar = snapshot.previousProfileAvatar;
  } else {
    delete nextProfile.avatar;
  }
  await new AgentCatalogService().update(agentId, { profile: nextProfile }, current.revision);
  deps.onAgentCatalogMutate?.();
  deps.emitEvent?.('agent.avatar.updated', { agentId });
}
