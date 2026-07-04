import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  SettingsTabPanel,
  SettingsTabs,
  type SettingsTabItem,
} from '@/features/settings/settings-page-layout';
import { useBrowserSettingsTabGuard } from '@/features/settings/use-settings-tab-guard';
import { messages } from '@/i18n/messages';
import { visibleBrowserSettingsTabs } from '@/navigation/settings-field-visibility';
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
  const tabItems: SettingsTabItem<BrowserTabId>[] = visibleTabs.map((tab) => ({
    id: tab,
    label: browserTabLabel(agentSettings, tab),
  }));

  return (
    <AgentDefaultsRouteLayout sectionId="agent-browser" intro="" vm={viewModel} tabbed>
      <SettingsTabs
        items={tabItems}
        activeTab={activeTab}
        onChange={setActiveTab}
        ariaLabel={agentSettings.browserTabsAria}
        tabIdPrefix="agent-browser-tab"
        panelIdPrefix="agent-browser-panel"
      />
      <SettingsTabPanel
        id={activeTab}
        activeTab={activeTab}
        tabIdPrefix="agent-browser-tab"
        panelIdPrefix="agent-browser-panel"
        showHeading={false}
        framed={false}
      >
          {panelProps ? (
            <AgentDefaultsBrowserPanel
              {...panelProps}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
          ) : null}
      </SettingsTabPanel>
    </AgentDefaultsRouteLayout>
  );
}
