import { Cpu } from 'lucide-react';
import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { AgentDefaultsFormProvider, useAgentDefaultsForm } from './agent-defaults-form-context';

function AgentDefaultsLayoutChrome() {
  const ui = messages(useLocaleStore((s) => s.language));
  const {
    hasToken,
    loading,
    form,
    error,
    fetchError,
    mutate,
    pageTitle,
    a,
    save,
    discard,
    dirty,
    saving,
    saveOk,
    logsLoading,
  } = useAgentDefaultsForm();

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-10">
        <div className="flex items-start gap-3 rounded-2xl bg-surface-base p-6">
          <Cpu className="mt-0.5 size-5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <div>
            <h1 className="text-base font-semibold text-fg">{pageTitle}</h1>
            <p className="mt-1 text-sm text-fg-muted">{a.needToken}</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-8">
        <div className="h-8 w-48 animate-pulse rounded bg-surface-hover" />
        <div className="mt-6 h-32 animate-pulse rounded-xl bg-surface-hover" />
        <p className="mt-4 text-sm text-fg-muted">{logsLoading}</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-10">
        <p className="text-sm text-fg-muted">{error ?? fetchError ?? a.loadError}</p>
        <Button type="button" variant="secondary" onClick={() => void mutate()}>
          {ui.logs.refresh}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{pageTitle}</h1>
          <p className="mt-1 text-sm text-fg-muted">{a.subtitle}</p>
          <p className="mt-1 text-xs text-fg-subtle">{a.sectionDesc}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {saveOk ? <span className="text-sm text-fg-muted">{a.saved}</span> : null}
          <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={discard}>
            {a.discard}
          </Button>
          <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? a.saving : a.save}
          </Button>
        </div>
      </header>

      {error ? (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div className="min-w-0 flex-1 pt-2">
        <Suspense fallback={<p className="text-sm text-fg-muted">{logsLoading}</p>}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}

/** `/settings/agent-defaults/*` — shared form state, one Save for all sub-routes. */
export function AgentDefaultsSettingsLayout() {
  return (
    <AgentDefaultsFormProvider>
      <AgentDefaultsLayoutChrome />
    </AgentDefaultsFormProvider>
  );
}
