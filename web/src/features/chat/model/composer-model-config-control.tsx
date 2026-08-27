import * as Popover from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';
import { useMemo } from 'react';
import useSWR from 'swr';

import { Select, SelectOption } from '@/components/ui/popover-select';
import {
  CONFIGURED_MODELS_SWR_KEY,
  fetchConfiguredModelsCached,
} from '@/features/chat/api/registry-api';
import type { ThinkingLevel } from '@/features/chat/composer/composer.types';
import { ModelSelector } from '@/features/chat/model/model-selector';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { APP_PORTALED_POPOVER_Z } from '@/lib/settings-shell-dialog-layer';

export function ComposerModelConfigControl({
  chat: m,
  sessionModel,
  modelDisabled,
  onModelChange,
  thinkingLevel,
  modelSupportsThinking,
  thinkingDisabled,
  onThinkingChange,
}: {
  chat: MessageBundle['chat'];
  sessionModel: string;
  modelDisabled: boolean;
  onModelChange: (modelId: string) => void;
  thinkingLevel: string;
  modelSupportsThinking: boolean;
  thinkingDisabled: boolean;
  onThinkingChange: (level: string) => void;
}) {
  const registry = useSWR(CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached, {
    revalidateOnFocus: false,
  });
  const selectedModel = useMemo(
    () => registry.data?.find((model) => model.id === sessionModel),
    [registry.data, sessionModel],
  );
  const modelLabel = selectedModel?.name || sessionModel.split('/').at(-1) || m.modelPlaceholder;
  const effortLabel = modelSupportsThinking
    ? m.thinkingLevels[thinkingLevel as ThinkingLevel] ?? thinkingLevel
    : m.thinkingUnsupported;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'group inline-flex h-8 min-w-0 max-w-[min(14rem,calc(100vw-10rem))] items-center gap-1.5 rounded-lg bg-surface-hover/70 px-2.5 text-[13px] text-fg',
            interaction.transition,
            interaction.press,
            interaction.focusRingPanel,
            'hover:bg-surface-hover dark:bg-surface-hover/50',
          )}
          title={`${modelLabel} · ${effortLabel}`}
          aria-label={`${m.modelConfigLabel}: ${modelLabel}; ${m.thinkingLevelLabel}: ${effortLabel}`}
        >
          <span className="min-w-0 truncate font-medium">{modelLabel}</span>
          <span className="shrink-0 text-fg-muted">{effortLabel}</span>
          <ChevronDown
            className="size-3.5 shrink-0 text-fg-subtle transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={cn(
            APP_PORTALED_POPOVER_Z,
            'xopc-composer-config-popover',
            'w-[min(15rem,calc(100vw-2rem))] rounded-xl border border-edge bg-surface-panel p-1.5 shadow-popover outline-none',
          )}
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="grid gap-0.5">
            <div className="grid min-h-10 grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 rounded-lg px-2.5 hover:bg-surface-hover">
              <span className="text-sm font-medium text-fg">{m.modelConfigLabel}</span>
              <ModelSelector
                value={sessionModel}
                disabled={modelDisabled}
                placeholder={m.modelPlaceholder}
                searchPlaceholder={m.modelSearchPlaceholder}
                noMatches={m.modelNoMatches}
                compact
                showProviderInTrigger={false}
                contentSide="right"
                contentAlign="start"
                className="w-full min-w-0 justify-end border-0 bg-transparent px-0 text-right text-fg-muted hover:bg-transparent dark:border-0 dark:hover:bg-transparent"
                popoverContentClassName="xopc-composer-config-popover min-w-[20rem]"
                showProviderSettingsFooter
                onChange={onModelChange}
              />
            </div>
            <div className="grid min-h-10 grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 rounded-lg px-2.5 hover:bg-surface-hover">
              <span className="text-sm font-medium text-fg">{m.thinkingLevelLabel}</span>
              {modelSupportsThinking ? (
                <div className="min-w-0">
                  <Select
                    className="w-full min-w-0"
                    triggerClassName="h-8 justify-end border-0 bg-transparent px-0 text-right text-fg-muted hover:border-0 hover:bg-transparent focus-visible:border-0"
                    contentClassName="xopc-composer-config-popover min-w-[14rem]"
                    side="right"
                    align="start"
                    value={thinkingLevel}
                    disabled={thinkingDisabled}
                    onChange={(event) => onThinkingChange(event.target.value)}
                  >
                    {(Object.keys(m.thinkingLevels) as ThinkingLevel[]).map((level) => (
                      <SelectOption key={level} value={level}>
                        {m.thinkingLevels[level]}
                      </SelectOption>
                    ))}
                  </Select>
                </div>
              ) : (
                <span className="min-w-0 truncate text-right text-xs text-fg-disabled">
                  {m.thinkingUnsupported}
                </span>
              )}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
