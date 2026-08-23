import { CheckCircle2, CircleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageTabs } from '@/components/ui/page-tabs';
import { SkillCatalogCardSkeleton } from '@/features/skills/skills-page-primitives';
import { SKILL_LIST_SKELETON_KEYS } from '@/features/skills/skills-page.constants';
import type { SkillsPageVm } from '@/features/skills/use-skills-page';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

type Props = Pick<
  SkillsPageVm,
  | 'sk'
  | 'loading'
  | 'catalog'
  | 'filteredCatalog'
  | 'builtinCategories'
  | 'builtinCategoryFilter'
  | 'setBuiltinCategoryFilter'
  | 'catalogDisplayRows'
  | 'catalogStatusFilter'
  | 'resolveSkillEnabled'
  | 'categoryLabel'
  | 'sourceLabel'
  | 'openSkillDetail'
  | 'onSkillToggle'
  | 'onUseSkillInChat'
  | 'usingSkillInChatName'
  | 'togglingSkillName'
>;

export function SkillsPageCatalogContent(p: Props) {
  const {
    sk,
    loading,
    catalog,
    filteredCatalog,
    builtinCategories,
    builtinCategoryFilter,
    setBuiltinCategoryFilter,
    catalogDisplayRows,
    catalogStatusFilter,
    resolveSkillEnabled,
    categoryLabel,
    sourceLabel,
    openSkillDetail,
    onSkillToggle,
    onUseSkillInChat,
    usingSkillInChatName,
    togglingSkillName,
  } = p;

  if (loading) {
    return (
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        aria-busy="true"
        aria-label={sk.loading}
      >
        {SKILL_LIST_SKELETON_KEYS.map((k) => (
          <SkillCatalogCardSkeleton key={k} />
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
        <PageTabs
          items={[
            { id: '', label: sk.marketplaceCategoryAll },
            ...builtinCategories.map((cat) => ({ id: cat, label: categoryLabel(cat), title: categoryLabel(cat) })),
          ]}
          activeTab={builtinCategoryFilter}
          onChange={setBuiltinCategoryFilter}
          ariaLabel={sk.marketplaceCategoriesAria}
          tabIdPrefix="skills-builtin-category-tab"
          className="gap-2 pt-0.5 [scrollbar-width:thin]"
          buttonClassName="max-w-[14rem] truncate rounded-full border px-3 py-1.5 text-xs"
          selectedClassName="border-fg bg-fg text-surface-panel dark:border-fg dark:bg-fg dark:text-surface-base"
          unselectedClassName="border-edge bg-surface-panel text-fg-muted hover:border-edge-strong hover:text-fg dark:border-edge dark:bg-surface-hover/40"
        />
      ) : null}
      {catalogDisplayRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-edge py-16 text-center text-sm text-fg-muted">
          {catalogStatusFilter === 'disabled' ? sk.noDisabledSkills : sk.noSearchResults}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {catalogDisplayRows.map((row) => {
            const enabled = resolveSkillEnabled(row);
            return (
            <article
              key={`${row.directoryId}-${row.path}`}
              className={cn(
                'group flex h-full flex-col rounded-xl bg-surface-panel p-4 shadow-surface transition-colors',
                enabled
                  ? 'hover:bg-surface-hover'
                  : 'bg-amber-50/30 hover:bg-amber-50/50 dark:bg-amber-950/20',
              )}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  className={cn(
                    'min-w-0 flex-1 cursor-pointer rounded-lg text-left outline-none',
                    interaction.focusRingPanel,
                  )}
                  aria-labelledby={`catalog-skill-title-${row.directoryId}`}
                  onClick={() => void openSkillDetail(row)}
                >
                  <h3
                    id={`catalog-skill-title-${row.directoryId}`}
                    className="truncate text-[15px] font-semibold leading-8 tracking-tight text-fg"
                  >
                    {row.name}
                  </h3>
                </button>
                <span
                  className={cn(
                    'hidden shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium xl:inline-flex',
                    enabled
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
                  )}
                >
                  {enabled ? (
                    <CheckCircle2 className="size-3" aria-hidden />
                  ) : (
                    <CircleAlert className="size-3" aria-hidden />
                  )}
                  {enabled ? sk.statusEnabled : sk.statusDisabled}
                </span>
                {!enabled ? (
                  <Button
                    type="button"
                    variant="primary"
                    className="h-8 shrink-0 whitespace-nowrap px-2.5 text-xs font-medium"
                    disabled={togglingSkillName === row.name}
                    onClick={() => void onSkillToggle(row.name, true)}
                  >
                    {togglingSkillName === row.name ? sk.uploading : sk.detailModalEnable}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 shrink-0 whitespace-nowrap px-2.5 text-xs font-medium"
                    disabled={usingSkillInChatName === row.name || togglingSkillName === row.name}
                    onClick={() => void onUseSkillInChat({ name: row.name, source: 'catalog' })}
                  >
                    {usingSkillInChatName === row.name ? sk.previewUseInChatBusy : sk.previewUseInChat}
                  </Button>
                )}
              </div>
              <button
                type="button"
                className={cn(
                  'mt-2 flex min-h-0 w-full flex-1 cursor-pointer flex-col rounded-lg text-left outline-none',
                  interaction.focusRingPanel,
                )}
                aria-labelledby={`catalog-skill-title-${row.directoryId}`}
                onClick={() => void openSkillDetail(row)}
              >
                <div className="flex items-start gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <p
                      className="line-clamp-2 text-sm leading-relaxed text-fg-muted"
                      title={row.description ? row.description : undefined}
                    >
                      {row.description || '—'}
                    </p>
                    <div className="flex flex-wrap gap-1.5 text-[11px] text-fg-subtle">
                      <span className="rounded-md bg-surface-hover/60 px-2 py-0.5 dark:bg-surface-active/50">
                        {sourceLabel(row)}
                      </span>
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
                  </div>
                </div>
              </button>
            </article>
            );
          })}
        </div>
      )}
    </>
  );
}
