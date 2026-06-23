import { useEffect, useMemo, useState } from 'react';

import { fetchSkillsCatalog, type SkillCatalogRow } from '@/features/settings/agents-admin-api';
import { useAsyncResource } from '@/lib/use-async-resource';

import type { AgentPanel } from '../utils';

export function useSkillsCatalogLoad(enabled: boolean, hasToken: boolean) {
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0);
  useEffect(() => {
    const onConfigReload = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (
        detail &&
        typeof detail === 'object' &&
        'section' in detail &&
        (detail as { section?: unknown }).section === 'skills'
      ) {
        setCatalogRefreshKey((k) => k + 1);
      }
    };
    window.addEventListener('config-reload', onConfigReload);
    return () => window.removeEventListener('config-reload', onConfigReload);
  }, []);

  const { data: skillCatalog, loading: skillsCatalogLoading } = useAsyncResource(
    () => fetchSkillsCatalog(),
    [enabled, hasToken, catalogRefreshKey],
    { enabled: enabled && hasToken, initial: [] as SkillCatalogRow[], errorData: [] },
  );

  const catalogForPick = useMemo(() => skillCatalog.filter((s) => s.enabled !== false), [skillCatalog]);

  return {
    catalogForPick,
    skillCatalog,
    skillsCatalogLoading,
  };
}

export function useAgentsSkillsCatalog(options: { panel: AgentPanel; hasToken: boolean }) {
  return useSkillsCatalogLoad(options.panel === 'skills', options.hasToken);
}
