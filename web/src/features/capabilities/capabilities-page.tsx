import { lazy, Suspense, useCallback, useLayoutEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import {
  CapabilityHeaderActions,
  type CapabilityHeaderActionChange,
  type CapabilityHeaderContribution,
} from '@/features/capabilities/capability-header-actions';
import { messages } from '@/i18n/messages';
import {
  CAPABILITY_SECTIONS,
  type CapabilitySection,
} from '@/navigation/product-navigation';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

const SkillsPage = lazy(() => import('@/features/skills/skills-page').then(module => ({ default: module.SkillsPage })));
const ConnectorsPage = lazy(() => import('@/features/connectors/connectors-page').then(module => ({ default: module.ConnectorsPage })));
const ExtensionsPage = lazy(() => import('@/pages/apps-page').then(module => ({ default: module.ExtensionsPage })));
const AgentsPage = lazy(() => import('@/features/settings/agents').then(module => ({ default: module.AgentsSettingsPanel })));
const ChannelsPage = lazy(() => import('@/features/settings/channels').then(module => ({ default: module.ChannelsSettingsPanel })));

function parseCapabilitySection(value: string | undefined): CapabilitySection | null {
  return CAPABILITY_SECTIONS.includes(value as CapabilitySection) ? value as CapabilitySection : null;
}

function CapabilityContentFallback({ label }: { label: string }) {
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 pb-7 pt-3 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 lg:px-8 lg:pb-9 lg:pt-4" aria-label={label} aria-busy>
      {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-40 rounded-xl" />)}
    </div>
  );
}

export function CapabilitiesPage() {
  const language = useLocaleStore(state => state.language);
  const messageBundle = messages(language);
  const copy = messageBundle.capabilitiesHub;
  const { section: sectionParam, detailId } = useParams<{ section?: string; detailId?: string }>();
  const parsedSection = parseCapabilitySection(sectionParam);
  const section = parsedSection ?? 'skills';
  const sectionTitle = messageBundle.productNavigation.sections[`capabilities-${section}`];
  const setPageHeader = usePageHeaderStore(state => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore(state => state.clearPageHeader);
  const [headerContribution, setHeaderContribution] = useState<{ section: CapabilitySection; value: CapabilityHeaderContribution | null }>({ section, value: null });
  const currentContribution = headerContribution.section === section ? headerContribution.value : null;
  const onHeaderActionChange = useCallback<CapabilityHeaderActionChange>((value) => {
    setHeaderContribution({ section, value });
  }, [section]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: <h1 className="truncate text-base font-semibold tracking-tight text-fg">{sectionTitle}</h1>,
      end: <CapabilityHeaderActions contribution={currentContribution} />,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, currentContribution, sectionTitle, setPageHeader]);

  if (!parsedSection) return <Navigate to="/capabilities/skills" replace />;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-panel">
      <Suspense fallback={<CapabilityContentFallback label={copy.discoverLoading} />}>
        {section === 'agents' ? <AgentsPage agentId={detailId} onHeaderActionChange={onHeaderActionChange} /> : null}
        {section === 'skills' ? <SkillsPage embedded onHeaderActionChange={onHeaderActionChange} /> : null}
        {section === 'connectors' ? <ConnectorsPage embedded onHeaderActionChange={onHeaderActionChange} /> : null}
        {section === 'channels' ? <ChannelsPage channelId={detailId} onHeaderActionChange={onHeaderActionChange} /> : null}
        {section === 'extensions' ? <ExtensionsPage embedded onHeaderActionChange={onHeaderActionChange} /> : null}
      </Suspense>
    </div>
  );
}
