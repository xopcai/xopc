import { BookOpen } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import type { GatewayAgentRow, SkillCatalogRow } from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages } from '@/i18n/messages';
import { pathForTab } from '@/navigation';

export function AgentSkillsTab(props: {
  a: AgentsSettingsMessages;
  selected: GatewayAgentRow;
  busy: boolean;
  skillsCatalogLoading: boolean;
  catalogForPick: SkillCatalogRow[];
  skillsInherit: boolean;
  setSkillsInherit: (v: boolean) => void;
  skillsPick: Set<string>;
  setSkillsPick: Dispatch<SetStateAction<Set<string>>>;
  onSaveSkills: () => void;
  hideInlineSave?: boolean;
}) {
  const {
    a,
    selected,
    busy,
    skillsCatalogLoading,
    catalogForPick,
    skillsInherit,
    setSkillsInherit,
    skillsPick,
    setSkillsPick,
    onSaveSkills,
    hideInlineSave,
  } = props;

  /** When inheriting preset policy, checkboxes reflect the effective visible-skill list. */
  function isCheckedInheritMode(id: string): boolean {
    const eff = selected.skills.effectiveAllowlist;
    if (eff === undefined) {
      return true;
    }
    if (eff.length === 0) {
      return false;
    }
    return eff.includes(id);
  }

  function initialPickForCustomize(): Set<string> {
    const eff = selected.skills.effectiveAllowlist;
    if (eff !== undefined) {
      return new Set(eff);
    }
    return new Set(catalogForPick.map((s) => s.name || s.directoryId));
  }

  return (
    <SettingsFormSection className="flex min-h-0 flex-1 flex-col">
      <SettingsFormSectionHeader
        className="shrink-0"
        icon={BookOpen}
        title={a.skillsTitle}
        subtitle={a.skillsHint}
      />
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setSkillsInherit(true)}>
            {a.skillsInherit}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setSkillsInherit(false);
              setSkillsPick(initialPickForCustomize());
            }}
          >
            {a.skillsCustomize}
          </Button>
        </div>
        <Link
          to={pathForTab('skills')}
          className="shrink-0 text-xs font-medium text-accent-fg hover:underline"
        >
          {a.skillsLibraryLink}
        </Link>
      </div>
      <p className="mt-2 shrink-0 text-xs text-fg-muted">
        {a.skillsPresetLabel} {selected.skills.preset.length ? selected.skills.preset.join(', ') : '—'}
      </p>
      <p className="shrink-0 text-xs text-fg-muted">
        {a.skillsEffectiveLabel}{' '}
        {selected.skills.effectiveAllowlist?.length
          ? selected.skills.effectiveAllowlist.join(', ')
          : skillsInherit
            ? a.skillsInherit
            : '—'}
      </p>
      {skillsCatalogLoading ? (
        <p className="shrink-0 text-sm text-fg-muted">{a.skillsCatalogLoading}</p>
      ) : catalogForPick.length === 0 ? (
        <p className="shrink-0 text-sm text-fg-muted">{a.skillsEmptyCatalog}</p>
      ) : (
        <div
          className={cn(
            'mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5',
            skillsInherit && 'opacity-50',
          )}
        >
          <ul className="flex flex-col gap-2.5 text-sm">
            {catalogForPick.map((s) => {
              const id = s.name || s.directoryId;
              const on = skillsInherit ? isCheckedInheritMode(id) : skillsPick.has(id);
              const desc = typeof s.description === 'string' ? s.description.trim() : '';
              const descLine = desc || a.skillsNoDescription;
              return (
                <li
                  key={id}
                  className="h-16 shrink-0 overflow-hidden rounded-xl bg-surface-panel/70 px-3 shadow-surface"
                >
                  <label className="flex h-full cursor-pointer items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="shrink-0 rounded border-edge"
                      checked={on}
                      disabled={skillsInherit || busy}
                      onChange={() => {
                        setSkillsPick((prev) => {
                          const next = new Set(prev);
                          if (on) {
                            next.delete(id);
                          } else {
                            next.add(id);
                          }
                          return next;
                        });
                      }}
                      aria-label={id}
                    />
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="truncate font-mono text-xs font-medium text-fg" title={id}>
                        {id}
                      </div>
                      <p
                        className={cn(
                          'mt-0.5 truncate text-xs leading-tight text-fg-muted',
                          !desc && 'italic text-fg-subtle',
                        )}
                        title={descLine}
                      >
                        {descLine}
                      </p>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {!hideInlineSave ? (
        <div className="mt-4 shrink-0">
          <Button type="button" disabled={busy} onClick={() => void onSaveSkills()}>
            {a.skillsSave}
          </Button>
        </div>
      ) : null}
    </SettingsFormSection>
  );
}
