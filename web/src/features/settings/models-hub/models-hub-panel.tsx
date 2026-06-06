import { ExternalLink, ImageIcon, Mic, Plug, Search, type LucideIcon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ImageModelsSettingsPanel } from '@/features/settings/image-models-settings';
import { VoiceSettingsPanel } from '@/features/settings/voice-settings';
import { WebSearchSettingsPanel } from '@/features/settings/web-search-settings';
import { SaveBarControls } from '@/features/settings/save-bar/save-bar-controls';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { docsGuidePageUrl } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

import { ConnectedProvidersGrid, useConnectedProviders } from './connected-providers-grid';
import { revalidateModelsHubCaches } from './models-hub-cache';
import { AddProviderDialog } from './add-provider-dialog';
import { ProviderManageDialog } from './provider-manage-dialog';

import {
  MODELS_HUB_TABS,
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
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-fg">{m.settingsSections.credentials}</h1>
          <p className="mt-1 text-sm text-fg-muted">{c.subtitle}</p>
          <a
            href={docsGuidePageUrl(language, 'configuration')}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {c.docsLink}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </header>

      <SaveBarControls />

      {/* Tab bar */}
      <div
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
        role="tablist"
        aria-label={c.tabsAria}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const index = MODELS_HUB_TABS.indexOf(activeTab);
          const delta = event.key === 'ArrowRight' ? 1 : -1;
          const nextIndex = (index + delta + MODELS_HUB_TABS.length) % MODELS_HUB_TABS.length;
          setActiveTab(MODELS_HUB_TABS[nextIndex]);
        }}
      >
        {tabDefs.map(({ id, icon: Icon, label }) => {
          const selected = id === activeTab;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              id={`hub-tab-${id}`}
              aria-controls={`hub-panel-${id}`}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                interaction.press,
                selected
                  ? 'bg-accent-soft text-accent-fg'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
              onClick={() => setActiveTab(id)}
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

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
    </div>
  );
}

function ModelsHubTabPanel({ tab }: { tab: ModelsHubTabId }) {
  switch (tab) {
    case 'services':
      return null; // Handled inline above
    case 'image-models':
      return <ImageModelsSettingsPanel embedded />;
    case 'voice':
      return <VoiceSettingsPanel embedded />;
    case 'search':
      return <WebSearchSettingsPanel embedded />;
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
      className={cn(visible ? 'flex min-w-0 flex-col gap-3' : undefined)}
    >
      {visible ? <p className="text-sm leading-relaxed text-fg-muted">{hint}</p> : null}
      {children}
    </div>
  );
}
