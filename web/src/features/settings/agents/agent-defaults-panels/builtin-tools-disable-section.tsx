import { Wrench } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { agentDefaultsQuickActionButtonClass } from '../defaults-field-styles';
import { useBuiltinToolIdsLoad } from '../hooks/use-builtin-tool-ids';

function sortedDisableList(ids: Set<string>): string[] {
  return [...ids].map((s) => s.trim()).filter(Boolean).sort((x, y) => x.localeCompare(y));
}

/** Preset ids are filtered against the live built-in list from the gateway. */
const TOOLS_DISABLE_PRESET_READ_ONLY_WORKSPACE = ['write_file', 'edit_file', 'shell'] as const;
const TOOLS_DISABLE_PRESET_HIGH_RISK = ['shell', 'image_generate', 'extensions'] as const;
const TOOLS_DISABLE_PRESET_NO_OUTBOUND = ['send_message', 'send_media'] as const;

export function AgentDefaultsBuiltinToolsDisableSection(props: AgentDefaultsPanelProps) {
  const { a, form, update } = props;
  const x = a.advanced;
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const agentsTab = m.agentsSettings;
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);
  const { builtinToolIds, loading } = useBuiltinToolIdsLoad(true, hasToken);

  const disableSet = useMemo(
    () => new Set(form.toolsDisable.map((s) => s.trim()).filter(Boolean)),
    [form.toolsDisable],
  );

  const unknownDisabled = useMemo(
    () =>
      form.toolsDisable
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((id) => !builtinToolIds.includes(id))
        .sort((x, y) => x.localeCompare(y)),
    [form.toolsDisable, builtinToolIds],
  );

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; unknown: boolean }[] = [];
    for (const id of unknownDisabled) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ id, unknown: true });
      }
    }
    for (const id of builtinToolIds) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ id, unknown: false });
      }
    }
    return out;
  }, [unknownDisabled, builtinToolIds]);

  const setToolEnabled = useCallback(
    (tid: string, enabled: boolean) => {
      const next = new Set(disableSet);
      if (enabled) {
        next.delete(tid);
      } else {
        next.add(tid);
      }
      update({ toolsDisable: sortedDisableList(next) });
    },
    [disableSet, update],
  );

  const allowedBuiltin = useMemo(() => new Set(builtinToolIds), [builtinToolIds]);

  const applyDisableExactly = useCallback(
    (ids: readonly string[]) => {
      const next = new Set<string>();
      for (const id of ids) {
        if (allowedBuiltin.has(id)) {
          next.add(id);
        }
      }
      update({ toolsDisable: sortedDisableList(next) });
    },
    [allowedBuiltin, update],
  );

  const enableAllTools = useCallback(() => {
    update({ toolsDisable: [] });
  }, [update]);

  const disableAllListed = useCallback(() => {
    const next = new Set<string>([...builtinToolIds, ...unknownDisabled]);
    update({ toolsDisable: sortedDisableList(next) });
  }, [builtinToolIds, unknownDisabled, update]);

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader icon={Wrench} title={x.cardToolsDisableTitle} subtitle={x.cardToolsDisableSubtitle} />
      <AgentDefaultsField label={x.toolsDisableFieldLabel} description={x.toolsDisableHint}>
        <div className="flex flex-col gap-3">
          {!hasToken ? (
            <p className="text-xs text-fg-muted">{a.needToken}</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-fg-muted">{x.toolsDisableQuickActionsLabel}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className={agentDefaultsQuickActionButtonClass}
                    onClick={enableAllTools}
                  >
                    {x.toolsDisableQuickEnableAll}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className={agentDefaultsQuickActionButtonClass}
                    disabled={loading || (builtinToolIds.length === 0 && unknownDisabled.length === 0)}
                    onClick={disableAllListed}
                  >
                    {x.toolsDisableQuickDisableAll}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className={agentDefaultsQuickActionButtonClass}
                    disabled={loading || builtinToolIds.length === 0}
                    onClick={() => applyDisableExactly(TOOLS_DISABLE_PRESET_READ_ONLY_WORKSPACE)}
                  >
                    {x.toolsDisableQuickReadOnlyWorkspace}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className={agentDefaultsQuickActionButtonClass}
                    disabled={loading || builtinToolIds.length === 0}
                    onClick={() => applyDisableExactly(TOOLS_DISABLE_PRESET_HIGH_RISK)}
                  >
                    {x.toolsDisableQuickHighRiskOff}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className={agentDefaultsQuickActionButtonClass}
                    disabled={loading || builtinToolIds.length === 0}
                    onClick={() => applyDisableExactly(TOOLS_DISABLE_PRESET_NO_OUTBOUND)}
                  >
                    {x.toolsDisableQuickNoOutbound}
                  </Button>
                </div>
              </div>
              {loading ? (
                <p className="text-sm text-fg-muted">{x.toolsDisableLoadingBuiltin}</p>
              ) : rows.length === 0 ? (
                <p className="text-sm text-fg-muted">{x.toolsDisableEmptyBuiltin}</p>
              ) : (
                <div className="max-h-[min(50vh,22rem)] overflow-y-auto overscroll-contain pr-0.5">
                  <ul className="flex flex-col gap-2.5 pr-1" role="list">
                    {rows.map(({ id: tid, unknown }) => {
                      const checked = !disableSet.has(tid);
                      const desc =
                        tid in agentsTab.toolDescriptions
                          ? agentsTab.toolDescriptions[tid as keyof typeof agentsTab.toolDescriptions]
                          : '';
                      return (
                        <li
                          key={tid}
                          className={cn(
                            'rounded-xl border border-edge-subtle bg-surface-panel/60 px-3 py-2.5 dark:border-edge-subtle',
                            unknown && 'border-dashed',
                          )}
                        >
                          <label className="flex cursor-pointer gap-3 text-sm">
                            <input
                              type="checkbox"
                              className="mt-1 shrink-0 rounded border-edge"
                              checked={checked}
                              onChange={() => setToolEnabled(tid, !checked)}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="font-mono text-xs font-medium text-fg">{tid}</span>
                                {unknown ? (
                                  <span className="text-xs text-fg-muted">({x.toolsDisableNotInBuiltin})</span>
                                ) : null}
                              </div>
                              {desc ? (
                                <p className="mt-1 text-xs leading-relaxed text-fg-muted">{desc}</p>
                              ) : null}
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </AgentDefaultsField>
    </SettingsFormSection>
  );
}
