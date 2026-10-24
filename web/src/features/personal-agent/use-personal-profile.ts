import { useEffect } from 'react';
import useSWR from 'swr';

import type { PersonalAppearance } from '@/features/personal-agent/personal-avatar';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

type PersonalProfile = {
  agentId: string;
  displayName: string;
  appearance: PersonalAppearance;
};

export function usePersonalProfile() {
  const browserSession = useGatewayStore(state => state.conversationId);
  const { data, mutate } = useSWR(
    browserSession ? ['personal-agent-nav', browserSession] : null,
    () => fetchJson<{ ok: boolean; payload: PersonalProfile | null }>(apiUrl('/api/personal-agent')),
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    const onProfileUpdated = (event: Event) => {
      const profile = (event as CustomEvent<PersonalProfile | null>).detail;
      if (profile === undefined) {
        void mutate();
      } else {
        void mutate({ ok: true, payload: profile }, { revalidate: false });
      }
    };
    window.addEventListener('personal-agent-updated', onProfileUpdated);
    return () => window.removeEventListener('personal-agent-updated', onProfileUpdated);
  }, [mutate]);

  return { profile: data?.payload, displayName: data?.payload?.displayName?.trim() || 'Ada' };
}
