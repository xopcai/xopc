import { Puzzle, Wrench } from 'lucide-react';
import { useState, type Dispatch, type SetStateAction } from 'react';

import { PageTabs } from '@/components/ui/page-tabs';
import type {
  GatewayAgentRow,
  GatewayAgentsPayload,
  SkillCatalogRow,
} from '@/features/settings/agents-admin-api';
import type { AgentsSettingsMessages } from '@/i18n/messages';

import { AgentSkillsTab } from './agent-skills-tab';
import { AgentToolsTab } from './agent-tools-tab';

type CapabilityTab = 'tools' | 'skills';

export function AgentCapabilitiesTab(props: {
  a: AgentsSettingsMessages;
  data: GatewayAgentsPayload;
  selected: GatewayAgentRow;
  busy: boolean;
  toolEntryDisable: Set<string>;
  setToolEntryDisable: Dispatch<SetStateAction<Set<string>>>;
  onSaveTools: (disabledIds: string[]) => Promise<void>;
  onClearToolsEntry: () => void;
  skillsCatalogLoading: boolean;
  catalogForPick: SkillCatalogRow[];
  skillsInherit: boolean;
  setSkillsInherit: (value: boolean) => void;
  skillsPick: Set<string>;
  setSkillsPick: Dispatch<SetStateAction<Set<string>>>;
  onSaveSkills: (snapshot: { inherit: boolean; skills: string[] }) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<CapabilityTab>('tools');
  const { a } = props;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="shrink-0">
        <p className="mb-3 max-w-[70ch] text-sm leading-6 text-fg-muted">{a.capabilitiesHint}</p>
        <PageTabs
          items={[
            { id: 'tools', label: a.capabilitiesToolsTab, icon: Wrench },
            { id: 'skills', label: a.capabilitiesSkillsTab, icon: Puzzle },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          ariaLabel={a.capabilitiesNavAria}
          tabIdPrefix="agent-capabilities-tab"
          panelIdPrefix="agent-capabilities-panel"
        />
      </div>

      {activeTab === 'tools' ? (
        <AgentToolsTab
          a={a}
          data={props.data}
          selected={props.selected}
          busy={props.busy}
          toolEntryDisable={props.toolEntryDisable}
          setToolEntryDisable={props.setToolEntryDisable}
          onSaveTools={props.onSaveTools}
          onClearToolsEntry={props.onClearToolsEntry}
        />
      ) : (
        <AgentSkillsTab
          a={a}
          selected={props.selected}
          busy={props.busy}
          skillsCatalogLoading={props.skillsCatalogLoading}
          catalogForPick={props.catalogForPick}
          skillsInherit={props.skillsInherit}
          setSkillsInherit={props.setSkillsInherit}
          skillsPick={props.skillsPick}
          setSkillsPick={props.setSkillsPick}
          onSaveSkills={props.onSaveSkills}
        />
      )}
    </div>
  );
}
