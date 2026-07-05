import { AlertTriangle, Brain, Cable, Gauge, SlidersHorizontal, Sparkles, Wrench, Zap } from 'lucide-react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { AgentsSettingsMessages } from '@/i18n/messages';

import type { AgentPanel } from './utils';

const navItems: { id: AgentPanel; labelKey: keyof AgentsSettingsMessages; icon: typeof Gauge }[] = [
  { id: 'overview', labelKey: 'navOverview', icon: Gauge },
  { id: 'behavior', labelKey: 'navBehavior', icon: Sparkles },
  { id: 'tools', labelKey: 'navTools', icon: Wrench },
  { id: 'skills', labelKey: 'navSkills', icon: Zap },
  { id: 'memory', labelKey: 'navMemory', icon: Brain },
  { id: 'connections', labelKey: 'navConnections', icon: Cable },
  { id: 'config', labelKey: 'navConfig', icon: SlidersHorizontal },
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
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
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
    <nav className="flex w-full flex-col gap-1" aria-label={a.editorNavAria}>
      <div className="flex flex-col gap-0.5">
        {navItems.map(({ id, labelKey, icon }) => item(id, a[labelKey] as string, icon))}
      </div>
    </nav>
  );
}
