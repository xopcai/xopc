import {
  ChevronRight,
  ClipboardCheck,
  Code2,
  FileBarChart,
  FolderOpen,
  Globe,
  ListChecks,
  NotebookText,
  RefreshCw,
  SearchCheck,
  StickyNote,
  Target,
} from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { memo, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { BrandLogo } from '@/components/shell/brand-logo';
import { Skeleton } from '@/components/ui/skeleton';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import type {
  WelcomeSpotlightModel,
  WelcomeSuggestionSelection,
} from '@/features/chat/welcome/welcome-suggestions';
import {
  resolveWelcomeProjectEntryMode,
  type WorkDiscoveryOnboardingState,
} from '@/features/chat/welcome/welcome-project-entry';
import { fetchProjects, type Project } from '@/features/projects/api';
import { fetchWorkDiscoveryOnboarding } from '@/features/work-discovery/api';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const categoryIcons = {
  code: Code2,
  review: ClipboardCheck,
  note: NotebookText,
  task: ListChecks,
  target: Target,
  search: SearchCheck,
  folder: FolderOpen,
  content: StickyNote,
  documents: FileBarChart,
  globe: Globe,
} as const;

type CategoryIconKey = keyof typeof categoryIcons;

function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const Icon = categoryIcons[name as CategoryIconKey] ?? FolderOpen;
  return <Icon className={cn('size-[1.125rem] text-accent-fg sm:size-5', className)} strokeWidth={1.75} aria-hidden />;
}

export const ChatWelcomeSpotlight = memo(function ChatWelcomeSpotlight({
  spotlight,
  onPickPrompt,
  onRetryContext,
  onRefreshExploration,
  onSelectProject,
  compact = false,
}: {
  spotlight: WelcomeSpotlightModel;
  onPickPrompt: (selection: WelcomeSuggestionSelection) => void;
  onRetryContext?: () => void;
  onRefreshExploration?: () => void;
  onSelectProject?: (projectId: string) => Promise<void> | void;
  compact?: boolean;
}) {
  const s = spotlight;
  const [projects, setProjects] = useState<Project[]>([]);
  const [workDiscovery, setWorkDiscovery] = useState<WorkDiscoveryOnboardingState | null>(null);
  const [projectEntryLoaded, setProjectEntryLoaded] = useState(s.contextKind !== 'empty');
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [selectingProjectId, setSelectingProjectId] = useState<string | null>(null);
  const navigate = useNavigate();
  const token = useGatewayStore((state) => state.token);
  const language = useLocaleStore((state) => state.language);
  const workDiscoveryCopy = messages(language).onboarding.workDiscovery;

  useEffect(() => {
    if (!token || s.contextKind !== 'empty') {
      setProjectEntryLoaded(true);
      setProjects([]);
      setWorkDiscovery(null);
      return undefined;
    }
    let cancelled = false;
    setProjectEntryLoaded(false);
    void Promise.allSettled([
      fetchProjects({ status: 'active', sortBy: 'updatedAt', sortOrder: 'desc', limit: 5 }),
      fetchWorkDiscoveryOnboarding(),
    ]).then(([projectResult, discoveryResult]) => {
      if (cancelled) return;
      setProjects(projectResult.status === 'fulfilled' ? projectResult.value.items : []);
      setWorkDiscovery(discoveryResult.status === 'fulfilled' ? discoveryResult.value : null);
      setProjectEntryLoaded(true);
    });
    return () => { cancelled = true; };
  }, [s.contextKind, token]);

  const pick = (selection: Omit<WelcomeSuggestionSelection, 'contextKind'>) => {
    onPickPrompt({ ...selection, contextKind: s.contextKind });
  };
  const suggestions = s.categories
    .flatMap((category) => {
      const scenario = category.scenarios[0];
      return scenario ? [{ category, scenario }] : [];
    })
    .slice(0, 3);
  const projectEntryMode = resolveWelcomeProjectEntryMode({
    contextKind: s.contextKind,
    projectCount: projects.length,
    workDiscovery,
  });
  const selectProject = async (projectId: string) => {
    if (!onSelectProject || selectingProjectId) return;
    setSelectingProjectId(projectId);
    try {
      await onSelectProject(projectId);
      setProjectPickerOpen(false);
    } catch {
      showComposerNotification('error', workDiscoveryCopy.projectStartFailed);
    } finally {
      setSelectingProjectId(null);
    }
  };
  const projectEntryButtonClass = cn(
    'mt-1 inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-accent-fg hover:bg-accent-soft',
    interaction.transition,
    interaction.press,
    interaction.focusRingBase,
  );

  return (
    <div className={cn(
      'flex flex-col pb-2',
      compact
        ? 'gap-2 pt-1'
        : 'gap-3.5 pt-6 sm:gap-4 sm:pb-3 sm:pt-8 [@media(max-height:800px)]:pt-3 sm:[@media(max-height:800px)]:pt-4',
    )}>
      <div className={cn(
        'flex flex-col items-center gap-1.5 px-1 text-center sm:gap-2',
        compact
          ? 'pt-3 [@media(max-height:800px)]:pt-1'
          : 'pt-14 sm:pt-16 [@media(max-height:800px)]:pt-6 sm:[@media(max-height:800px)]:pt-7',
      )}>
        <BrandLogo className="size-11 shrink-0 sm:size-12" aria-hidden />
        {s.contextLabel ? (
          <div
            className="max-w-full truncate rounded-full border border-edge-subtle bg-surface-base px-2.5 py-1 text-xs text-fg-muted sm:max-w-md"
            title={s.contextLabel}
          >
            {s.contextLabel}
          </div>
        ) : null}
        <h1 className="text-balance text-lg font-semibold tracking-tight text-fg sm:text-xl">{s.headline}</h1>
        <p className="max-w-md text-pretty text-sm leading-snug text-fg-muted sm:text-[0.9375rem]">{s.tagline}</p>
        <div className="min-h-7 text-xs text-fg-muted" aria-live="polite" aria-atomic="true">
          {s.statusLabel ? (
            <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
              <span>{s.statusLabel}</span>
              {s.contextStatus === 'degraded' && onRetryContext ? (
                <button
                  type="button"
                  onClick={onRetryContext}
                  className={cn(
                    'inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 font-medium text-accent-fg hover:bg-accent-soft',
                    interaction.transition,
                    interaction.focusRingBase,
                  )}
                >
                  <RefreshCw className="size-3" strokeWidth={1.75} aria-hidden />
                  {s.retryLabel}
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
        {!projectEntryLoaded && s.contextKind === 'empty' ? (
          <Skeleton className="mt-1 h-9 w-36 rounded-lg" />
        ) : projectEntryMode === 'choose_project' && onSelectProject ? (
          <Popover.Root open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
            <Popover.Trigger asChild>
              <button type="button" className={projectEntryButtonClass}>
                <FolderOpen className="size-4" strokeWidth={1.75} aria-hidden />
                {workDiscoveryCopy.selectProject}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="center"
                side="bottom"
                sideOffset={6}
                collisionPadding={12}
                className="z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-edge bg-surface-panel p-1.5 text-left shadow-popover outline-none"
              >
                <p className="px-2.5 pb-1.5 pt-1 text-xs font-medium text-fg-muted">
                  {workDiscoveryCopy.recentProjects}
                </p>
                {projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    disabled={selectingProjectId !== null}
                    onClick={() => void selectProject(project.id)}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-hover disabled:cursor-wait disabled:opacity-60',
                      interaction.transition,
                      interaction.focusRingPanel,
                    )}
                  >
                    <FolderOpen className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{project.name}</span>
                      {project.description ? (
                        <span className="mt-0.5 block truncate text-xs text-fg-muted">{project.description}</span>
                      ) : null}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />
                  </button>
                ))}
                {workDiscovery?.enabled ? (
                  <button
                    type="button"
                    onClick={() => {
                      setProjectPickerOpen(false);
                      navigate('/onboarding/workspace?new=1');
                    }}
                    className={cn(
                      'mt-1 flex min-h-10 w-full items-center gap-2.5 border-t border-edge-subtle px-2.5 pt-2 text-left text-sm font-medium text-fg-muted hover:text-fg',
                      interaction.transition,
                      interaction.focusRingPanel,
                    )}
                  >
                    <FolderOpen className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                    {workDiscoveryCopy.chooseAnotherFolder}
                  </button>
                ) : null}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ) : projectEntryMode === 'discover_folder' ? (
          <button
            type="button"
            onClick={() => navigate('/onboarding/workspace?new=1')}
            className={projectEntryButtonClass}
          >
            <FolderOpen className="size-4" strokeWidth={1.75} aria-hidden />
            {workDiscoveryCopy.chooseWorkFolder}
          </button>
        ) : projectEntryMode === 'resume_discovery' ? (
          <button
            type="button"
            onClick={() => navigate('/onboarding/workspace')}
            className={projectEntryButtonClass}
          >
            <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
            {workDiscoveryCopy.resumeAnalysis}
          </button>
        ) : null}
      </div>

      <section
        className={cn(
          compact
            ? 'mt-2'
            : 'mt-7 sm:mt-8 [@media(max-height:800px)]:mt-4 sm:[@media(max-height:800px)]:mt-5',
        )}
        aria-label={s.otherSuggestionsLabel}
      >
        <ul className="grid w-full grid-cols-1 divide-y divide-edge-subtle sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {suggestions.map(({ category, scenario }, index) => {
            const canRefreshCategory = category.scope === 'explore' && Boolean(onRefreshExploration);
            return (
              <li
                key={category.id}
                className="relative min-w-0 px-1 py-1 sm:px-2.5"
                data-welcome-suggestion-scope={category.scope}
              >
                <button
                  type="button"
                  title={scenario.prompt}
                  onClick={() => pick({
                    suggestionId: scenario.id ?? `${category.id}:${index}`,
                    categoryId: category.id,
                    prompt: scenario.prompt,
                  })}
                  className={cn(
                    'flex min-h-12 w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-surface-hover/70',
                    canRefreshCategory && 'pe-10',
                    interaction.transition,
                    interaction.press,
                    interaction.focusRingPanel,
                  )}
                >
                  <CategoryIcon name={category.icon} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-snug text-fg sm:text-[0.9375rem]">{category.title}</div>
                    <div className="mt-0.5 text-xs leading-snug text-fg-muted">{category.description}</div>
                  </div>
                </button>
                {canRefreshCategory ? (
                  <button
                    type="button"
                    aria-label={s.refreshExplorationLabel}
                    title={s.refreshExplorationLabel}
                    onClick={onRefreshExploration}
                    className={cn(
                      'absolute end-3 top-2.5 inline-flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg',
                      interaction.transition,
                      interaction.press,
                      interaction.focusRingPanel,
                    )}
                  >
                    <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
});

export const ChatWelcomeSpotlightSkeleton = memo(function ChatWelcomeSpotlightSkeleton({
  showSkeleton = true,
  compact = false,
}: {
  showSkeleton?: boolean;
  compact?: boolean;
}) {
  const skeletonClassName = showSkeleton ? '' : 'opacity-0';
  return (
    <div className={cn('flex flex-col gap-3.5 pb-2', compact ? 'pt-1' : 'pt-6 sm:gap-4 sm:pb-3 sm:pt-8')} aria-busy="true">
      <div className={cn('flex flex-col items-center gap-1.5 px-1 text-center sm:gap-2', compact ? 'pt-3' : 'pt-14 sm:pt-16')}>
        <BrandLogo className="size-11 shrink-0 opacity-80 sm:size-12" aria-hidden />
        <Skeleton className={cn('h-5 w-44 max-w-full', skeletonClassName)} />
        <Skeleton className={cn('h-4 w-[min(100%,24rem)]', skeletonClassName)} />
        <div className="flex min-h-7 items-center">
          <Skeleton className={cn('h-3 w-32', skeletonClassName)} />
        </div>
      </div>

      <section className={compact ? 'mt-2' : 'mt-7 sm:mt-8'} aria-hidden="true">
        <div className="grid w-full grid-cols-1 divide-y divide-edge-subtle sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="flex min-h-14 w-full items-start gap-2.5 px-3 py-2.5"
            >
              <Skeleton className={cn('mt-0.5 size-5 shrink-0 rounded-md', skeletonClassName)} />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className={cn('h-4 w-24', skeletonClassName)} />
                <Skeleton className={cn('h-3 w-32 max-w-full', skeletonClassName)} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
});
