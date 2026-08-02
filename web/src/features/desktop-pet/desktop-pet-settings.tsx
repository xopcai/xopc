import {
  AlertCircle,
  ExternalLink,
  MessageSquarePlus,
  PencilLine,
  RefreshCw,
  RotateCcw,
  WandSparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { DesktopPetSprite } from '@/features/desktop-pet/desktop-pet-sprite';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';
import type {
  DesktopPetBehaviorMode,
  DesktopPetDefinition,
  DesktopPetIssue,
  DesktopPetState,
} from '@/types/electron';

function ToggleRow({
  title,
  desc,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-hover/50 px-3 py-2.5 dark:bg-surface-hover/35">
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">{title}</div>
        <p className="text-xs text-fg-muted">{desc}</p>
      </div>
      <input
        type="checkbox"
        className="ui-checkbox"
        disabled={disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}

type PetDisplayText = {
  name: string;
  description: string;
};

export function DesktopPetSettings() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).desktopPetSettings;
  const navigate = useNavigate();
  const [state, setState] = useState<DesktopPetState | null>(null);
  const [busy, setBusy] = useState(false);
  const [sizeDraft, setSizeDraft] = useState<number | null>(null);
  const api = typeof window !== 'undefined' ? window.electronAPI?.pet : undefined;

  const selectedPet = useMemo(
    () => state?.pets.find((pet) => pet.id === state.prefs.selectedPetId) ?? state?.pets[0],
    [state],
  );

  const load = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      setState(await api.getState());
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    void load();
    return api.onStateChanged(setState);
  }, [api, load]);

  if (!isElectron() || !api) return null;
  if (!state) {
    return (
      <SettingsPageFrame gap="gap-4">
        <SettingsPageHeader title={t.title} subtitle={t.subtitle} />
        <section className="rounded-xl border border-edge bg-surface-base p-4" aria-busy aria-label={t.loading}>
          <div className="space-y-3">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <div className="space-y-2 pt-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-16 rounded-xl" />
              ))}
            </div>
          </div>
        </section>
      </SettingsPageFrame>
    );
  }

  const patch = async (patchValue: Parameters<typeof api.setPrefs>[0]) => {
    setBusy(true);
    try {
      setState(await api.setPrefs(patchValue));
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = async (enabled: boolean) => {
    if (enabled) {
      await api.show();
      setState(await api.getState());
    } else {
      setState(await api.setPrefs({ enabled: false }));
    }
  };

  const choosePet = (id: string) => {
    void patch({ selectedPetId: id });
  };

  const petDisplayText = (pet: DesktopPetDefinition): PetDisplayText => {
    if (pet.builtin && pet.i18nKey) {
      const builtinText = t.builtinPets[pet.i18nKey as keyof typeof t.builtinPets];
      if (builtinText) return builtinText;
    }
    return { name: pet.name, description: pet.description };
  };

  const openPetChat = (draft: string) => {
    navigate({
      pathname: '/chat/new',
      search: `?draft=${encodeURIComponent(draft)}`,
    });
  };

  const sourcePromptForPet = (pet: DesktopPetDefinition): string => {
    if (pet.sourcePrompt?.trim()) return pet.sourcePrompt.trim();
    const { description } = petDisplayText(pet);
    return description.replace(/^Custom pet generated from:\s*/i, '').trim() || description;
  };

  const fillDraftTemplate = (template: string, values: Record<string, string>): string =>
    Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(value), template);

  const openCreatePetChat = () => {
    openPetChat(t.createChatDraft);
  };

  const openOptimizePetChat = (pet: DesktopPetDefinition) => {
    const draft = fillDraftTemplate(t.optimizeChatDraft, {
      id: pet.id,
      name: petDisplayText(pet).name,
      description: petDisplayText(pet).description,
      sourcePrompt: sourcePromptForPet(pet),
    });
    openPetChat(draft);
  };

  const openFixPetIssueChat = (issue: DesktopPetIssue) => {
    const draft = fillDraftTemplate(t.fixChatDraft, {
      dir: issue.dir,
      reason: issue.reason,
      details: issue.details?.join('; ') || t.noIssueDetails,
    });
    openPetChat(draft);
  };

  const displayedSize = sizeDraft ?? state.prefs.sizePercent;
  const daysTogether = Math.max(1, Math.floor((Date.now() - state.relationship.firstMetAt) / 86_400_000) + 1);

  const commitSize = async (value = displayedSize) => {
    const next = Math.min(140, Math.max(70, Math.round(value / 5) * 5));
    setSizeDraft(null);
    if (next !== state.prefs.sizePercent) {
      await patch({ sizePercent: next });
    }
  };

  return (
    <SettingsPageFrame gap="gap-4">
      <SettingsPageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-base px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover disabled:opacity-50',
                interaction.press,
              )}
              disabled={busy}
              onClick={() => void load()}
            >
              <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} strokeWidth={1.75} />
              {t.refresh}
            </button>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-base px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover',
                interaction.press,
              )}
              onClick={() => void api.openCustomPetsDir()}
            >
              <ExternalLink className="size-3.5" strokeWidth={1.75} />
              {t.openFolder}
            </button>
          </div>
        }
      />

      <section className="rounded-xl border border-edge bg-surface-base p-4 shadow-surface">
        <div className="space-y-2">
          <ToggleRow
            title={t.enable}
            desc={t.enableDesc}
            checked={state.prefs.enabled}
            disabled={busy}
            onChange={(checked) => void setEnabled(checked)}
          />
          <ToggleRow
            title={t.showOnStartup}
            desc={t.showOnStartupDesc}
            checked={state.prefs.showOnStartup}
            disabled={busy}
            onChange={(checked) => void patch({ showOnStartup: checked })}
          />
        </div>

        <div className="mt-5 rounded-xl border border-edge-subtle bg-surface-panel p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <WandSparkles className="mt-0.5 size-4 text-accent-fg" strokeWidth={1.8} />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-fg">{t.createTitle}</h3>
                <p className="text-xs text-fg-muted">{t.createDesc}</p>
              </div>
            </div>
            <button
              type="button"
              className={cn(
                'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-white hover:bg-accent/90',
                interaction.press,
              )}
              onClick={openCreatePetChat}
            >
              <MessageSquarePlus className="size-3.5" strokeWidth={1.75} />
              {t.createInChat}
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-edge-subtle bg-surface-panel p-3">
          <div>
            <h3 className="text-sm font-semibold text-fg">{t.bondTitle}</h3>
            <p className="text-xs text-fg-muted">{t.bondDesc}</p>
          </div>
          <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-fg">
            {t.bondSummary.replace('{days}', String(daysTogether)).replace('{tasks}', String(state.relationship.completedTaskCount))}
          </span>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">{t.petList}</h3>
              <p className="text-xs text-fg-muted">{t.petListDesc}</p>
            </div>
            {selectedPet ? (
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-fg">
                {petDisplayText(selectedPet).name}
              </span>
            ) : null}
          </div>
          <div className="divide-y divide-edge-subtle rounded-xl border border-edge bg-surface-base">
            {state.pets.map((pet) => {
              const selected = pet.id === state.prefs.selectedPetId;
              const displayText = petDisplayText(pet);
              return (
                <div key={pet.id} className="flex items-center gap-3 p-3">
                  <DesktopPetSprite pet={pet} action="idle" size="tiny" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-fg">{displayText.name}</p>
                      {!pet.builtin ? (
                        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                          {t.customBadge}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-fg-muted">{displayText.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!pet.builtin ? (
                      <button
                        type="button"
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-base px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover',
                          interaction.press,
                        )}
                        onClick={() => openOptimizePetChat(pet)}
                      >
                        <PencilLine className="size-3.5" strokeWidth={1.75} />
                        {t.optimizeInChat}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={cn(
                        'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                        selected
                          ? 'bg-surface-hover text-fg-muted'
                          : 'bg-surface-panel text-fg hover:bg-surface-hover',
                        interaction.press,
                      )}
                      disabled={selected || busy}
                      onClick={() => choosePet(pet.id)}
                    >
                      {selected ? t.selected : t.select}
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-fg">{t.customPets}</p>
                <p className="font-mono text-xs text-fg-muted">{state.customPetsDir}</p>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-fg"
                onClick={() => void api.openCustomPetsDir()}
              >
                {t.openFolder}
                <ExternalLink className="size-3.5" strokeWidth={1.75} />
              </button>
            </div>
          </div>
          {state.petIssues.length > 0 ? (
            <div className="mt-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-danger">
                <AlertCircle className="size-3.5" strokeWidth={1.8} />
                {t.invalidPets}
              </div>
              <div className="mt-2 space-y-2">
                {state.petIssues.map((issue) => (
                  <div
                    key={`${issue.dir}-${issue.reason}`}
                    className="flex flex-col gap-2 rounded-lg bg-surface-base/70 p-2 text-xs text-fg-muted sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px] text-fg">{issue.dir}</p>
                      <p>{issue.reason}</p>
                      {issue.details?.length ? (
                        <p className="line-clamp-2">{issue.details.join('; ')}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-danger/30 bg-surface-base px-2.5 text-xs font-medium text-danger hover:bg-danger/10',
                        interaction.press,
                      )}
                      onClick={() => openFixPetIssueChat(issue)}
                    >
                      <MessageSquarePlus className="size-3.5" strokeWidth={1.75} />
                      {t.fixInChat}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid gap-2">
          <div className="rounded-xl bg-surface-hover/50 p-3 dark:bg-surface-hover/35">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-fg">{t.size}</div>
                <p className="text-xs text-fg-muted">{t.sizeDesc}</p>
              </div>
              <span className="text-xs font-medium text-fg-muted">{displayedSize}%</span>
            </div>
            <input
              type="range"
              min={70}
              max={140}
              step={5}
              className="mt-3 w-full accent-accent"
              value={displayedSize}
              onChange={(e) => setSizeDraft(Number(e.target.value))}
              onBlur={() => void commitSize()}
              onKeyUp={(e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow')) {
                  void commitSize();
                }
              }}
              onPointerUp={() => void commitSize()}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow
              title={t.alwaysOnTop}
              desc={t.alwaysOnTopDesc}
              checked={state.prefs.alwaysOnTop}
              disabled={busy}
              onChange={(checked) => void patch({ alwaysOnTop: checked })}
            />
            <ToggleRow
              title={t.bubbles}
              desc={t.bubblesDesc}
              checked={state.prefs.bubbleEnabled}
              disabled={busy}
              onChange={(checked) => void patch({ bubbleEnabled: checked })}
            />
            <ToggleRow
              title={t.proactiveTips}
              desc={t.proactiveTipsDesc}
              checked={state.prefs.proactiveTipsEnabled}
              disabled={busy}
              onChange={(checked) => void patch({ proactiveTipsEnabled: checked })}
            />
            <ToggleRow
              title={t.interactions}
              desc={t.interactionsDesc}
              checked={state.prefs.interactionEnabled}
              disabled={busy}
              onChange={(checked) => void patch({ interactionEnabled: checked })}
            />
            <ToggleRow
              title={t.reducedMotion}
              desc={t.reducedMotionDesc}
              checked={state.prefs.reducedMotion}
              disabled={busy}
              onChange={(checked) => void patch({ reducedMotion: checked })}
            />
            <ToggleRow
              title={t.clickThrough}
              desc={t.clickThroughDesc}
              checked={state.prefs.clickThroughWhenIdle}
              disabled={busy}
              onChange={(checked) => void patch({ clickThroughWhenIdle: checked })}
            />
          </div>
          <div className="flex flex-col gap-2 rounded-xl bg-surface-hover/50 p-3 dark:bg-surface-hover/35 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-fg">{t.behaviorMode}</div>
              <p className="text-xs text-fg-muted">{t.behaviorModeDesc}</p>
            </div>
            <Select
              className="w-full sm:w-40"
              triggerClassName="h-9 bg-surface-panel"
              value={state.prefs.behaviorMode}
              onChange={(e) => void patch({ behaviorMode: e.target.value as DesktopPetBehaviorMode })}
            >
              <SelectOption value="focus">{t.behaviorFocus}</SelectOption>
              <SelectOption value="companion">{t.behaviorCompanion}</SelectOption>
              <SelectOption value="playful">{t.behaviorPlayful}</SelectOption>
            </Select>
          </div>
          <button
            type="button"
            className={cn(
              'inline-flex w-fit items-center gap-1.5 rounded-lg border border-edge bg-surface-base px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover disabled:opacity-50',
              interaction.press,
            )}
            disabled={busy}
            onClick={() => void api.resetPosition().then(setState)}
          >
            <RotateCcw className="size-3.5" strokeWidth={1.75} />
            {t.resetPosition}
          </button>
        </div>
      </section>
    </SettingsPageFrame>
  );
}
