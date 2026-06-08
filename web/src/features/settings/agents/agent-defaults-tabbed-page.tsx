import { useCallback, useMemo, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

import { SettingsAdvancedGate } from '@/features/settings/settings-advanced-gate';
import { useAgentDefaultsTabGuard } from '@/features/settings/use-settings-tab-guard';
import { SkillsMarketplaceConfigSection } from '@/features/skills/skills-marketplace-config-section';
import { messages } from '@/i18n/messages';
import { visibleAgentDefaultsTabs } from '@/navigation/settings-field-visibility';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';
import { useSettingsModeStore } from '@/stores/settings-mode-store';

import type { AgentDefaultsPanelProps } from './agent-defaults-panel-props';
import { AgentDefaultsBasicsPanel } from './agent-defaults-panels/basics-panel';
import { AgentDefaultsCapabilitiesPanel } from './agent-defaults-panels/capabilities-panel';
import { AgentDefaultsContextPanel } from './agent-defaults-panels/context-panel';
import { AgentDefaultsExpertPanel } from './agent-defaults-panels/expert-panel';
import { AgentDefaultsGenerationPanel } from './agent-defaults-panels/generation-panel';
import { AgentDefaultsLimitsPanel } from './agent-defaults-panels/limits-panel';
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
    case 'model-strategy':
      return a.routeIntro.modelStrategy;
    case 'generation':
      return a.routeIntro.generation;
    case 'workspace':
      return a.routeIntro.workspace;
    case 'runtime':
      return a.routeIntro.runtime;
    case 'context':
      return a.routeIntro.context;
    case 'memory':
      return a.routeIntro.memory;
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
    case 'model-strategy':
      return <AgentDefaultsBasicsPanel {...pp} />;
    case 'generation':
      return <AgentDefaultsGenerationPanel {...pp} />;
    case 'workspace':
      return <AgentDefaultsWorkspacePanel {...pp} />;
    case 'runtime':
      return <AgentDefaultsLimitsPanel {...pp} />;
    case 'context':
      return <AgentDefaultsContextPanel {...pp} />;
    case 'memory':
      return <AgentDefaultsMemoryPanel {...pp} />;
    case 'tools':
      return (
        <div className="flex flex-col gap-8">
          <AgentDefaultsCapabilitiesPanel {...pp} />
          <SettingsAdvancedGate>
            <AgentDefaultsExpertPanel {...pp} />
          </SettingsAdvancedGate>
        </div>
      );
    case 'skills':
      return (
        <div className="flex flex-col gap-8">
          <SettingsAdvancedGate>
            <SkillsMarketplaceConfigSection hasToken={hasToken} />
          </SettingsAdvancedGate>
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
  const routerLocation = useLocation();
  const routerLocationStateRef = useRef(routerLocation.state);
  routerLocationStateRef.current = routerLocation.state;
  const [searchParams, setSearchParams] = useSearchParams();

  const settingsMode = useSettingsModeStore((s) => s.mode);
  const activeTab = parseAgentDefaultsTab(searchParams.get('tab'));
  const vm = useAgentDefaultsForm(a);
  const visibleTabs = useMemo(
    () => visibleAgentDefaultsTabs(AGENT_DEFAULTS_TABS, settingsMode),
    [settingsMode],
  );

  const pp = useMemo(() => {
    if (!vm.form) return null;
    return { form: vm.form, update: vm.update, a, chat };
  }, [vm.form, vm.update, a, chat]);

  const setActiveTab = useCallback(
    (tab: AgentDefaultsTabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'model-strategy') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true, state: routerLocationStateRef.current },
      );
    },
    [setSearchParams],
  );

  useAgentDefaultsTabGuard(activeTab, setActiveTab);

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
          const idx = visibleTabs.indexOf(activeTab);
          if (idx < 0) return;
          const delta = e.key === 'ArrowRight' ? 1 : -1;
          const next = visibleTabs[(idx + delta + visibleTabs.length) % visibleTabs.length];
          setActiveTab(next);
        }}
      >
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {visibleTabs.map((tab) => {
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
                  interaction.press,
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
