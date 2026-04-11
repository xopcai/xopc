import { BookOpen } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

import { Button } from '@/components/ui/button';
import type { GatewayAgentRow, SkillCatalogRow } from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages } from '@/i18n/messages';

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

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader icon={BookOpen} title={a.skillsTitle} subtitle={a.skillsHint} />
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
            setSkillsPick(
              new Set(
                selected.skills.effectiveAllowlist?.length
                  ? selected.skills.effectiveAllowlist
                  : selected.skills.defaults,
              ),
            );
          }}
        >
          {a.skillsCustomize}
        </Button>
      </div>
      <p className="mt-2 text-xs text-fg-muted">
        {a.skillsDefaultsLabel} {selected.skills.defaults.length ? selected.skills.defaults.join(', ') : '—'}
      </p>
      <p className="text-xs text-fg-muted">
        {a.skillsEffectiveLabel}{' '}
        {selected.skills.effectiveAllowlist?.length
          ? selected.skills.effectiveAllowlist.join(', ')
          : a.skillsAllFromCatalog}
      </p>
      {skillsCatalogLoading ? (
        <p className="text-sm text-fg-muted">{a.skillsCatalogLoading}</p>
      ) : catalogForPick.length === 0 ? (
        <p className="text-sm text-fg-muted">{a.skillsEmptyCatalog}</p>
      ) : (
        <div
          className={cn(
            'mt-3 h-[20rem] min-h-0 overflow-y-auto overscroll-contain pr-0.5',
            skillsInherit && 'opacity-50',
          )}
        >
          <ul className="flex flex-col gap-2.5 text-sm" role="list">
            {catalogForPick.map((s) => {
              const id = s.name || s.directoryId;
              const on = skillsPick.has(id);
              const desc = typeof s.description === 'string' ? s.description.trim() : '';
              const descLine = desc || a.skillsNoDescription;
              return (
                <li
                  key={id}
                  className="h-16 shrink-0 overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel/60 px-3 dark:border-edge-subtle"
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
      <div className="mt-4">
        <Button type="button" disabled={busy} onClick={() => void onSaveSkills()}>
          {a.skillsSave}
        </Button>
      </div>
    </SettingsFormSection>
  );
}
