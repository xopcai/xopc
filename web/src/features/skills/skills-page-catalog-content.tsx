import { pluginSkillUnavailable } from '@/features/skills/plugin-skill-owner';
import { SkillGridCard, skillCardActionClassName } from '@/features/skills/skill-grid-card';

import { FindSkillsButton } from '@/features/skills/find-skills-button';
import { Button } from '@/components/ui/button';
import { PageTabs } from '@/components/ui/page-tabs';
import { SkillCatalogCardSkeleton } from '@/features/skills/skills-page-primitives';
import { SKILL_LIST_SKELETON_KEYS } from '@/features/skills/skills-page.constants';
import type { SkillsPageVm } from '@/features/skills/use-skills-page';
import { cn } from '@/lib/cn';

type Props = Pick<
  SkillsPageVm,
  | 'sk'
  | 'onFindSkills'
  | 'findingSkills'
  | 'loading'
  | 'catalog'
  | 'filteredCatalog'
  | 'builtinCategories'
  | 'builtinCategoryFilter'
  | 'setBuiltinCategoryFilter'
  | 'catalogDisplayRows'
  | 'skillPresentation'
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
    skillPresentation,
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
      <div className="py-16 text-center text-sm text-fg-muted">
        <p className="mb-3">{sk.empty}</p>
        <FindSkillsButton sk={sk} findingSkills={p.findingSkills} onFindSkills={p.onFindSkills} secondary />
      </div>
    );
  }
  if (filteredCatalog.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-fg-muted">
        <p className="mb-3">{sk.noSearchResults}</p>
        <FindSkillsButton sk={sk} findingSkills={p.findingSkills} onFindSkills={p.onFindSkills} secondary />
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
          className="gap-2 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          buttonClassName="max-w-[14rem] truncate rounded-md px-3 py-1.5 text-xs"
          selectedClassName="bg-surface-active font-medium text-fg"
          unselectedClassName="text-fg-muted hover:bg-surface-hover hover:text-fg"
        />
      ) : null}
      {catalogDisplayRows.length === 0 ? (
        <div className="py-16 text-center text-sm text-fg-muted">
          {catalogStatusFilter === 'disabled' ? sk.noDisabledSkills : sk.noSearchResults}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {catalogDisplayRows.map((row) => {
            const enabled = resolveSkillEnabled(row);
            const unavailable = pluginSkillUnavailable(row);
            const presentation = skillPresentation(row);
            return (
              <SkillGridCard
                key={`${row.directoryId}-${row.path}`}
                name={presentation.displayName}
                description={presentation.description}
                category={row.category}
                metadata={row.plugin?.title ?? row.plugin?.name ?? sourceLabel(row)}
                onOpen={() => void openSkillDetail(row)}
                action={
                  !enabled && !unavailable ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className={skillCardActionClassName}
                      aria-label={`${sk.detailModalEnable} ${presentation.displayName}`}
                      disabled={togglingSkillName === row.name}
                      onClick={() => void onSkillToggle(row.name, true)}
                    >
                      {togglingSkillName === row.name ? sk.uploading : sk.detailModalEnable}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      className={cn(skillCardActionClassName, unavailable && 'text-amber-800 dark:text-amber-300')}
                      aria-label={`${unavailable ? (row.plugin?.authorizationStatus === 'required' ? sk.authorize : sk.managePlugin) : sk.previewUseInChat} ${presentation.displayName}`}
                      disabled={usingSkillInChatName === row.name || togglingSkillName === row.name}
                      onClick={() => void onUseSkillInChat({ name: row.name, source: 'catalog' })}
                    >
                      {unavailable
                        ? row.plugin?.authorizationStatus === 'required' ? sk.authorize : sk.managePlugin
                        : usingSkillInChatName === row.name ? sk.previewUseInChatBusy : sk.previewUseInChat}
                    </Button>
                  )
                }
              />
            );
          })}
        </div>
      )}
    </>
  );
}
