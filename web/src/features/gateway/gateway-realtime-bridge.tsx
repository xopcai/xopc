import { useEffect } from 'react';
import { useSWRConfig } from 'swr';

import { clearChatSkillsCache, clearSkillPaletteCaches } from '@/features/chat/palette/command-palette-api';
import { clearConnectorPaletteCache } from '@/features/search/global-command-palette/connector-palette-api';
import { startChatRunStateBridge } from '@/features/chat/session/chat-run-state-bridge';
import { startAgentRunStreamEventBridge } from '@/features/gateway/agent-run-stream-event-bridge';
import { configReloadSection } from '@/features/gateway/config-reload-event';
import { useGatewayRealtime } from '@/features/gateway/use-gateway-realtime';
import { subscribeRealtimeTopic } from '@/features/gateway/gateway-realtime';
import { createResourceChangeConsumer, isResourceCacheKey } from '@/features/gateway/resource-change';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

const AGENT_CATALOG_CACHE_KEYS = new Set([
  'automation-chat-agents',
  'channel-routing-agents',
  'gateway-chat-agents',
  'picker-agents-list',
  'settings-gateway-agents',
  'setup-checklist-agents',
  'workflow-agents',
  'workflow-route-agents',
]);

export function isAgentCatalogCacheKey(key: unknown): boolean {
  const root = Array.isArray(key) ? key[0] : key;
  return typeof root === 'string' && AGENT_CATALOG_CACHE_KEYS.has(root);
}

export function GatewayRealtimeBridge() {
  useGatewayRealtime();
  const { mutate } = useSWRConfig();
  const identity = useGatewayStore(state => state.conversationId);
  useEffect(() => startAgentRunStreamEventBridge(), []);
  useEffect(() => startChatRunStateBridge(), []);
  useEffect(() => {
    const refresh = (kind: 'note' | 'task' | 'project', id?: string) => {
      void mutate(key => isResourceCacheKey(key, kind));
      if (kind === 'project') window.dispatchEvent(new CustomEvent('project-resource-changed', { detail: { id } }));
    };
    const consume = createResourceChangeConsumer(change => {
      if (change.kind !== 'note' && change.kind !== 'task' && change.kind !== 'project') return;
      refresh(change.kind, change.id);
      if (change.kind === 'note') window.dispatchEvent(new CustomEvent('note-updated', { detail: { noteId: change.id } }));
    });
    let generation = 0;
    let unsubscribe: Array<() => void> = [];
    const discover = async () => {
      const current = ++generation;
      unsubscribe.forEach(stop => stop());
      unsubscribe = [];
      try {
        const { capabilities } = await fetchJson<{ capabilities: Array<{ id: string }> }>(apiUrl('/api/capabilities/operations'));
        if (current !== generation) return;
        unsubscribe = (['note', 'task', 'project'] as const)
          .filter(kind => capabilities.some(item => item.id === `xopc.${kind}s.list`))
          .map(kind => {
            const stop = subscribeRealtimeTopic(`resources:${kind}s`, {
              onEvent: event => { if (event.event === 'resource.changed') consume(event.topic, event.data); },
              onGap: () => refresh(kind),
            }, 0);
            refresh(kind);
            return stop;
          });
      } catch { /* Re-discover on the next authenticated connection. */ }
    };
    const onConnected = () => { void discover(); };
    if (identity) void discover();
    window.addEventListener('gateway-realtime-connected', onConnected);
    return () => {
      generation++;
      unsubscribe.forEach(stop => stop());
      window.removeEventListener('gateway-realtime-connected', onConnected);
    };
  }, [mutate, identity]);
  useEffect(() => {
    const onAgentCatalog = () => {
      clearChatSkillsCache();
      void mutate(isAgentCatalogCacheKey);
    };
    const onConfigReload = (event: Event) => {
      clearConnectorPaletteCache();
      const section = configReloadSection((event as CustomEvent<unknown>).detail);
      if (section === 'skills') clearSkillPaletteCaches();
      else if (section === 'agents') clearChatSkillsCache();
    };
    const onGap = (event: Event) => {
      const topic = (event as CustomEvent<{ topic?: string }>).detail?.topic;
      if (topic === 'gateway' || topic === 'sessions') void mutate(() => true);
    };
    window.addEventListener('agent-catalog', onAgentCatalog);
    window.addEventListener('config-reload', onConfigReload);
    window.addEventListener('realtime-gap', onGap);
    return () => {
      window.removeEventListener('agent-catalog', onAgentCatalog);
      window.removeEventListener('config-reload', onConfigReload);
      window.removeEventListener('realtime-gap', onGap);
    };
  }, [mutate]);
  return null;
}
