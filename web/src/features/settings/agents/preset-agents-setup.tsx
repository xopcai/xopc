import { useMemo, useState } from 'react';
import { SkipForward, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  createGatewayAgentsBatch,
} from '@/features/settings/agents-admin-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import { PRESET_AGENTS, PRESET_AGENTS_SKIPPED_KEY, type PresetAgent } from './preset-agents';

export interface PresetAgentsSetupProps {
  existingAgentIds: Set<string>;
  onComplete: () => void;
  onSkip: () => void;
}

export function PresetAgentsSetup({ existingAgentIds, onComplete, onSkip }: PresetAgentsSetupProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const a = m.agentsSettings;

  const availablePresets = useMemo(
    () => PRESET_AGENTS.filter((p) => !existingAgentIds.has(p.id)),
    [existingAgentIds],
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set(PRESET_AGENTS.map((p) => p.id)));
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleAgent = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCreate = async () => {
    const toCreate = availablePresets.filter((p) => selected.has(p.id));
    if (toCreate.length === 0) {
      onComplete();
      return;
    }

    setCreating(true);
    setError(null);
    setProgress({ current: 0, total: toCreate.length });

    try {
      await createGatewayAgentsBatch(
        toCreate.map((preset) => ({
          name: preset.name,
          id: preset.id,
          workspace: `~/.xopc/workspace/${preset.id}`,
          description: language === 'zh' ? preset.descriptionZh : preset.descriptionEn,
          profileFiles: {
            'IDENTITY.md': preset.identityMd,
            'SOUL.md': preset.soulMd,
          },
          ...(preset.toolsDisable && preset.toolsDisable.length > 0
            ? { toolsDisable: preset.toolsDisable }
            : {}),
        })),
      );
      setProgress({ current: toCreate.length, total: toCreate.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes('already exists')) {
        const failedPreset = toCreate[0];
        setError(
          a.presetCreateFailed
            .replace('{{name}}', failedPreset?.name ?? '')
            .replace('{{message}}', message),
        );
        setCreating(false);
        return;
      }
    }

    setCreating(false);
    onComplete();
  };

  const handleSkip = () => {
    localStorage.setItem(PRESET_AGENTS_SKIPPED_KEY, 'true');
    onSkip();
  };

  if (availablePresets.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-12">
      <div className="text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent">
          <Sparkles className="size-4" aria-hidden />
          {a.presetSetupBadge}
        </div>
        <h2 className="text-xl font-semibold text-fg">{a.presetSetupTitle}</h2>
        <p className="mt-2 text-sm text-fg-muted">{a.presetSetupSubtitle}</p>
      </div>

      <div className="w-full space-y-3">
        {availablePresets.map((preset) => (
          <PresetAgentCard
            key={preset.id}
            preset={preset}
            checked={selected.has(preset.id)}
            disabled={creating}
            language={language}
            onToggle={() => toggleAgent(preset.id)}
          />
        ))}
      </div>

      {error ? (
        <div
          role="alert"
          className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
        </div>
      ) : null}

      {progress && creating ? (
        <p className="text-sm text-fg-muted">
          {a.presetCreatingProgress
            .replace('{{current}}', String(progress.current))
            .replace('{{total}}', String(progress.total))}
        </p>
      ) : null}

      <div className="flex w-full items-center justify-between border-t border-edge-subtle pt-4">
        <Button
          type="button"
          variant="ghost"
          className="gap-2 text-fg-muted"
          disabled={creating}
          onClick={handleSkip}
        >
          <SkipForward className="size-4" aria-hidden />
          {a.presetSkip}
        </Button>
        <Button
          type="button"
          variant="primary"
          className="gap-2"
          disabled={creating || selected.size === 0}
          onClick={() => void handleCreate()}
        >
          <Sparkles className="size-4" aria-hidden />
          {creating
            ? a.presetCreating
            : a.presetCreateSelected.replace('{{count}}', String(selected.size))}
        </Button>
      </div>
    </div>
  );
}

function PresetAgentCard(props: {
  preset: PresetAgent;
  checked: boolean;
  disabled: boolean;
  language: 'en' | 'zh';
  onToggle: () => void;
}) {
  const { preset, checked, disabled, language, onToggle } = props;
  const description = language === 'zh' ? preset.descriptionZh : preset.descriptionEn;

  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors',
        checked ? 'border-accent/50 bg-accent/5' : 'border-edge-subtle bg-surface-panel/40',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="mt-1 shrink-0 accent-accent"
        aria-label={preset.name}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>
            {preset.emoji}
          </span>
          <span className="font-medium text-fg">{preset.name}</span>
        </div>
        <p className="mt-0.5 text-sm text-fg-muted">{description}</p>
      </div>
    </label>
  );
}
