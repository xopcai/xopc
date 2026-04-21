import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages } from '@/i18n/messages';

import type { AgentPanel } from './utils';

export function AgentsTabBar(props: {
  a: AgentsSettingsMessages;
  panel: AgentPanel;
  onPanelChange: (p: AgentPanel) => void;
}) {
  const { a, panel, onPanelChange } = props;

  const tab = (id: AgentPanel, label: string) => (
    <button
      key={id}
      type="button"
      className={cn(
        'rounded-lg px-3 py-1.5 text-sm font-medium',
        panel === id ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover',
      )}
      onClick={() => onPanelChange(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap gap-2 border-b border-edge-subtle pb-2">
      {tab('overview', a.tabOverview)}
      {tab('files', a.tabFiles)}
      {tab('tools', a.tabTools)}
      {tab('skills', a.tabSkills)}
      {tab('channels', a.tabChannels)}
      {tab('cron', a.tabCron)}
    </div>
  );
}
