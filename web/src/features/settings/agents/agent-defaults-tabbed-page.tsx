import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { GoalsConfigSection } from '@/features/settings/goals-config-section';
import { SkillsMarketplaceConfigSection } from '@/features/skills/skills-marketplace-config-section';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import type { AgentDefaultsPanelProps } from './agent-defaults-panel-props';
import { AgentDefaultsBasicsPanel } from './agent-defaults-panels/basics-panel';
import { AgentDefaultsBrowserPanel } from './agent-defaults-panels/browser-panel';
import { AgentDefaultsCapabilitiesPanel } from './agent-defaults-panels/capabilities-panel';
import { AgentDefaultsContextPanel } from './agent-defaults-panels/context-panel';
import { AgentDefaultsExpertPanel } from './agent-defaults-panels/expert-panel';
import { AgentDefaultsMemoryPanel } from './agent-defaults-panels/memory-panel';
import { AgentDefaultsSkillsAllowlistPanel } from './agent-defaults-panels/skills-allowlist-panel';
import { AgentDefaultsSystemPromptPanel } from './agent-defaults-panels/system-prompt-panel';
import { AgentDefaultsWorkspacePanel } from './agent-defaults-panels/workspace-panel';
import {
  AGENT_DEFAULTS_TABS,
  type AgentDefaultsTabId,
  parseAgentDefaultsTab,
} from './agent-defaults-tabs';
import { AgentDefaultsRouteLayout } from './agent-defaults-route-layout';
import { useAgentDefaultsForm } from './use-agent-defaults-form';

function tabLabel(a: ReturnType<typeof messages>['agentSettings'], tab: AgentDefaultsTabId): string {
  return a.defaultsTabs[tab];
}

function tabIntro(a: ReturnType<typeof messages>['agentSettings'], tab: AgentDefaultsTabId): string {
  switch (tab) {
    case 'chat':
      return a.routeIntro.chat;
    case 'workspace':
      return a.routeIntro.workspace;
    case 'browser':
      return a.routeIntro.browser;
    case 'runtime':
      return a.routeIntro.runtime;
    case 'tools':
      return a.routeIntro.tools;
    case 'skills':
      return a.routeIntro.skills;
    case 'system-prompt':
      return a.routeIntro.systemPrompt;
  }
}

function AgentDefaultsTabPanel({
  tab,
  pp,
  hasToken,
}: {
  tab: AgentDefaultsTabId;
  pp: AgentDefaultsPanelProps;
  hasToken: boolean;
}) {
  switch (tab) {
    case 'chat':
      return <AgentDefaultsBasicsPanel {...pp} />;
    case 'workspace':
      return <AgentDefaultsWorkspacePanel {...pp} />;
    case 'browser':
      return <AgentDefaultsBrowserPanel {...pp} />;
    case 'runtime':
      return (
        <div className="flex flex-col gap-8">
          <GoalsConfigSection hasToken={hasToken} />
          <AgentDefaultsContextPanel {...pp} />
          <AgentDefaultsMemoryPanel {...pp} />
        </div>
      );
    case 'tools':
      return (
        <div className="flex flex-col gap-8">
          <AgentDefaultsCapabilitiesPanel {...pp} />
          <AgentDefaultsExpertPanel {...pp} />
        </div>
      );
    case 'skills':
      return (
        <div className="flex flex-col gap-8">
          <SkillsMarketplaceConfigSection hasToken={hasToken} />
          <AgentDefaultsSkillsAllowlistPanel {...pp} />
        </div>
      );
    case 'system-prompt':
      return <AgentDefaultsSystemPromptPanel {...pp} />;
  }
}

export function AgentDefaultsTabbedPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const a = m.agentSettings;
  const chat = m.chat;
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = parseAgentDefaultsTab(searchParams.get('tab'));
  const vm = useAgentDefaultsForm(a);

  const pp = useMemo(() => {
    if (!vm.form) return null;
    return { form: vm.form, update: vm.update, a, chat };
  }, [vm.form, vm.update, a, chat]);

  const setActiveTab = useCallback(
    (tab: AgentDefaultsTabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'chat') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const intro = tabIntro(a, activeTab);

  return (
    <AgentDefaultsRouteLayout sectionId="agent-defaults" intro="" vm={vm} tabbed>
      <div
        className="flex flex-col gap-5"
        role="tablist"
        aria-label={a.defaultsTabsAria}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const idx = AGENT_DEFAULTS_TABS.indexOf(activeTab);
          const delta = e.key === 'ArrowRight' ? 1 : -1;
          const next = AGENT_DEFAULTS_TABS[(idx + delta + AGENT_DEFAULTS_TABS.length) % AGENT_DEFAULTS_TABS.length];
          setActiveTab(next);
        }}
      >
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {AGENT_DEFAULTS_TABS.map((tab) => {
            const selected = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={selected}
                id={`agent-defaults-tab-${tab}`}
                aria-controls={`agent-defaults-panel-${tab}`}
                className={cn(
                  'shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  selected
                    ? 'bg-accent-soft text-accent-fg'
                    : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
                onClick={() => setActiveTab(tab)}
              >
                {tabLabel(a, tab)}
              </button>
            );
          })}
        </div>

        <p className="text-sm leading-relaxed text-fg-muted">{intro}</p>

        <div
          role="tabpanel"
          id={`agent-defaults-panel-${activeTab}`}
          aria-labelledby={`agent-defaults-tab-${activeTab}`}
          className="min-w-0"
        >
          {pp ? <AgentDefaultsTabPanel tab={activeTab} pp={pp} hasToken={vm.hasToken} /> : null}
        </div>
      </div>
    </AgentDefaultsRouteLayout>
  );
}
