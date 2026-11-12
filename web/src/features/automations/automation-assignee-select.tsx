import { FormField } from '@/components/ui/form-field';
import { PopoverSelect } from '@/components/ui/popover-select';
import type { ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { messages } from '@/i18n/messages';

export function AutomationAssigneeSelect({ language, agents, defaultId, loading, value, onChange }: {
  language: 'en' | 'zh';
  agents: ChatAgentOption[];
  defaultId: string;
  loading: boolean;
  value: string;
  onChange: (id: string) => void;
}) {
  const { agentsSettings, automations } = messages(language);
  const labels = automations.form;
  const defaultAssignee = agents.find((agent) => agent.id === defaultId);
  const defaultLabel = defaultAssignee
    ? labels.defaultAgentWithName.replace('{{name}}', agentListDisplayName(defaultAssignee, agentsSettings))
    : labels.defaultAgent;

  return (
    <FormField label={labels.agent}>
      <PopoverSelect
        ariaLabel={labels.agent}
        value={value}
        placeholder={defaultLabel}
        loading={loading}
        options={agents.map((agent) => ({
          value: agent.id,
          label: agentListDisplayName(agent, agentsSettings),
          icon: <AgentAvatarDisplay agentId={agent.id} avatar={agent.avatar} size={20} />,
        }))}
        onChange={onChange}
      />
    </FormField>
  );
}
