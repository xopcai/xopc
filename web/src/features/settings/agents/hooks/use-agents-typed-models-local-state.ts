import { useRef, useState } from 'react';

import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';

import type { AgentPanel } from '../utils';
import {
  typedModelsRowsFromEntry,
  type AgentTypedModelRow,
} from '../typed-models-lib';

function typedModelsStateFromSelected(selected: GatewayAgentRow): {
  inherit: boolean;
  rows: AgentTypedModelRow[];
} {
  const inherit = selected.typedModels.entry === undefined;
  if (inherit) {
    return { inherit: true, rows: typedModelsRowsFromEntry(selected.typedModels.effective) };
  }
  return { inherit: false, rows: typedModelsRowsFromEntry(selected.typedModels.entry) };
}

export function useAgentsTypedModelsLocalState(options: {
  panel: AgentPanel;
  selected: GatewayAgentRow | null;
}) {
  const { panel, selected } = options;

  const syncKey = `${panel}:${selected?.id ?? ''}`;
  const trackedSyncRef = useRef(syncKey);
  const [modelsInherit, setModelsInherit] = useState(true);
  const [modelsRows, setModelsRows] = useState<AgentTypedModelRow[]>(() => []);

  if (trackedSyncRef.current !== syncKey) {
    trackedSyncRef.current = syncKey;
    if (selected && panel === 'models') {
      const next = typedModelsStateFromSelected(selected);
      setModelsInherit(next.inherit);
      setModelsRows(next.rows);
    }
  }

  return {
    modelsInherit,
    setModelsInherit,
    modelsRows,
    setModelsRows,
  };
}

export function isTypedModelsPanelDirty(
  selected: GatewayAgentRow,
  modelsInherit: boolean,
  modelsRows: AgentTypedModelRow[],
): boolean {
  if (modelsInherit) {
    return selected.typedModels.entry !== undefined;
  }
  const entryRows = typedModelsRowsFromEntry(selected.typedModels.entry);
  return JSON.stringify(modelsRows) !== JSON.stringify(entryRows);
}
