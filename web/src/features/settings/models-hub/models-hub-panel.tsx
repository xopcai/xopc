/**
 * Models & credentials hub (M3.4 Shape C, tabbed layout).
 *
 * Five settings concerns share one route at `/settings/credentials`:
 *   • providers   — LLM credentials
 *   • models      — model registry
 *   • image-models— image understanding + generation
 *   • voice       — TTS / STT
 *   • search      — web-search providers
 *
 * Layout matches `/settings/agent-defaults`: a horizontal tab strip drives a
 * single visible panel below it. `?tab=<id>` deep-links the active tab so
 * existing `/settings/<x>` URLs (redirected here in `pages/settings-page.tsx`)
 * land users on the right pane.
 *
 * All panels stay mounted via the `hidden` attribute — switching tabs while
 * a panel has unsaved changes keeps its in-memory form state, and the
 * hub-level Save bar still aggregates dirty state across every section
 * regardless of which is currently visible.
 */

import { Bot, ExternalLink, ImageIcon, KeyRound, Mic, Search, type LucideIcon } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ImageModelsSettingsPanel } from '@/features/settings/image-models-settings';
import { ModelsSettingsPanel } from '@/features/settings/models-settings';
import { ProvidersSettingsPanel } from '@/features/settings/providers-settings';
import { SaveBarControls } from '@/features/settings/save-bar/save-bar-controls';
import { VoiceSettingsPanel } from '@/features/settings/voice-settings';
import { WebSearchSettingsPanel } from '@/features/settings/web-search-settings';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { docsGuidePageUrl } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

import {
  MODELS_HUB_TABS,
  parseModelsHubTab,
  type ModelsHubTabId,
} from './models-hub-tabs';

interface TabDef {
  id: ModelsHubTabId;
  icon: LucideIcon;
  /** Key in `messages.settingsSections` for the label. */
  labelKey: ModelsHubTabId | 'image-models';
  /** Key in `messages.modelsHub` for the section hint. */
  hintKey: 'providersHint' | 'modelsHint' | 'imageHint' | 'voiceHint' | 'searchHint';
}

const TAB_DEFS: readonly TabDef[] = [
  { id: 'providers', icon: KeyRound, labelKey: 'providers', hintKey: 'providersHint' },
  { id: 'models', icon: Bot, labelKey: 'models', hintKey: 'modelsHint' },
  { id: 'image-models', icon: ImageIcon, labelKey: 'image-models', hintKey: 'imageHint' },
  { id: 'voice', icon: Mic, labelKey: 'voice', hintKey: 'voiceHint' },
  { id: 'search', icon: Search, labelKey: 'search', hintKey: 'searchHint' },
];

export function ModelsHubPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sections = m.settingsSections;
  const c = m.modelsHub;

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseModelsHubTab(searchParams.get('tab'));

  const setActiveTab = useCallback(
    (tab: ModelsHubTabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'providers') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-fg">{sections.credentials}</h1>
          <p className="mt-1 text-sm text-fg-muted">{c.subtitle}</p>
          <a
            href={docsGuidePageUrl(language, 'configuration')}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {c.docsLink}
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </header>

      <SaveBarControls />

      <div
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
        role="tablist"
        aria-label={c.tabsAria}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const idx = MODELS_HUB_TABS.indexOf(activeTab);
          const delta = e.key === 'ArrowRight' ? 1 : -1;
          const len = MODELS_HUB_TABS.length;
          setActiveTab(MODELS_HUB_TABS[(idx + delta + len) % len]);
        }}
      >
        {TAB_DEFS.map(({ id, icon: Icon, labelKey }) => {
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
              <span>{sections[labelKey]}</span>
            </button>
          );
        })}
      </div>

      {/*
       * Lazy-mount: each panel is rendered on first activation and stays
       * mounted (hidden) thereafter. This avoids rendering all five panels
       * on first paint while preserving in-memory form state once a tab has
       * been visited. `useSaveBarRegistration` in each panel keeps the
       * global Save bar accurate even when the panel isn't on screen.
       */}
      <LazyPanelHost id="providers" activeTab={activeTab} hint={c.providersHint}>
        <ProvidersSettingsPanel embedded />
      </LazyPanelHost>
      <LazyPanelHost id="models" activeTab={activeTab} hint={c.modelsHint}>
        <ModelsSettingsPanel embedded />
      </LazyPanelHost>
      <LazyPanelHost id="image-models" activeTab={activeTab} hint={c.imageHint}>
        <ImageModelsSettingsPanel embedded />
      </LazyPanelHost>
      <LazyPanelHost id="voice" activeTab={activeTab} hint={c.voiceHint}>
        <VoiceSettingsPanel embedded />
      </LazyPanelHost>
      <LazyPanelHost id="search" activeTab={activeTab} hint={c.searchHint}>
        <WebSearchSettingsPanel embedded />
      </LazyPanelHost>
    </div>
  );
}

/**
 * Lazy-mounting panel host: defers first render until the tab is activated,
 * then keeps it mounted (hidden) so form state survives subsequent switches.
 */
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
