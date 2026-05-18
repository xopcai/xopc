import { useMemo } from 'react';

import { fetchSkillsCatalog, type SkillCatalogRow } from '@/features/settings/agents-admin-api';
import { useAsyncResource } from '@/lib/use-async-resource';

import type { AgentPanel } from '../utils';

export function useSkillsCatalogLoad(enabled: boolean, hasToken: boolean) {
  const { data: skillCatalog, loading: skillsCatalogLoading } = useAsyncResource(
    () => fetchSkillsCatalog(),
    [enabled, hasToken],
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
