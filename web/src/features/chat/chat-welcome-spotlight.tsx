import {
  ChevronRight,
  ClipboardCheck,
  Code2,
  FileBarChart,
  FolderOpen,
  Globe,
  ListChecks,
  MessageCircle,
  NotebookText,
  RefreshCw,
  SearchCheck,
  StickyNote,
  Target,
} from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { memo, useEffect, useId, useMemo, useState } from 'react';
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
}: {
  spotlight: WelcomeSpotlightModel;
  onPickPrompt: (selection: WelcomeSuggestionSelection) => void;
  onRetryContext?: () => void;
  onRefreshExploration?: () => void;
  onSelectProject?: (projectId: string) => Promise<void> | void;
}) {
  const s = spotlight;
  const panelId = useId();
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workDiscovery, setWorkDiscovery] = useState<WorkDiscoveryOnboardingState | null>(null);
  const [projectEntryLoaded, setProjectEntryLoaded] = useState(s.contextKind !== 'empty');
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [selectingProjectId, setSelectingProjectId] = useState<string | null>(null);
  const navigate = useNavigate();
  const language = useLocaleStore((state) => state.language);
  const workDiscoveryCopy = messages(language).onboarding.workDiscovery;

  useEffect(() => {
    if (s.contextKind !== 'empty') {
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
  }, [s.contextKind]);

  const selectedCategory = useMemo(
    () => (selectedCategoryIndex == null ? undefined : s.categories[selectedCategoryIndex]),
    [s.categories, selectedCategoryIndex],
  );

  const pick = (selection: Omit<WelcomeSuggestionSelection, 'contextKind'>) => {
    onPickPrompt({ ...selection, contextKind: s.contextKind });
  };
  const canRefreshExploration = Boolean(onRefreshExploration);
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
    <div className="flex flex-col gap-3.5 pb-2 pt-6 sm:gap-4 sm:pb-3 sm:pt-8 [@media(max-height:800px)]:pt-3 sm:[@media(max-height:800px)]:pt-4">
      <div className="flex flex-col items-center gap-1.5 px-1 pt-14 text-center sm:gap-2 sm:pt-16 [@media(max-height:800px)]:pt-6 sm:[@media(max-height:800px)]:pt-7">
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

      <section className="mt-7 sm:mt-8 [@media(max-height:800px)]:mt-4 sm:[@media(max-height:800px)]:mt-5" aria-label={s.otherSuggestionsLabel}>
        <div className="mb-2 flex min-h-8 items-center justify-end gap-3">
          {canRefreshExploration ? (
            <button
              type="button"
              aria-label={s.refreshExplorationLabel}
              title={s.refreshExplorationLabel}
              onClick={onRefreshExploration}
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg',
                interaction.transition,
                interaction.press,
                interaction.focusRingPanel,
              )}
            >
              <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
              {s.refreshExplorationLabel}
            </button>
          ) : null}
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-2.5">
          {s.categories.map((category, index) => {
            const expanded = selectedCategoryIndex === index;
            return (
              <div key={category.id} className="relative min-w-0">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={expanded ? panelId : undefined}
                  onClick={() => setSelectedCategoryIndex((previous) => (previous === index ? null : index))}
                  className={cn(
                    'flex min-h-14 h-full w-full flex-row items-start gap-2.5 rounded-xl border bg-surface-panel p-2.5 text-left shadow-surface sm:flex-col sm:gap-2',
                    interaction.transition,
                    interaction.press,
                    interaction.focusRingPanel,
                    expanded
                      ? 'border-accent ring-1 ring-accent/25'
                      : 'border-edge hover:border-edge-strong hover:bg-surface-hover/40 dark:hover:bg-surface-hover/30',
                  )}
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft sm:size-10">
                    <CategoryIcon name={category.icon} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-snug text-fg sm:text-[0.9375rem]">{category.title}</div>
                    <div className="mt-0.5 text-xs leading-snug text-fg-muted sm:text-sm">{category.description}</div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {selectedCategory && selectedCategory.scenarios.length > 0 ? (
        <div
          id={panelId}
          role="region"
          aria-label={selectedCategory.title}
          className="flex flex-col gap-1.5 rounded-xl border border-edge bg-surface-base/80 p-2.5 dark:bg-surface-hover/20"
        >
          <ul className="flex flex-col gap-1">
            {selectedCategory.scenarios.slice(0, 3).map((scenario, index) => (
              <li key={scenario.id ?? scenario.prompt}>
                <button
                  type="button"
                  onClick={() =>
                    pick({
                      suggestionId: scenario.id ?? `${selectedCategory.id}:${index}`,
                      categoryId: selectedCategory.id,
                      prompt: scenario.prompt,
                    })
                  }
                  className={cn(
                    'flex min-h-11 w-full items-start gap-2 rounded-lg border border-transparent p-2.5 text-left text-sm leading-snug text-fg',
                    interaction.transition,
                    interaction.press,
                    interaction.focusRingPanel,
                    'hover:border-edge hover:bg-surface-panel dark:hover:bg-surface-panel/40',
                  )}
                >
                  <MessageCircle className="mt-0.5 size-4 shrink-0 text-accent-fg" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 flex-1 text-pretty">{scenario.prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
});

export const ChatWelcomeSpotlightSkeleton = memo(function ChatWelcomeSpotlightSkeleton({
  showSkeleton = true,
}: {
  showSkeleton?: boolean;
}) {
  const skeletonClassName = showSkeleton ? '' : 'opacity-0';
  return (
    <div className="flex flex-col gap-3.5 pb-2 pt-6 sm:gap-4 sm:pb-3 sm:pt-8" aria-busy="true">
      <div className="flex flex-col items-center gap-1.5 px-1 pt-14 text-center sm:gap-2 sm:pt-16">
        <BrandLogo className="size-11 shrink-0 opacity-80 sm:size-12" aria-hidden />
        <Skeleton className={cn('h-5 w-44 max-w-full', skeletonClassName)} />
        <Skeleton className={cn('h-4 w-[min(100%,24rem)]', skeletonClassName)} />
        <div className="flex min-h-7 items-center">
          <Skeleton className={cn('h-3 w-32', skeletonClassName)} />
        </div>
      </div>

      <section className="mt-7 sm:mt-8" aria-hidden="true">
        <div className="mb-2 flex min-h-8 items-center justify-end gap-3">
          <Skeleton className={cn('h-7 w-24 rounded-lg', skeletonClassName)} />
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-2.5">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="flex min-h-14 w-full flex-row items-start gap-2.5 rounded-xl border border-edge bg-surface-panel p-2.5 sm:flex-col sm:gap-2"
            >
              <Skeleton className={cn('size-9 shrink-0 rounded-lg sm:size-10', skeletonClassName)} />
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
