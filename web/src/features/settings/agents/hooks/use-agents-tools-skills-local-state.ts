import { useRef, useState } from 'react';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';

import type { AgentPanel } from '../utils';
import { typedModelsRowsFromList, type AgentTypedModelRow } from '../typed-models-lib';

function toolDisableFromSelected(selected: GatewayAgentRow): Set<string> {
  return new Set(selected.tools.entryDisable);
}

function skillsStateFromSelected(selected: GatewayAgentRow): { inherit: boolean; pick: Set<string> } {
  const inherit = selected.skills.entry === undefined;
  if (inherit) {
    return { inherit: true, pick: new Set(selected.skills.effectiveAllowlist ?? []) };
  }
  return { inherit: false, pick: new Set(selected.skills.entry ?? []) };
}

export function useAgentsToolsSkillsLocalState(options: {
  panel: AgentPanel;
  selected: GatewayAgentRow | null;
}) {
  const { panel, selected } = options;

  const syncKey = `${panel}:${selected?.id ?? ''}`;
  const trackedSyncRef = useRef(syncKey);
  const [toolEntryDisable, setToolEntryDisable] = useState<Set<string>>(() => new Set());
  const [skillsPick, setSkillsPick] = useState<Set<string>>(() => new Set());
  const [skillsInherit, setSkillsInherit] = useState(true);
  const [modelRows, setModelRows] = useState<AgentTypedModelRow[]>(() => []);

  if (trackedSyncRef.current !== syncKey) {
    trackedSyncRef.current = syncKey;
    if (selected && panel === 'tools') {
      setToolEntryDisable(toolDisableFromSelected(selected));
    }
    if (selected && panel === 'skills') {
      const next = skillsStateFromSelected(selected);
      setSkillsInherit(next.inherit);
      setSkillsPick(next.pick);
    }
    if (selected && panel === 'behavior') {
      setModelRows(typedModelsRowsFromList(selected.typedModels.effective));
    }
  }

  return {
    toolEntryDisable,
    setToolEntryDisable,
    skillsPick,
    setSkillsPick,
    skillsInherit,
    setSkillsInherit,
    modelRows,
    setModelRows,
  };
}
