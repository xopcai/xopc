import { useEffect, useState } from 'react';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';

import type { AgentPanel } from '../utils';

export function useAgentsToolsSkillsLocalState(options: {
  panel: AgentPanel;
  selected: GatewayAgentRow | null;
}) {
  const { panel, selected } = options;

  const [toolEntryDisable, setToolEntryDisable] = useState<Set<string>>(() => new Set());
  const [skillsPick, setSkillsPick] = useState<Set<string>>(() => new Set());
  const [skillsInherit, setSkillsInherit] = useState(true);

  useEffect(() => {
    if (!selected || panel !== 'tools') {
      return;
    }
    setToolEntryDisable(new Set(selected.tools.entryDisable));
  }, [panel, selected]);

  useEffect(() => {
    if (!selected || panel !== 'skills') {
      return;
    }
    const inherit = selected.skills.entry === undefined;
    setSkillsInherit(inherit);
    if (inherit) {
      const eff = selected.skills.effectiveAllowlist;
      setSkillsPick(new Set(eff ?? []));
    } else {
      setSkillsPick(new Set(selected.skills.entry ?? []));
    }
  }, [panel, selected]);

  return {
    toolEntryDisable,
    setToolEntryDisable,
    skillsPick,
    setSkillsPick,
    skillsInherit,
    setSkillsInherit,
  };
}
