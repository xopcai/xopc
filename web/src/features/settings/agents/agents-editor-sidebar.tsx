import { Clock, FileText, Plug, Puzzle, User, UserCircle, Wrench } from 'lucide-react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { AgentsSettingsMessages } from '@/i18n/messages';

import type { AgentPanel } from './utils';

const mainNav: { id: AgentPanel; labelKey: keyof AgentsSettingsMessages; icon: typeof User }[] = [
  { id: 'overview', labelKey: 'navIdentity', icon: User },
  { id: 'profile', labelKey: 'navProfile', icon: UserCircle },
  { id: 'tools', labelKey: 'navTools', icon: Wrench },
  { id: 'skills', labelKey: 'navSkills', icon: Puzzle },
  { id: 'files', labelKey: 'navCoreFiles', icon: FileText },
];

const advancedNav: { id: AgentPanel; labelKey: keyof AgentsSettingsMessages; icon: typeof Plug }[] = [
  { id: 'channels', labelKey: 'tabChannels', icon: Plug },
  { id: 'cron', labelKey: 'tabCron', icon: Clock },
];

export function AgentsEditorSidebar(props: {
  a: AgentsSettingsMessages;
  panel: AgentPanel;
  onPanelChange: (p: AgentPanel) => void;
}) {
  const { a, panel, onPanelChange } = props;

  const item = (id: AgentPanel, label: string, Icon: typeof User) => (
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
        {mainNav.map(({ id, labelKey, icon }) => item(id, a[labelKey] as string, icon))}
      </div>
      <p className="mt-4 px-3 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
        {a.navAdvanced}
      </p>
      <div className="flex flex-col gap-0.5">
        {advancedNav.map(({ id, labelKey, icon }) => item(id, a[labelKey] as string, icon))}
      </div>
    </nav>
  );
}
