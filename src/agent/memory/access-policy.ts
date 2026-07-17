import type { Config } from '../../config/schema.js';
import { resolveEffectiveAgentManifestForAgent } from '../../config/agent-profile.js';
import { normalizeAgentId } from '../../routing/agent-session-key.js';
import type { MemoryRecord, MemoryScope } from './types.js';

export type CrossAgentSharingMode = 'deny' | 'readOnly' | 'allow';

export interface MemoryAccessPolicy {
  requesterAgentId: string;
  readableAgentIds: readonly string[];
  canReadAgent(ownerAgentId: string): boolean;
  canReadRecord(record: MemoryRecord, scope?: Partial<MemoryScope>): boolean;
  canSubmitCandidate(ownerAgentId: string): boolean;
}

function sharingMode(config: Config, agentId: string): CrossAgentSharingMode {
  return resolveEffectiveAgentManifestForAgent(config, agentId)
    .memory.privacy?.crossAgentSharing ?? 'deny';
}

/** Resolve bilateral cross-agent memory grants for one requesting agent. */
export function resolveMemoryAccessPolicy(
  config: Config,
  requestedAgentId: string,
): MemoryAccessPolicy {
  const requesterAgentId = normalizeAgentId(requestedAgentId);
  const requesterManifest = resolveEffectiveAgentManifestForAgent(config, requesterAgentId);
  const requesterMode = requesterManifest.memory.privacy?.crossAgentSharing ?? 'deny';
  const enabledAgentIds = config.agents.list
    .filter((entry) => entry.enabled !== false)
    .map((entry) => normalizeAgentId(entry.id));

  const canReadAgent = (ownerAgentId: string): boolean => {
    const owner = normalizeAgentId(ownerAgentId);
    if (owner === requesterAgentId) return true;
    if (
      requesterManifest.memory.mode === 'off'
      || requesterMode === 'deny'
      || !enabledAgentIds.includes(owner)
    ) return false;
    const ownerManifest = resolveEffectiveAgentManifestForAgent(config, owner);
    return ownerManifest.memory.mode !== 'off' && sharingMode(config, owner) !== 'deny';
  };

  const canReadRecord = (record: MemoryRecord, scope?: Partial<MemoryScope>): boolean => {
    if (!canReadAgent(record.scope.agentId)) return false;
    const crossAgent = normalizeAgentId(record.scope.agentId) !== requesterAgentId;
    if (crossAgent && record.sensitivity && record.sensitivity !== 'normal') {
      return false;
    }
    if (record.scope.sessionKey && record.scope.sessionKey !== scope?.sessionKey) return false;
    if (record.scope.projectId && record.scope.projectId !== scope?.projectId) return false;
    return true;
  };

  const canSubmitCandidate = (ownerAgentId: string): boolean => {
    const owner = normalizeAgentId(ownerAgentId);
    if (owner === requesterAgentId) return true;
    if (
      requesterManifest.memory.mode === 'off'
      || requesterMode !== 'allow'
      || !enabledAgentIds.includes(owner)
    ) return false;
    const ownerManifest = resolveEffectiveAgentManifestForAgent(config, owner);
    return ownerManifest.memory.mode !== 'off' && sharingMode(config, owner) === 'allow';
  };

  return {
    requesterAgentId,
    readableAgentIds: [requesterAgentId, ...enabledAgentIds.filter(
      (agentId) => agentId !== requesterAgentId && canReadAgent(agentId),
    )],
    canReadAgent,
    canReadRecord,
    canSubmitCandidate,
  };
}
