import { Library } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import type { SkillCatalogRow } from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { pathForTab } from '@/navigation';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { agentDefaultsQuickActionButtonClass } from '../defaults-field-styles';
import { useSkillsCatalogLoad } from '../hooks/use-agents-skills-catalog';

function rowId(s: SkillCatalogRow): string {
  return (s.name || s.directoryId).trim();
}

function allowlistFromSelection(selected: Set<string>, catalogIds: string[]): string[] {
  const out: string[] = [];
  for (const id of catalogIds) {
    if (selected.has(id)) out.push(id);
  }
  const extra = [...selected].filter((id) => !catalogIds.includes(id)).sort();
  return [...out, ...extra];
}

export function AgentDefaultsSkillsAllowlistPanel(props: AgentDefaultsPanelProps) {
  const { a, form, update } = props;
  const x = a.advanced;
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const agentsTab = m.agentsSettings;
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);
  const { catalogForPick, skillsCatalogLoading } = useSkillsCatalogLoad(true, hasToken);

  const catalogIds = useMemo(() => catalogForPick.map(rowId), [catalogForPick]);

  const restrictMode = form.skillsAllowlist.length > 0;

  const allowSet = useMemo(
    () => new Set(form.skillsAllowlist.map((s) => s.trim()).filter(Boolean)),
    [form.skillsAllowlist],
  );

  const unknownAllowlistIds = useMemo(
    () => form.skillsAllowlist.filter((id) => id.trim() && !catalogIds.includes(id.trim())),
    [form.skillsAllowlist, catalogIds],
  );

  const syntheticUnknownRows: SkillCatalogRow[] = useMemo(
    () => unknownAllowlistIds.map((id) => ({ name: id.trim(), directoryId: id.trim() })),
    [unknownAllowlistIds],
  );

  const rowsToRender = useMemo(
    () => [...syntheticUnknownRows, ...catalogForPick],
    [syntheticUnknownRows, catalogForPick],
  );

  const setAllSkills = useCallback(() => {
    update({ skillsAllowlist: [] });
  }, [update]);

  const setRestrictWithAllCatalogSelected = useCallback(() => {
    update({ skillsAllowlist: [...catalogIds] });
  }, [update, catalogIds]);

  const toggleId = useCallback(
    (id: string, checked: boolean) => {
      const selected = new Set(form.skillsAllowlist.map((s) => s.trim()).filter(Boolean));
      if (checked) {
        selected.add(id);
      } else {
        selected.delete(id);
      }
      if (selected.size === 0) {
        update({ skillsAllowlist: [] });
        return;
      }
      update({ skillsAllowlist: allowlistFromSelection(selected, catalogIds) });
    },
    [form.skillsAllowlist, catalogIds, update],
  );

  return (
    <div className="flex flex-col gap-5">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Library} title={x.cardSkillsTitle} subtitle={x.cardSkillsSubtitle} />
        <AgentDefaultsField label={x.skillsAllowlist} description={x.skillsAllowlistDesc}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className={agentDefaultsQuickActionButtonClass}
                  onClick={setAllSkills}
                >
                  {x.skillsAllowlistModeAll}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className={agentDefaultsQuickActionButtonClass}
                  disabled={!restrictMode && catalogIds.length === 0}
                  onClick={() => {
                    if (restrictMode) {
                      return;
                    }
                    setRestrictWithAllCatalogSelected();
                  }}
                >
                  {x.skillsAllowlistModeRestrict}
                </Button>
              </div>
              <Link
                to={pathForTab('skills')}
                className="shrink-0 text-xs font-medium text-accent-fg hover:underline"
              >
                {agentsTab.skillsLibraryLink}
              </Link>
            </div>

            {!hasToken ? (
              <p className="text-xs text-fg-muted">{a.needToken}</p>
            ) : skillsCatalogLoading ? (
              <p className="text-sm text-fg-muted">{agentsTab.skillsCatalogLoading}</p>
            ) : rowsToRender.length === 0 ? (
              <p className="text-sm text-fg-muted">{agentsTab.skillsEmptyCatalog}</p>
            ) : (
              <div
                className={cn(
                  'max-h-[min(50vh,22rem)] overflow-y-auto overscroll-contain pr-0.5',
                  !restrictMode && 'opacity-50',
                )}
              >
                <ul className="flex flex-col gap-2.5 text-sm">
                  {rowsToRender.filter((s) => rowId(s)).map((s) => {
                    const id = rowId(s);
                    const on = restrictMode && allowSet.has(id);
                    const desc = typeof s.description === 'string' ? s.description.trim() : '';
                    const descLine = desc || agentsTab.skillsNoDescription;
                    const unknown = !catalogIds.includes(id);
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
                            disabled={!restrictMode}
                            onChange={() => toggleId(id, !on)}
                            aria-label={id}
                          />
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="truncate font-mono text-xs font-medium text-fg" title={id}>
                              {id}
                              {unknown ? (
                                <span className="ml-1.5 font-sans text-[10px] font-normal text-fg-muted">
                                  ({x.skillsAllowlistNotInCatalog})
                                </span>
                              ) : null}
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
          </div>
        </AgentDefaultsField>
      </SettingsFormSection>
    </div>
  );
}
