import { Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import type { DreamingConfigState } from '@/features/settings/dreaming-config-api';
import { type DreamingSettingsI18n } from '@/features/settings/dreaming-settings-shared';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { SettingsPageHeader } from '@/features/settings/settings-page-layout';

type Props = {
  t: DreamingSettingsI18n;
  hasToken: boolean;
  agents: GatewayAgentRow[];
  selectedAgentId: string;
  onAgentChange: (agentId: string) => void;
  cfgForm: DreamingConfigState | null;
  cfgSaving: boolean;
  enableAllBusy: boolean;
  cfgDirty: boolean;
  saveConfig: () => void | Promise<void>;
  enableAllAgentsDreaming: () => void | Promise<void>;
  doRefresh: () => void | Promise<void>;
};

export function DreamingHeader({
  t,
  hasToken,
  agents,
  selectedAgentId,
  onAgentChange,
  cfgForm,
  cfgSaving,
  enableAllBusy,
  cfgDirty,
  saveConfig,
  enableAllAgentsDreaming,
  doRefresh,
}: Props) {
  return (
    <SettingsPageHeader
      title={t.title}
      subtitle={t.subtitle}
      actions={
        <>
        {agents.length > 0 ? (
          <Select
            className="h-9 max-w-44 rounded-md border border-edge bg-surface-panel px-2 text-sm text-fg outline-none transition focus:border-accent"
            value={selectedAgentId}
            disabled={!hasToken || cfgSaving}
            onChange={(event) => onAgentChange(event.currentTarget.value)}
            aria-label="Agent"
          >
            {agents.map((agent) => (
              <SelectOption key={agent.id} value={agent.id}>
                {agent.name || agent.id}
              </SelectOption>
            ))}
          </Select>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          disabled={!hasToken || cfgSaving || enableAllBusy || agents.length === 0}
          onClick={() => void enableAllAgentsDreaming()}
        >
          {enableAllBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {t.enableAllAgentsDreaming}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!hasToken || !cfgForm || cfgSaving || enableAllBusy || !cfgDirty}
          onClick={() => void saveConfig()}
        >
          {cfgSaving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {t.saveConfig}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="size-9 shrink-0 p-0"
          disabled={!hasToken}
          title={t.refresh}
          aria-label={t.refresh}
          onClick={() => void doRefresh()}
        >
          <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
        </Button>
        </>
      }
    />
  );
}
