import { useEffect, useMemo, useState } from 'react';

import { fetchSkillsCatalog, type SkillCatalogRow } from '@/features/settings/agents-admin-api';

import type { AgentPanel } from '../utils';

export function useAgentsSkillsCatalog(options: { panel: AgentPanel; hasToken: boolean }) {
  const { panel, hasToken } = options;

  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogRow[]>([]);
  const [skillsCatalogLoading, setSkillsCatalogLoading] = useState(false);

  const catalogForPick = useMemo(
    () => skillCatalog.filter((s) => s.enabled !== false),
    [skillCatalog],
  );

  useEffect(() => {
    if (panel !== 'skills' || !hasToken) {
      return;
    }
    let cancelled = false;
    setSkillsCatalogLoading(true);
    void fetchSkillsCatalog()
      .then((rows) => {
        if (!cancelled) {
          setSkillCatalog(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSkillCatalog([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSkillsCatalogLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [panel, hasToken]);

  return {
    catalogForPick,
    skillCatalog,
    skillsCatalogLoading,
  };
}
