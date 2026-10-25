import { ResourceUnavailable } from '@/components/ui/resource-unavailable';
import {
  AlertCircle,
  ExternalLink,
  MessageSquarePlus,
  PencilLine,
  RotateCcw,
  WandSparkles,
  ChevronDown,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Select, SelectOption } from '@/components/ui/popover-select';
import { RefreshButton } from '@/components/ui/refresh-button';
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
  desc?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{title}</span>
        {desc ? <span className="block text-xs text-fg-muted">{desc}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        className="ui-checkbox"
        disabled={disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
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

  if (!isElectron() || !api) return <ResourceUnavailable kind="desktop" backTo="/settings/overview" />;
  if (!state) {
    return (
      <SettingsPageFrame gap="gap-4">
        <SettingsPageHeader title={t.title} subtitle={t.subtitle} />
        <section className="rounded-xl bg-surface-hover/20 p-4" aria-busy aria-label={t.loading}>
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
    <SettingsPageFrame gap="gap-5">
      <SettingsPageHeader title={t.title} subtitle={t.subtitle} actions={
        <RefreshButton className="size-9 shrink-0 p-0" disabled={busy} label={t.refresh} onClick={load} />
      } />

      <section className="overflow-hidden rounded-xl border border-edge bg-surface-panel">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="grid h-40 w-40 shrink-0 place-items-center self-center rounded-xl bg-surface-hover/35">
            {selectedPet ? <DesktopPetSprite pet={selectedPet} action="idle" displayHeight={Math.round(104 * displayedSize / 100)} reducedMotion={state.prefs.reducedMotion} /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <h2 className="break-words text-xl font-semibold text-fg">{selectedPet ? petDisplayText(selectedPet).name : t.title}</h2>
              <ToggleRow title={t.enable} checked={state.prefs.enabled} disabled={busy} onChange={(checked) => void setEnabled(checked)} />
            </div>
            <p className="text-xs text-fg-muted">{t.bondSummary.replace('{days}', String(daysTogether)).replace('{tasks}', String(state.relationship.completedTaskCount))}</p>
            {state.pets.length > 1 ? <div className="mt-4 max-w-56">
              <Select aria-label={t.petList} value={selectedPet?.id ?? ''} onChange={(e) => choosePet(e.target.value)} disabled={busy}>
                {state.pets.map((pet) => <SelectOption key={pet.id} value={pet.id}>{petDisplayText(pet).name}</SelectOption>)}
              </Select>
            </div> : null}
            {selectedPet && !selectedPet.builtin ? <button type="button" onClick={() => openOptimizePetChat(selectedPet)} className="mt-3 inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-fg">
              <PencilLine className="size-3.5" />{t.optimizeInChat}
            </button> : null}
          </div>
        </div>
        <div className="border-t border-edge px-5 py-2">
          <button type="button" onClick={openCreatePetChat} className={cn('inline-flex min-h-10 items-center gap-2 text-xs font-medium text-fg-muted hover:text-accent-fg', interaction.press)}>
            <WandSparkles className="size-4" />{t.createTitle}
          </button>
        </div>
      </section>

      {state.petIssues.length > 0 ? <section className="rounded-xl border border-danger/20 bg-danger/5 p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium text-danger"><AlertCircle className="size-4" />{t.invalidPets}</h3>
        <div className="mt-3 space-y-3">{state.petIssues.map((issue) => <div key={`${issue.dir}-${issue.reason}`} className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 text-xs text-fg-muted">
            <p className="break-words">{issue.reason}</p>
            <details className="mt-1"><summary className="cursor-pointer">{t.issueDetails}</summary>
              <p className="mt-2 break-all font-mono">{issue.dir}</p>
              {issue.details?.length ? <p className="mt-1 break-words">{issue.details.join('; ')}</p> : null}
            </details>
          </div>
          <button type="button" onClick={() => openFixPetIssueChat(issue)} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 text-xs font-medium text-danger"><MessageSquarePlus className="size-3.5" />{t.fixInChat}</button>
        </div>)}</div>
      </section> : null}

      <section aria-label={t.displayGroup}>
        <h3 className="mb-2 text-xs font-medium text-fg-muted">{t.displayGroup}</h3>
        <div className="divide-y divide-edge rounded-xl border border-edge bg-surface-panel px-4">
          <ToggleRow title={t.showOnStartup} checked={state.prefs.showOnStartup} disabled={busy} onChange={(checked) => void patch({ showOnStartup: checked })} />
          <ToggleRow title={t.alwaysOnTop} checked={state.prefs.alwaysOnTop} disabled={busy} onChange={(checked) => void patch({ alwaysOnTop: checked })} />
          <ToggleRow title={t.bubbles} checked={state.prefs.bubbleEnabled} disabled={busy} onChange={(checked) => void patch({ bubbleEnabled: checked })} />
          <div className="py-3">
            <label htmlFor="desktop-pet-size" className="flex items-center justify-between gap-3 text-sm font-medium text-fg">{t.size}<span className="text-xs tabular-nums text-fg-muted">{displayedSize}%</span></label>
            <input id="desktop-pet-size" type="range" min={70} max={140} step={5} className="mt-3 w-full accent-accent" value={displayedSize} disabled={busy}
              onChange={(e) => setSizeDraft(Number(e.target.value))} onBlur={() => void commitSize()}
              onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow')) void commitSize(); }}
              onPointerUp={() => void commitSize()} />
          </div>
        </div>
      </section>

      <section aria-label={t.interactionGroup}>
        <h3 className="mb-2 text-xs font-medium text-fg-muted">{t.interactionGroup}</h3>
        <div className="divide-y divide-edge rounded-xl border border-edge bg-surface-panel px-4">
          <ToggleRow title={t.proactiveTips} checked={state.prefs.proactiveTipsEnabled} disabled={busy} onChange={(checked) => void patch({ proactiveTipsEnabled: checked })} />
          <ToggleRow title={t.interactions} desc={t.interactionsDesc} checked={state.prefs.interactionEnabled} disabled={busy} onChange={(checked) => void patch({ interactionEnabled: checked })} />
          <ToggleRow title={t.reducedMotion} checked={state.prefs.reducedMotion} disabled={busy} onChange={(checked) => void patch({ reducedMotion: checked })} />
          <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 py-3">
            <span className="text-sm font-medium text-fg">{t.behaviorMode}</span>
            <Select aria-label={t.behaviorMode} className="w-36" triggerClassName="h-9 bg-surface-panel" value={state.prefs.behaviorMode} disabled={busy} onChange={(e) => void patch({ behaviorMode: e.target.value as DesktopPetBehaviorMode })}>
              <SelectOption value="focus">{t.behaviorFocus}</SelectOption><SelectOption value="companion">{t.behaviorCompanion}</SelectOption><SelectOption value="playful">{t.behaviorPlayful}</SelectOption>
            </Select>
          </div>
        </div>
      </section>

      <details className="group rounded-xl border border-edge bg-surface-panel">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">{t.advanced}<ChevronDown className="size-4 text-fg-muted transition-transform group-open:rotate-180" /></summary>
        <div className="space-y-3 border-t border-edge px-4 pb-4">
          <ToggleRow title={t.clickThrough} desc={t.clickThroughDesc} checked={state.prefs.clickThroughWhenIdle} disabled={busy} onChange={(checked) => void patch({ clickThroughWhenIdle: checked })} />
          <div className="flex flex-col gap-2 border-t border-edge pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><p className="text-sm font-medium text-fg">{t.customPets}</p><p className="mt-1 break-all font-mono text-xs text-fg-muted">{state.customPetsDir}</p></div>
            <button type="button" onClick={() => void api.openCustomPetsDir()} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-fg"><ExternalLink className="size-3.5" />{t.openFolder}</button>
          </div>
          <button type="button" className={cn('inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-fg disabled:opacity-50', interaction.press)} disabled={busy} onClick={() => void api.resetPosition().then(setState)}><RotateCcw className="size-3.5" />{t.resetPosition}</button>
        </div>
      </details>
    </SettingsPageFrame>
  );
}
