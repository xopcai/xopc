import { ImageIcon, Mic, Plug, Search, type LucideIcon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ImageModelsSettingsPanel } from '@/features/settings/image-models-settings';
import { VoiceSettingsPanel } from '@/features/settings/voice-settings';
import { WebSearchSettingsPanel } from '@/features/settings/web-search-settings';
import { SaveBarControls } from '@/features/settings/save-bar/save-bar-controls';
import {
  SettingsPageFrame,
  SettingsPageHeader,
  SettingsTabs,
} from '@/features/settings/settings-page-layout';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { docsGuidePageUrl } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

import { ConnectedProvidersGrid, useConnectedProviders } from './connected-providers-grid';
import { revalidateModelsHubCaches } from './models-hub-cache';
import { AddProviderDialog } from './add-provider-dialog';
import { ProviderManageDialog } from './provider-manage-dialog';

import {
  parseModelsHubTab,
  type ModelsHubTabId,
} from './models-hub-tabs';

interface TabDef {
  id: ModelsHubTabId;
  icon: LucideIcon;
  label: string;
  hint: string;
}

export function ModelsHubPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const c = m.modelsHub;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseModelsHubTab(searchParams.get('tab'));

  // Dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [manageTarget, setManageTarget] = useState<{ providerId: string; isCustom: boolean } | null>(null);

  // Shared provider data
  const providerData = useConnectedProviders();

  const tabDefs: readonly TabDef[] = [
    { id: 'services', icon: Plug, label: c.tabs.services, hint: c.servicesHint },
    { id: 'image-models', icon: ImageIcon, label: c.tabs.imageModels, hint: c.imageModelsHint },
    { id: 'voice', icon: Mic, label: c.tabs.voice, hint: c.voiceHint },
    { id: 'search', icon: Search, label: c.tabs.search, hint: c.searchHint },
  ];

  const setActiveTab = useCallback(
    (tab: ModelsHubTabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'services') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleSaved = useCallback(() => {
    void revalidateModelsHubCaches();
  }, []);

  return (
    <SettingsPageFrame>
      <SettingsPageHeader
        title={m.settingsSections.credentials}
        subtitle={c.subtitle}
        docsLink={docsGuidePageUrl(language, 'configuration')}
        docsLabel={c.docsLink}
      />

      <SaveBarControls />

      <SettingsTabs
        items={tabDefs}
        activeTab={activeTab}
        onChange={setActiveTab}
        ariaLabel={c.tabsAria}
        tabIdPrefix="hub-tab"
        panelIdPrefix="hub-panel"
      />

      {/* Tab panels */}
      {tabDefs.map((tab) => (
        <LazyPanelHost key={tab.id} id={tab.id} activeTab={activeTab} hint={tab.hint}>
          {tab.id === 'services' ? (
            <ConnectedProvidersGrid
              labels={c.connectedProviders}
              onAdd={() => setAddDialogOpen(true)}
              onManage={(providerId, isCustom) => setManageTarget({ providerId, isCustom })}
            />
          ) : (
            <ModelsHubTabPanel tab={tab.id} />
          )}
        </LazyPanelHost>
      ))}

      {/* Add provider dialog */}
      <AddProviderDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        builtinRows={providerData.builtinRows}
        customConfig={providerData.customConfig}
        labels={c.addProviderDialog}
        language={language}
        onSaved={handleSaved}
      />

      {/* Manage provider dialog */}
      {manageTarget ? (
        <ProviderManageDialog
          open
          onOpenChange={(open) => { if (!open) setManageTarget(null); }}
          providerId={manageTarget.providerId}
          isCustom={manageTarget.isCustom}
          builtinRows={providerData.builtinRows}
          customConfig={providerData.customConfig}
          allModels={providerData.allModels}
          labels={c.manageProviderDialog}
          language={language}
          onSaved={handleSaved}
        />
      ) : null}
    </SettingsPageFrame>
  );
}

function ModelsHubTabPanel({ tab }: { tab: ModelsHubTabId }) {
  switch (tab) {
    case 'services':
      return null; // Handled inline above
    case 'image-models':
      return <ImageModelsSettingsPanel />;
    case 'voice':
      return <VoiceSettingsPanel />;
    case 'search':
      return <WebSearchSettingsPanel />;
  }
}

function LazyPanelHost({
  id,
  activeTab,
  hint,
  children,
}: {
  id: ModelsHubTabId;
  activeTab: ModelsHubTabId;
  hint: string;
  children: React.ReactNode;
}) {
  const visible = id === activeTab;
  const mountedRef = useRef(visible);
  if (visible) mountedRef.current = true;
  if (!mountedRef.current) return null;

  return (
    <div
      role="tabpanel"
      id={`hub-panel-${id}`}
      aria-labelledby={`hub-tab-${id}`}
      hidden={!visible}
      className={cn(
        'min-w-0 rounded-2xl border border-edge bg-surface-base px-4 py-5 sm:px-5',
        visible ? 'flex flex-col gap-3' : undefined,
      )}
    >
      {visible ? <p className="text-sm leading-relaxed text-fg-muted">{hint}</p> : null}
      {children}
    </div>
  );
}
