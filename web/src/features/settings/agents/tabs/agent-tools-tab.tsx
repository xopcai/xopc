import { Wrench } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

import { Button } from '@/components/ui/button';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages } from '@/i18n/messages';

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

  return (
    <SettingsFormSection className="flex min-h-0 flex-1 flex-col">
      <SettingsFormSectionHeader
        className="shrink-0"
        icon={Wrench}
        title={a.toolsTitle}
        subtitle={a.toolsHint}
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ul className="flex flex-col gap-2.5 pr-1" role="list">
          {(data.builtinToolIds.length ? data.builtinToolIds : []).map((tid) => {
            const disabledByDefault = selected.tools.defaultsDisable.includes(tid);
            const checked = disabledByDefault ? false : !toolEntryDisable.has(tid);
            const desc =
              tid in a.toolDescriptions ? a.toolDescriptions[tid as keyof typeof a.toolDescriptions] : '';
            return (
              <li
                key={tid}
                className={cn(
                  'rounded-xl border border-edge-subtle bg-surface-panel/60 px-3 py-2.5 dark:border-edge-subtle',
                  disabledByDefault && 'opacity-60',
                )}
              >
                <label
                  className={cn('flex cursor-pointer gap-3 text-sm', disabledByDefault && 'cursor-not-allowed')}
                >
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0 rounded border-edge"
                    checked={checked}
                    disabled={disabledByDefault || busy}
                    onChange={() => {
                      if (disabledByDefault) {
                        return;
                      }
                      setToolEntryDisable((prev) => {
                        const next = new Set(prev);
                        if (next.has(tid)) {
                          next.delete(tid);
                        } else {
                          next.add(tid);
                        }
                        return next;
                      });
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-mono text-xs font-medium text-fg">{tid}</span>
                      {disabledByDefault ? (
                        <span className="text-xs text-fg-muted">({a.toolsLockedByDefaults})</span>
                      ) : null}
                    </div>
                    {desc ? <p className="mt-1 text-xs leading-relaxed text-fg-muted">{desc}</p> : null}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
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
