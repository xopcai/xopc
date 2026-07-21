import { AlertTriangle, Bot, Cable, Gauge, Settings2, SlidersHorizontal, Sparkles } from 'lucide-react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { AgentsSettingsMessages } from '@/i18n/messages';

import type { AgentPanel } from './utils';

const navItems: { id: AgentPanel; labelKey: keyof AgentsSettingsMessages; icon: typeof Gauge }[] = [
  { id: 'overview', labelKey: 'navOverview', icon: Gauge },
  { id: 'profile', labelKey: 'navProfile', icon: Sparkles },
  { id: 'capabilities', labelKey: 'navCapabilities', icon: Bot },
  { id: 'runtime', labelKey: 'navRuntime', icon: Settings2 },
  { id: 'connections', labelKey: 'navConnections', icon: Cable },
  { id: 'advanced', labelKey: 'navAdvanced', icon: SlidersHorizontal },
  { id: 'dangerZone', labelKey: 'navDangerZone', icon: AlertTriangle },
];

export function AgentsEditorSidebar(props: {
  a: AgentsSettingsMessages;
  panel: AgentPanel;
  onPanelChange: (p: AgentPanel) => void;
}) {
  const { a, panel, onPanelChange } = props;

  const item = (id: AgentPanel, label: string, Icon: typeof Gauge) => (
    <button
      key={id}
      type="button"
      onClick={() => onPanelChange(id)}
      className={cn(
        'flex w-auto shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors sm:w-full',
        interaction.press,
        panel === id
          ? 'bg-accent-soft text-accent-fg'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      <Icon className="size-4 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );

  return (
    <nav className="w-full overflow-x-auto sm:overflow-visible" aria-label={a.editorNavAria}>
      <div className="flex gap-1 pb-1 sm:flex-col sm:gap-0.5 sm:pb-0">
        {navItems.map(({ id, labelKey, icon }) => item(id, a[labelKey] as string, icon))}
      </div>
    </nav>
  );
}
