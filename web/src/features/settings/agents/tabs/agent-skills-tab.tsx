import { BookOpen } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { AutosaveStatus } from '@/components/ui/autosave-status';
import type { GatewayAgentRow, SkillCatalogRow } from '@/features/settings/agents-admin-api';
import { SettingsListSkeleton } from '@/features/settings/settings-loading-skeleton';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages } from '@/i18n/messages';
import { pathForTab } from '@/navigation';
import { useAutosave } from '@/lib/use-autosave';

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
  onSaveSkills: (snapshot: { inherit: boolean; skills: string[] }) => Promise<void>;
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
  } = props;

  const skills = [...skillsPick].toSorted((x, y) => x.localeCompare(y));
  const savedSkills = [...(selected.skills.entry ?? [])].toSorted((x, y) => x.localeCompare(y));
  const dirty = skillsInherit !== (selected.skills.entry === undefined) ||
    (!skillsInherit && JSON.stringify(skills) !== JSON.stringify(savedSkills));
  const autosave = useAutosave({
    value: { inherit: skillsInherit, skills },
    dirty,
    onSave: onSaveSkills,
    delayMs: 350,
  });

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
        trailing={<AutosaveStatus status={autosave.status} error={autosave.error} />}
      />
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => {
            setSkillsInherit(true);
            autosave.saveNow({ inherit: true, skills });
          }}>
            {a.skillsInherit}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setSkillsInherit(false);
              const next = initialPickForCustomize();
              setSkillsPick(next);
              autosave.saveNow({
                inherit: false,
                skills: [...next].toSorted((x, y) => x.localeCompare(y)),
              });
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
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
          <SettingsListSkeleton rows={4} />
        </div>
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
                          autosave.saveNow({
                            inherit: false,
                            skills: [...next].toSorted((x, y) => x.localeCompare(y)),
                          });
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
    </SettingsFormSection>
  );
}
