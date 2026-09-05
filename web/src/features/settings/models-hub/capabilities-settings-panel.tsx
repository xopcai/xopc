import { ImageIcon, Mic, Plug, Search, Users, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { PageTabs } from '@/components/ui/page-tabs';
import { ImageModelsSettingsPanel } from '@/features/settings/image-models-settings';
import {
  SettingsPageFrame,
  SettingsPageHeader,
} from '@/features/settings/settings-page-layout';
import { VoiceSettingsPanel } from '@/features/settings/voice-settings';
import { WebSearchSettingsPanel } from '@/features/settings/web-search-settings';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import {
  CAPABILITY_SETTINGS_SECTIONS,
  capabilitySettingsPath,
  docsGuidePageUrl,
  type CapabilitySettingsSectionId,
} from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

import { AddProviderDialog } from './add-provider-dialog';
import { ConnectedProvidersGrid, useConnectedProviders } from './connected-providers-grid';
import { revalidateModelsHubCaches } from './models-hub-cache';
import { ProviderManageDialog } from './provider-manage-dialog';
import { ModelCatalogStatus } from './model-catalog-status';
import { XopcCloudAccountCard } from './xopc-cloud-account-card';

interface SectionDefinition {
  id: CapabilitySettingsSectionId;
  icon: LucideIcon;
  label: string;
  hint: string;
  suffix?: ReactNode;
}

function isCapabilitySettingsSection(value: string | undefined): value is CapabilitySettingsSectionId {
  return CAPABILITY_SETTINGS_SECTIONS.includes(value as CapabilitySettingsSectionId);
}

export function CapabilitiesSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const c = m.capabilitiesSettings;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { capability } = useParams<{ capability: string }>();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [manageTarget, setManageTarget] = useState<{ providerId: string; isCustom: boolean } | null>(null);
  const providerData = useConnectedProviders();
  const xopcCloudConfigured = providerData.cards.some(
    (provider) => provider.id === 'xopc-cloud' && !provider.isCustom,
  );

  useEffect(() => {
    if (capability !== 'models' || searchParams.get('add') !== '1') return;
    setAddDialogOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('add');
    setSearchParams(next, { replace: true });
  }, [capability, searchParams, setSearchParams]);

  const sections: readonly SectionDefinition[] = [
    { id: 'models', icon: Plug, label: c.tabs.models, hint: c.modelsHint },
    {
      id: 'image',
      icon: ImageIcon,
      label: c.tabs.image,
      hint: c.imageHint,
    },
    {
      id: 'voice',
      icon: Mic,
      label: c.tabs.voice,
      hint: c.voiceHint,
    },
    {
      id: 'search',
      icon: Search,
      label: c.tabs.search,
      hint: c.searchHint,
    },
  ];

  const setActiveSection = useCallback(
    (section: CapabilitySettingsSectionId) => navigate(capabilitySettingsPath(section)),
    [navigate],
  );

  const handleSaved = useCallback(() => {
    void revalidateModelsHubCaches();
  }, []);

  if (!isCapabilitySettingsSection(capability)) {
    return <Navigate to={capabilitySettingsPath('models')} replace />;
  }

  return (
    <SettingsPageFrame>
      <SettingsPageHeader
        title={m.nav.settingsCapabilities}
        subtitle={c.subtitle}
        docsLink={docsGuidePageUrl(language, 'configuration')}
        docsLabel={c.docsLink}
        actions={(
          <Button asChild variant="secondary">
            <Link to="/agents">
              <Users className="size-4" aria-hidden />
              {c.agentSettingsLink}
            </Link>
          </Button>
        )}
      />


      <PageTabs
        items={sections}
        activeTab={capability}
        onChange={setActiveSection}
        ariaLabel={c.tabsAria}
        tabIdPrefix="capability-tab"
        panelIdPrefix="capability-panel"
      />

      {sections.map((section) => (
        <LazySectionHost key={section.id} id={section.id} activeSection={capability} hint={section.hint}>
          {section.id === 'models' ? (
            <>
              {xopcCloudConfigured ? <XopcCloudAccountCard labels={c.xopcCloudAccount} /> : null}
              <ModelCatalogStatus />
              <ConnectedProvidersGrid
                labels={c.connectedProviders}
                data={providerData}
                onAdd={() => setAddDialogOpen(true)}
                onManage={(providerId, isCustom) => setManageTarget({ providerId, isCustom })}
              />
            </>
          ) : (
            <CapabilitySectionPanel section={section.id} />
          )}
        </LazySectionHost>
      ))}

      <AddProviderDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        builtinRows={providerData.builtinRows}
        customConfig={providerData.customConfig}
        labels={c.addProviderDialog}
        language={language}
        onSaved={handleSaved}
      />

      {manageTarget ? (
        <ProviderManageDialog
          open
          onOpenChange={(open) => {
            if (!open) setManageTarget(null);
          }}
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

function CapabilitySectionPanel({ section }: { section: CapabilitySettingsSectionId }) {
  switch (section) {
    case 'models':
      return null;
    case 'image':
      return <ImageModelsSettingsPanel />;
    case 'voice':
      return <VoiceSettingsPanel />;
    case 'search':
      return <WebSearchSettingsPanel />;
  }
}

function LazySectionHost({
  id,
  activeSection,
  hint,
  children,
}: {
  id: CapabilitySettingsSectionId;
  activeSection: CapabilitySettingsSectionId;
  hint: string;
  children: React.ReactNode;
}) {
  const visible = id === activeSection;
  const mountedRef = useRef(visible);
  if (visible) mountedRef.current = true;
  if (!mountedRef.current) return null;

  return (
    <div
      role="tabpanel"
      id={`capability-panel-${id}`}
      aria-labelledby={`capability-tab-${id}`}
      hidden={!visible}
      className={cn(
        'min-w-0 rounded-2xl bg-surface-base px-4 py-5 sm:px-5',
        visible ? 'flex flex-col gap-3' : undefined,
      )}
    >
      {visible && id !== 'voice' ? <p className="text-sm leading-relaxed text-fg-muted">{hint}</p> : null}
      {id === 'voice' && !visible ? null : children}
    </div>
  );
}
