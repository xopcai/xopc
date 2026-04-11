import { ListTree, Trash2, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ModelSelector } from '@/features/chat/model-selector';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages, ChatMessages } from '@/i18n/messages';

import { agentsSettingsInputClass } from '../utils';

export function AgentOverviewTab(props: {
  a: AgentsSettingsMessages;
  chat: ChatMessages;
  selected: GatewayAgentRow | null;
  busy: boolean;
  editName: string;
  setEditName: (v: string) => void;
  editWorkspace: string;
  setEditWorkspace: (v: string) => void;
  editModel: string;
  setEditModel: (v: string) => void;
  onSetDefault: () => void;
  onSaveAgentEdits: () => void;
  onDelete: (purge: boolean) => void;
}) {
  const {
    a,
    chat,
    selected,
    busy,
    editName,
    setEditName,
    editWorkspace,
    setEditWorkspace,
    editModel,
    setEditModel,
    onSetDefault,
    onSaveAgentEdits,
    onDelete,
  } = props;

  return (
    <div className="flex flex-col gap-8">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Users} title={a.selectAgent} subtitle={a.selectAgentHint} />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!selected || selected.isDefault || busy}
            onClick={() => void onSetDefault()}
          >
            {a.setDefault}
          </Button>
        </div>
      </SettingsFormSection>

      {selected ? (
        <SettingsFormSection>
          <SettingsFormSectionHeader icon={ListTree} title={a.editAgent} subtitle={a.editAgentHint} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-fg-muted">{a.displayName}</span>
              <input className={agentsSettingsInputClass()} value={editName} onChange={(e) => setEditName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-fg-muted">{a.workspacePath}</span>
              <input
                className={cn(agentsSettingsInputClass(), 'font-mono text-xs')}
                value={editWorkspace}
                onChange={(e) => setEditWorkspace(e.target.value)}
              />
            </label>
            <div className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-fg-muted">{a.modelPrimary}</span>
              <div className="flex flex-wrap items-stretch gap-2">
                <ModelSelector
                  className="min-w-0 flex-1"
                  value={editModel}
                  disabled={busy}
                  placeholder={chat.modelPlaceholder}
                  searchPlaceholder={chat.modelSearchPlaceholder}
                  noMatches={chat.modelNoMatches}
                  onChange={(id) => setEditModel(id)}
                />
                {editModel.trim() ? (
                  <Button type="button" variant="secondary" className="shrink-0" disabled={busy} onClick={() => setEditModel('')}>
                    {a.modelClear}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void onSaveAgentEdits()}>
              {a.save}
            </Button>
            {selected.id !== 'main' ? (
              <>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void onDelete(false)}>
                  <Trash2 className="mr-1 size-4" aria-hidden />
                  {a.removeFromConfig}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40"
                  disabled={busy}
                  onClick={() => void onDelete(true)}
                >
                  {a.purgeDisk}
                </Button>
              </>
            ) : null}
          </div>
        </SettingsFormSection>
      ) : null}
    </div>
  );
}
