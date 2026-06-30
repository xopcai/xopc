import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useBrowserSettingsTabGuard } from '@/features/settings/use-settings-tab-guard';
import { messages } from '@/i18n/messages';
import { visibleBrowserSettingsTabs } from '@/navigation/settings-field-visibility';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';
import { useSettingsModeStore } from '@/stores/settings-mode-store';

import { AgentDefaultsBrowserPanel } from './browser-settings-panel';
import {
  browserFocusElementId,
  parseBrowserSettingsFocus,
} from './panels/browser-focus';
import {
  BROWSER_TABS,
  LEGACY_BROWSER_FOCUS_TO_TAB,
  parseBrowserTab,
  type BrowserTabId,
} from './panels/browser-tabs';
import { AgentDefaultsRouteLayout } from './browser-settings-route-layout';
import { useAgentDefaultsForm } from './use-browser-settings-form';

function browserTabLabel(
  a: ReturnType<typeof messages>['agentSettings'],
  tab: BrowserTabId,
): string {
  return a.browserTabs[tab];
}

export function AgentBrowserSettingsPage() {
  const language = useLocaleStore((state) => state.language);
  const messageBundle = messages(language);
  const agentSettings = messageBundle.agentSettings;
  const chatMessages = messageBundle.chat;
  const settingsMode = useSettingsModeStore((s) => s.mode);
  const viewModel = useAgentDefaultsForm(agentSettings, { saveScope: 'browser' });
  const [searchParams, setSearchParams] = useSearchParams();
  const visibleTabs = useMemo(
    () => visibleBrowserSettingsTabs(BROWSER_TABS, settingsMode),
    [settingsMode],
  );

  const focus = parseBrowserSettingsFocus(searchParams.get('focus'));
  const activeTab = focus
    ? (LEGACY_BROWSER_FOCUS_TO_TAB[focus] ?? parseBrowserTab(searchParams.get('tab')))
    : parseBrowserTab(searchParams.get('tab'));

  const panelProps = useMemo(() => {
    if (!viewModel.form) {
      return null;
    }
    return {
      form: viewModel.form,
      update: viewModel.update,
      a: agentSettings,
      chat: chatMessages,
    };
  }, [viewModel.form, viewModel.update, agentSettings, chatMessages]);

  const setActiveTab = useCallback(
    (tab: BrowserTabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('focus');
          if (tab === 'overview') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useBrowserSettingsTabGuard(activeTab, setActiveTab);

  useEffect(() => {
    if (!focus) return undefined;
    const tab = LEGACY_BROWSER_FOCUS_TO_TAB[focus] ?? parseBrowserTab(searchParams.get('tab'));
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('focus');
        if (tab === 'overview') next.delete('tab');
        else next.set('tab', tab);
        return next;
      },
      { replace: true },
    );
    const scrollTarget =
      focus === 'runtime' || focus === 'security' ? browserFocusElementId(focus) : null;
    if (!scrollTarget) return undefined;
    const timer = window.setTimeout(() => {
      document.getElementById(scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [focus, searchParams, setSearchParams]);

  return (
    <AgentDefaultsRouteLayout sectionId="agent-browser" intro="" vm={viewModel} tabbed>
      <div
        className="flex flex-col gap-5"
        role="tablist"
        aria-label={agentSettings.browserTabsAria}
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
                id={`agent-browser-tab-${tab}`}
                aria-controls={`agent-browser-panel-${tab}`}
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
                {browserTabLabel(agentSettings, tab)}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`agent-browser-panel-${activeTab}`}
          aria-labelledby={`agent-browser-tab-${activeTab}`}
          className="min-w-0"
        >
          {panelProps ? (
            <AgentDefaultsBrowserPanel
              {...panelProps}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
          ) : null}
        </div>
      </div>
    </AgentDefaultsRouteLayout>
  );
}
