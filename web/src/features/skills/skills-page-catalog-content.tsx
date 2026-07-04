import { Button } from '@/components/ui/button';
import { SkillCatalogCardSkeleton } from '@/features/skills/skills-page-primitives';
import { SKILL_LIST_SKELETON_KEYS } from '@/features/skills/skills-page.constants';
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
    mainTab,
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
                'group flex h-full flex-col rounded-xl border bg-surface-base p-4 transition-colors',
                enabled
                  ? 'border-edge-subtle hover:border-accent/40 hover:bg-surface-hover dark:border-edge-subtle'
                  : 'border-amber-300/70 bg-amber-50/30 hover:border-amber-400/80 hover:bg-amber-50/50 dark:border-amber-700/50 dark:bg-amber-950/20 dark:hover:border-amber-600/60',
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
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3
                        id={`catalog-skill-title-${row.directoryId}`}
                        className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug tracking-tight text-fg"
                      >
                        {row.name}
                      </h3>
                      <div
                        role="group"
                        className={cn(
                          'hidden shrink-0 items-center gap-1 transition-opacity sm:flex',
                          'sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100',
                        )}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
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
                        ) : null}
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-8 shrink-0 whitespace-nowrap px-2.5 text-xs font-medium"
                          disabled={
                            !enabled ||
                            usingSkillInChatName === row.name ||
                            togglingSkillName === row.name
                          }
                          title={!enabled ? sk.useRequiresEnabled : undefined}
                          onClick={() => void onUseSkillInChat({ name: row.name, source: 'catalog' })}
                        >
                          {usingSkillInChatName === row.name
                            ? sk.previewUseInChatBusy
                            : sk.previewUseInChat}
                        </Button>
                      </div>
                    </div>
                    <p
                      className="line-clamp-2 text-sm leading-relaxed text-fg-muted"
                      title={row.description ? row.description : undefined}
                    >
                      {row.description || '—'}
                    </p>
                    <div className="flex flex-wrap gap-1.5 text-[11px] text-fg-subtle">
                        {mainTab !== 'builtin' || row.managed ? (
                      <>
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
                      </>
                        ) : null}
                    </div>
                  </div>
                </div>
              </div>
              <div
                role="group"
                className="mt-3 flex items-center justify-end gap-1 border-t border-edge-subtle pt-3 sm:hidden"
              >
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
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 shrink-0 whitespace-nowrap px-2.5 text-xs font-medium"
                  disabled={
                    !enabled ||
                    usingSkillInChatName === row.name ||
                    togglingSkillName === row.name
                  }
                  title={!enabled ? sk.useRequiresEnabled : undefined}
                  onClick={() => void onUseSkillInChat({ name: row.name, source: 'catalog' })}
                >
                  {usingSkillInChatName === row.name ? sk.previewUseInChatBusy : sk.previewUseInChat}
                </Button>
              </div>
            </article>
            );
          })}
        </div>
      )}
    </>
  );
}
