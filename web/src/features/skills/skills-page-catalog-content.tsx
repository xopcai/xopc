import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreVertical, Trash2 } from 'lucide-react';

import { SkillCardIcon } from '@/features/skills/skill-card-icon';
import { SkillCatalogCardSkeleton, SkillEnableSwitch } from '@/features/skills/skills-page-primitives';
import { SKILL_LIST_SKELETON_COUNT } from '@/features/skills/skills-page.constants';
import type { SkillsPageVm } from '@/features/skills/use-skills-page';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

type Props = Pick<
  SkillsPageVm,
  | 'sk'
  | 'mainTab'
  | 'loading'
  | 'catalog'
  | 'filteredCatalog'
  | 'builtinCategories'
  | 'builtinCategoryFilter'
  | 'setBuiltinCategoryFilter'
  | 'categoryFilteredCatalog'
  | 'categoryLabel'
  | 'enabledOverride'
  | 'onSkillToggle'
  | 'sourceLabel'
  | 'openSkillDetail'
  | 'setConfirmOpen'
  | 'setConfirmId'
>;

export function SkillsPageCatalogContent(p: Props) {
  const {
    sk,
    mainTab,
    loading,
    catalog,
    filteredCatalog,
    builtinCategories,
    builtinCategoryFilter,
    setBuiltinCategoryFilter,
    categoryFilteredCatalog,
    categoryLabel,
    enabledOverride,
    onSkillToggle,
    sourceLabel,
    openSkillDetail,
    setConfirmOpen,
    setConfirmId,
  } = p;

  if (loading) {
    return (
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        aria-busy="true"
        aria-label={sk.loading}
      >
        {Array.from({ length: SKILL_LIST_SKELETON_COUNT }, (_, i) => (
          <SkillCatalogCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (catalog.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-edge py-16 text-center text-sm text-fg-muted">
        {sk.empty}
      </div>
    );
  }
  if (filteredCatalog.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-edge py-16 text-center text-sm text-fg-muted">
        {sk.noSearchResults}
      </div>
    );
  }

  return (
    <>
      {builtinCategories.length > 1 ? (
        <div
          role="tablist"
          aria-label={sk.marketplaceCategoriesAria}
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pt-0.5 [scrollbar-width:thin]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={builtinCategoryFilter === ''}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              interaction.focusRingPanel,
              builtinCategoryFilter === ''
                ? 'border-fg bg-fg text-surface-panel dark:border-fg dark:bg-fg dark:text-surface-base'
                : 'border-edge bg-surface-panel text-fg-muted hover:border-edge-strong hover:text-fg dark:border-edge dark:bg-surface-hover/40',
            )}
            onClick={() => setBuiltinCategoryFilter('')}
          >
            {sk.marketplaceCategoryAll}
          </button>
          {builtinCategories.map((cat) => {
            const selected = builtinCategoryFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={selected}
                className={cn(
                  'max-w-[14rem] shrink-0 truncate rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  interaction.focusRingPanel,
                  selected
                    ? 'border-fg bg-fg text-surface-panel dark:border-fg dark:bg-fg dark:text-surface-base'
                    : 'border-edge bg-surface-panel text-fg-muted hover:border-edge-strong hover:text-fg dark:border-edge dark:bg-surface-hover/40',
                )}
                title={categoryLabel(cat)}
                onClick={() => setBuiltinCategoryFilter(cat)}
              >
                {categoryLabel(cat)}
              </button>
            );
          })}
        </div>
      ) : null}
      {categoryFilteredCatalog.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-edge py-16 text-center text-sm text-fg-muted">
          {sk.noSearchResults}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categoryFilteredCatalog.map((row) => (
            <article
              key={`${row.directoryId}-${row.path}`}
              className={cn(
                'group flex h-full flex-col rounded-xl border border-edge-subtle bg-surface-base p-4',
                'transition-colors hover:border-accent/40 hover:bg-surface-hover',
                'dark:border-edge-subtle',
              )}
            >
              <div
                role="button"
                tabIndex={0}
                className={cn(
                  'flex min-h-0 flex-1 cursor-pointer flex-col rounded-lg text-left outline-none',
                  interaction.focusRingPanel,
                )}
                aria-labelledby={`catalog-skill-title-${row.directoryId}`}
                onClick={(e) => {
                  const el = e.target as HTMLElement;
                  if (el.closest('button')) return;
                  void openSkillDetail(row);
                }}
                onKeyDown={(e) => {
                  const el = e.target as HTMLElement;
                  if (el.closest('button')) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void openSkillDetail(row);
                  }
                }}
              >
                <div className="flex items-start gap-3">
                  <SkillCardIcon name={row.name} />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3
                        id={`catalog-skill-title-${row.directoryId}`}
                        className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug tracking-tight text-fg"
                      >
                        {row.name}
                      </h3>
                      <div
                        className="flex shrink-0 items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex shrink-0">
                          <SkillEnableSwitch
                            checked={enabledOverride[row.name] ?? row.enabled}
                            onChange={(next) => void onSkillToggle(row.name, next)}
                          />
                        </div>
                        {row.managed ? (
                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger asChild>
                              <button
                                type="button"
                                className={cn(
                                  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-panel text-fg-muted',
                                  'hover:bg-surface-hover hover:text-fg dark:border-edge',
                                  interaction.focusRingPanel,
                                )}
                                aria-label={sk.col.actions}
                              >
                                <MoreVertical className="size-3.5" strokeWidth={2} aria-hidden />
                              </button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                className="z-50 min-w-[8rem] rounded-xl border border-edge bg-surface-panel p-1 shadow-popover dark:border-edge"
                                sideOffset={4}
                                align="end"
                              >
                                <DropdownMenu.Item
                                  className={cn(
                                    'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 outline-none',
                                    'hover:bg-red-50 data-[highlighted]:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40',
                                  )}
                                  onSelect={() => {
                                    setConfirmId(row.directoryId);
                                    setConfirmOpen(true);
                                  }}
                                >
                                  <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                                  {sk.delete}
                                </DropdownMenu.Item>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                        ) : null}
                      </div>
                    </div>
                    <p
                      className="line-clamp-2 text-sm leading-relaxed text-fg-muted"
                      title={row.description ? row.description : undefined}
                    >
                      {row.description || '—'}
                    </p>
                    {mainTab !== 'builtin' || row.managed ? (
                      <div className="flex flex-wrap gap-1.5 text-[11px] text-fg-subtle">
                        {mainTab !== 'builtin' ? (
                          <span className="rounded-md bg-surface-hover/60 px-2 py-0.5 dark:bg-surface-active/50">
                            {sourceLabel(row.source)}
                          </span>
                        ) : null}
                        {row.managed ? (
                          <span className="rounded-md bg-surface-hover/60 px-2 py-0.5 dark:bg-surface-active/50">
                            {sk.col.managed}: {sk.yes}
                          </span>
                        ) : null}
                        {row.hub ? (
                          <span
                            className="max-w-full break-all rounded-md bg-surface-hover/60 px-2 py-0.5 font-mono text-[10px] leading-snug dark:bg-surface-active/50 line-clamp-2"
                            title={`${row.hub.source}${row.hub.ref ? `\nref: ${row.hub.ref}` : ''}\nupdated: ${row.hub.updatedAt}`}
                          >
                            {sk.hubRemote} ·{' '}
                            {row.hub.kind === 'git' ? sk.hubKindGit : sk.hubKindArchive} ·{' '}
                            {row.hub.source.length > 48
                              ? `${row.hub.source.slice(0, 48)}…`
                              : row.hub.source}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
