import { resolveSkillPresentation } from '@xopcai/composer-core/skill-localization';
import { useCallback, useEffect, useMemo } from 'react';
import useSWR from 'swr';

import { getChatSkillsCached } from '@/features/chat/palette/command-palette-api';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

/** Shared, scoped metadata for pills, independent of whether the palette is open. */
export function useSkillLabel(agentId?: string, conversationId?: string | null, enabled = true) {
  const language = useLocaleStore((state) => state.language);
  const gatewayId = useGatewayStore((state) => state.conversationId);
  const baseUrl = useGatewayStore((state) => state.baseUrl);
  const { data, mutate } = useSWR(
    enabled && gatewayId ? ['chat-skill-labels', baseUrl, gatewayId, agentId ?? 'main', conversationId ?? ''] : null,
    () => getChatSkillsCached(agentId, conversationId),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  useEffect(() => {
    if (!enabled || !gatewayId) return;
    const reload = (event: Event) => {
      const section = (event as CustomEvent<{ section?: string }>).detail?.section;
      if (section === 'skills' || section === 'agents') void mutate();
    };
    window.addEventListener('config-reload', reload);
    return () => window.removeEventListener('config-reload', reload);
  }, [enabled, gatewayId, mutate]);
  const labels = useMemo(() => new Map(data?.skills.map((skill) => [
    skill.name, resolveSkillPresentation(skill, language).displayName,
  ])), [data, language]);
  return useCallback((name: string) => labels.get(name) ?? name, [labels]);
}
