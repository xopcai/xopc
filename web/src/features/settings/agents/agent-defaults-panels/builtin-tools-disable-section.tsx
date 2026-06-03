import { Wrench } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { BuiltinToolsDisableUi } from '../builtin-tools-disable-ui';
import { sortedDisableList } from '../builtin-tools-disable-utils';
import type { BuiltinToolUiGroupKey } from '../builtin-tool-disable-groups';
import { useBuiltinToolIdsLoad } from '../hooks/use-builtin-tool-ids';

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
    () =>
      new Set(
        form.toolsDisable.flatMap((s) => {
          const v = s.trim();
          return v ? [v] : [];
        }),
      ),
    [form.toolsDisable],
  );

  const unknownDisabled = useMemo(() => {
    const builtinSet = new Set(builtinToolIds);
    return form.toolsDisable
      .flatMap((s) => {
        const v = s.trim();
        return v && !builtinSet.has(v) ? [v] : [];
      })
      .toSorted((x, y) => x.localeCompare(y));
  }, [form.toolsDisable, builtinToolIds]);

  const onDisableSetChange = useCallback(
    (next: Set<string>) => {
      update({ toolsDisable: sortedDisableList(next) });
    },
    [update],
  );

  const groups = agentsTab.toolsDisableGroups;
  const getGroupTitle = useCallback((key: BuiltinToolUiGroupKey) => groups[key], [groups]);

  const getToolDescription = useCallback(
    (tid: string) =>
      tid in agentsTab.toolDescriptions
        ? agentsTab.toolDescriptions[tid as keyof typeof agentsTab.toolDescriptions]
        : '',
    [agentsTab.toolDescriptions],
  );

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader icon={Wrench} title={x.cardToolsDisableTitle} subtitle={x.cardToolsDisableSubtitle} />
      <AgentDefaultsField label={x.toolsDisableFieldLabel} description={x.toolsDisableHint}>
        <div className="flex flex-col gap-3">
          {!hasToken ? (
            <p className="text-xs text-fg-muted">{a.needToken}</p>
          ) : (
            <BuiltinToolsDisableUi
              mode="defaults"
              builtinToolIds={builtinToolIds}
              loading={loading}
              disableSet={disableSet}
              onDisableSetChange={onDisableSetChange}
              unknownDisabledIds={unknownDisabled}
              getToolDescription={getToolDescription}
              getGroupTitle={getGroupTitle}
              quickActionsDisabled={loading}
              labels={{
                loadingBuiltin: x.toolsDisableLoadingBuiltin,
                emptyBuiltin: x.toolsDisableEmptyBuiltin,
                quickActionsLabel: x.toolsDisableQuickActionsLabel,
                quickEnableAll: x.toolsDisableQuickEnableAll,
                quickDisableAll: x.toolsDisableQuickDisableAll,
                quickReadOnlyWorkspace: x.toolsDisableQuickReadOnlyWorkspace,
                quickHighRiskOff: x.toolsDisableQuickHighRiskOff,
                quickNoOutbound: x.toolsDisableQuickNoOutbound,
                notInBuiltin: x.toolsDisableNotInBuiltin,
                lockedByDefaults: agentsTab.toolsLockedByDefaults,
              }}
            />
          )}
        </div>
      </AgentDefaultsField>
    </SettingsFormSection>
  );
}
