import { createHash } from 'node:crypto';

import type { ExtensionContext, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { getCurrentTools } from '@earendil-works/pi-ai';

import type { AgentProfile } from '../../agent-config/index.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { getSessionConfig, getSessionMetadata, isXopcDatabaseOpen } from '../../storage/sqlite/index.js';

export const AGENT_PROFILE_CONTEXT_STATE = 'xopc.agent-profile-context';
export const AGENT_PROFILE_UPDATE_EVENT = 'xopc.agent-profile-update';

export function agentProfileContextFingerprint(agentId: string, profile: AgentProfile | undefined, responseLanguage?: string): string {
  return createHash('sha256').update(JSON.stringify({ agentId, responseLanguage: responseLanguage ?? 'auto',
    name: profile?.name, description: profile?.description, creature: profile?.creature,
    style: profile?.style, language: profile?.language, instructions: profile?.instructions,
  })).digest('hex');
}

/** Keep profile transitions separate from user messages and model-authored conversation. */
export function createAgentProfileContextExtension(conversationId: string): ExtensionFactory {
  return pi => {
    const snapshotForTurn = (context: ExtensionContext) => {
      if (!isXopcDatabaseOpen()) return;
      const agentId = getSessionMetadata(conversationId)?.agentId;
      if (!agentId) return;
      const profile = new AgentCatalogRepository().get(agentId)?.profile;
      const responseLanguage = getSessionConfig(conversationId)?.responseLanguage ?? 'auto';
      const fingerprint = agentProfileContextFingerprint(agentId, profile, responseLanguage);
      const configuration = { agentId, name: profile?.name ?? agentId, role: profile?.description || null,
        type: profile?.creature || null, style: profile?.style || null,
        primaryLanguage: profile?.language || null, responseLanguageOverride: responseLanguage };
      const previous = context.sessionManager.getBranch().findLast(entry => entry.type === 'custom'
        && entry.customType === AGENT_PROFILE_CONTEXT_STATE);
      const data = previous?.type === 'custom'
        ? previous.data as { fingerprint?: string; configuration?: typeof configuration } | undefined : undefined;
      const changed = data?.fingerprint !== fingerprint
        || JSON.stringify(data?.configuration) !== JSON.stringify(configuration);
      if (changed) pi.appendEntry(AGENT_PROFILE_CONTEXT_STATE, { fingerprint, configuration });
      const changedFields = Object.keys(configuration).filter(key => configuration[key as keyof typeof configuration]
        !== data?.configuration?.[key as keyof typeof configuration]);
      const updates = Object.fromEntries(changedFields.map(key => [key, {
        previous: data?.configuration?.[key as keyof typeof configuration] ?? null,
        current: configuration[key as keyof typeof configuration] ?? null,
      }]));
      if (!changed) return;
      const projected = Object.fromEntries(Object.entries(configuration).filter(([key]) =>
        ['agentId', 'name', 'role'].includes(key) || changedFields.includes(key)));
      return { role: 'custom' as const, timestamp: Date.now(),
        customType: AGENT_PROFILE_UPDATE_EVENT,
        content: JSON.stringify({ event: 'agent_configuration_updated', source: 'xopc-runtime',
          ...(changed ? { changedFields: changedFields.length ? changedFields : ['instructions'], updates } : {}),
          scope: 'agent_defaults', current: projected }),
        display: false,
      };
    };
    let snapshot: ReturnType<typeof snapshotForTurn>;
    pi.on('before_agent_start', (_event, context) => { snapshot = snapshotForTurn(context); });
    pi.on('context_with_system', (event, context) => {
      snapshot ??= snapshotForTurn(context);
      const messages = event.messages.filter(message => message.role !== 'system'
        && !(message.role === 'custom' && (message as { customType?: string }).customType === AGENT_PROFILE_UPDATE_EVENT));
      const inputIndex = messages.findLastIndex(message => message.role === 'user' || message.role === 'custom');
      if (snapshot) messages.splice(inputIndex < 0 ? messages.length : inputIndex, 0, snapshot);
      // Rebuild from pi's current options on every request so tools activated
      // within a turn retain their latest guidelines and declarations.
      return { messages: [{ role: 'system', content: context.getSystemPrompt(),
        toolsAdded: getCurrentTools(event.messages), timestamp: Date.now() }, ...messages] as typeof event.messages };
    });
  };
}
