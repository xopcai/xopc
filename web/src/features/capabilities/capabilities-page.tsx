import { ServiceGoalGuide } from './service-goal-guide';
import { pluginDetailPath } from './capability-links';
import { CapabilitySectionIntro } from './capability-section-intro';
import { lazy, Suspense, useCallback, useLayoutEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import {
  CapabilityHeaderActions,
  type CapabilityHeaderActionChange,
  type CapabilityHeaderContribution,
} from '@/features/capabilities/capability-header-actions';
import { messages } from '@/i18n/messages';
import {
  CAPABILITY_SECTIONS,
  capabilityPath,
  type CapabilitySection,
} from '@/navigation/product-navigation';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

const SkillsPage = lazy(() => import('@/features/skills/skills-page').then(module => ({ default: module.SkillsPage })));
const ConnectorsPage = lazy(() => import('@/features/connectors/connectors-page').then(module => ({ default: module.ConnectorsPage })));
const PluginDetailsDialog = lazy(() => import('@/features/extensions/plugin-details-dialog').then(module => ({ default: module.PluginDetailsDialog })));
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const pluginId = searchParams.get('plugin');
  const closePlugin = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('plugin');
    next.delete('connect');
    navigate({ search: next.toString() }, { replace: true, preventScrollReset: true });
  };
  const parsedSection = parseCapabilitySection(sectionParam);
  const section = parsedSection ?? CAPABILITY_SECTIONS[0];
  const sectionTitle = messageBundle.productNavigation.sections[`capabilities-${section}`];
  const setPageHeader = usePageHeaderStore(state => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore(state => state.clearPageHeader);
  const [headerContribution, setHeaderContribution] = useState<{ section: CapabilitySection; value: CapabilityHeaderContribution | null }>({ section, value: null });
  const currentContribution = section === 'extensions' && detailId ? null : headerContribution.section === section ? headerContribution.value : null;
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

  if (section === 'extensions' && detailId) return <Navigate replace to={pluginDetailPath(detailId, searchParams.get('from') === 'connections' ? 'connections' : searchParams.get('from') === 'skills' ? 'skills' : 'installed', searchParams.get('connect') === '1', searchParams.get('returnTo') ?? undefined)} />;
  if (!parsedSection) return <Navigate to={capabilityPath(CAPABILITY_SECTIONS[0])} replace />;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-panel">
      {!detailId ? <CapabilitySectionIntro section={section} zh={language.startsWith('zh')} /> : null}
      {['extensions', 'connectors', 'channels'].includes(section) ? <ServiceGoalGuide zh={language === 'zh'} /> : null}
      {/* Reset the boundary so route transitions show the new section's skeleton immediately. */}
      <Suspense key={section} fallback={<CapabilityContentFallback label={copy.discoverLoading} />}>
        {section === 'agents' ? <AgentsPage agentId={detailId} onHeaderActionChange={onHeaderActionChange} /> : null}
        {section === 'skills' ? <SkillsPage embedded onHeaderActionChange={onHeaderActionChange} /> : null}
        {section === 'connectors' ? <ConnectorsPage embedded onHeaderActionChange={onHeaderActionChange} /> : null}
        {section === 'channels' ? <ChannelsPage channelId={detailId} onHeaderActionChange={onHeaderActionChange} /> : null}
        {section === 'extensions' ? <ExtensionsPage embedded onHeaderActionChange={onHeaderActionChange} /> : null}
      </Suspense>
      {pluginId ? <Suspense fallback={null}><PluginDetailsDialog key={pluginId} pluginId={pluginId} initialConnect={searchParams.get('connect') === '1'} onClose={closePlugin} /></Suspense> : null}
    </div>
  );
}
