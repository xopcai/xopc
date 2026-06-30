import { Wrench } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { Button } from '@/components/ui/button';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import type { BuiltinToolUiGroupKey } from '@/features/settings/agents/builtin-tool-disable-groups';
import { BuiltinToolsDisableUi } from '@/features/settings/agents/builtin-tools-disable-ui';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { messages, type AgentsSettingsMessages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function AgentToolsTab(props: {
  a: AgentsSettingsMessages;
  data: { builtinToolIds: string[] };
  selected: GatewayAgentRow;
  busy: boolean;
  toolEntryDisable: Set<string>;
  setToolEntryDisable: Dispatch<SetStateAction<Set<string>>>;
  onSaveTools: () => void;
  onClearToolsEntry: () => void;
  hideInlineSave?: boolean;
}) {
  const {
    a,
    data,
    selected,
    busy,
    toolEntryDisable,
    setToolEntryDisable,
    onSaveTools,
    onClearToolsEntry,
    hideInlineSave,
  } = props;

  const language = useLocaleStore((s) => s.language);
  const adv = messages(language).agentSettings.advanced;

  const presetDeniedSet = useMemo(
    () =>
      new Set(
        selected.tools.presetDenied.flatMap((s) => {
          const v = String(s).trim();
          return v ? [v] : [];
        }),
      ),
    [selected.tools.presetDenied],
  );

  const onDisableSetChange = useCallback(
    (next: Set<string>) => {
      setToolEntryDisable(next);
    },
    [setToolEntryDisable],
  );

  const groups = a.toolsDisableGroups;
  const getGroupTitle = useCallback((key: BuiltinToolUiGroupKey) => groups[key], [groups]);

  const getToolDescription = useCallback(
    (tid: string) =>
      tid in a.toolDescriptions ? a.toolDescriptions[tid as keyof typeof a.toolDescriptions] : '',
    [a.toolDescriptions],
  );

  return (
    <SettingsFormSection className="flex min-h-0 flex-1 flex-col">
      <SettingsFormSectionHeader
        className="shrink-0"
        icon={Wrench}
        title={a.toolsTitle}
        subtitle={a.toolsHint}
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <BuiltinToolsDisableUi
          mode="agentEntry"
          builtinToolIds={data.builtinToolIds}
          loading={false}
          disableSet={toolEntryDisable}
          onDisableSetChange={onDisableSetChange}
          defaultsDisableSet={presetDeniedSet}
          getToolDescription={getToolDescription}
          getGroupTitle={getGroupTitle}
          quickActionsDisabled={busy}
          labels={{
            loadingBuiltin: adv.toolsDisableLoadingBuiltin,
            emptyBuiltin: adv.toolsDisableEmptyBuiltin,
            quickActionsLabel: adv.toolsDisableQuickActionsLabel,
            quickEnableAll: adv.toolsDisableQuickEnableAll,
            quickDisableAll: adv.toolsDisableQuickDisableAll,
            quickReadOnlyWorkspace: adv.toolsDisableQuickReadOnlyWorkspace,
            quickHighRiskOff: adv.toolsDisableQuickHighRiskOff,
            quickNoOutbound: adv.toolsDisableQuickNoOutbound,
            notInBuiltin: adv.toolsDisableNotInBuiltin,
            lockedByDefaults: a.toolsLockedByPreset,
          }}
        />
      </div>
      <div className="mt-4 flex shrink-0 flex-wrap gap-2">
        {!hideInlineSave ? (
          <Button type="button" disabled={busy} onClick={() => void onSaveTools()}>
            {a.toolsSave}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void onClearToolsEntry()}>
          {a.toolsClearEntry}
        </Button>
      </div>
    </SettingsFormSection>
  );
}
