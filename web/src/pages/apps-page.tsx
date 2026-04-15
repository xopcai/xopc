import { ExternalLink, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  useExtensions,
  useExtensionsLoading,
} from '@/features/extensions/extension-provider';
import { extensionPagePath } from '@/features/extensions/extension-paths';
import type { ExtensionApiRow, PageContribution } from '@/features/extensions/types';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

export function AppsPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const extensions = useExtensions();
  const loading = useExtensionsLoading();

  const uiExtensions = extensions.filter((ext) => ext.hasUi);
  const backendOnlyExtensions = extensions.filter((ext) => !ext.hasUi);

  if (loading) {
    return <AppsPageSkeleton />;
  }

  return (
    <div className="mx-auto w-full max-w-app-main px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-fg">{m.appsPage.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{m.appsPage.subtitle}</p>
      </div>

      {extensions.length === 0 ? (
        <EmptyAppsState message={m.appsPage.empty} />
      ) : (
        <div className="flex flex-col gap-8">
          {uiExtensions.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-fg">
                {m.appsPage.sectionWithUi.replace('{{count}}', String(uiExtensions.length))}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {uiExtensions.map((ext) => (
                  <ExtensionCard key={ext.id} extension={ext} />
                ))}
              </div>
            </section>
          ) : null}

          {backendOnlyExtensions.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-fg">
                {m.appsPage.sectionBackend.replace('{{count}}', String(backendOnlyExtensions.length))}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {backendOnlyExtensions.map((ext) => (
                  <ExtensionCard key={ext.id} extension={ext} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AppsPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-app-main px-4 py-8">
      <div className="mb-6 h-8 w-40 max-w-full animate-pulse rounded-md bg-surface-hover" />
      <div className="mb-2 h-4 w-full max-w-md animate-pulse rounded bg-surface-hover" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl border border-edge bg-surface-base" />
        ))}
      </div>
    </div>
  );
}

function EmptyAppsState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[min(40vh,16rem)] flex-col items-center justify-center rounded-xl border border-dashed border-edge-subtle bg-surface-hover/40 px-4 py-12 text-center dark:bg-surface-hover/20">
      <p className="text-sm text-fg-muted">{message}</p>
    </div>
  );
}

function ExtensionCard({ extension }: { extension: ExtensionApiRow }) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const pages = extension.ui?.contributions?.pages ?? [];
  const settingsPanels = extension.ui?.contributions?.settingsPanels ?? [];
  const chatWidgets = extension.ui?.contributions?.chatWidgets ?? [];
  const sidebarPanels = extension.ui?.contributions?.sidebarPanels ?? [];

  const primaryPage: PageContribution | undefined =
    pages.find((p) => p.showInNav) ?? pages[0];
  const primarySettingsPanel = settingsPanels[0];

  const openPath = primaryPage
    ? extensionPagePath(extension.id, primaryPage)
    : null;
  const settingsPath = primarySettingsPanel
    ? `/settings/ext/${extension.id}/${primarySettingsPanel.id}`
    : null;

  const hasUi = extension.hasUi;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-edge bg-surface-base p-4">
      <div className="flex min-w-0 gap-3">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-sm font-semibold text-accent-fg"
          aria-hidden
        >
          {(extension.name || extension.id).charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="truncate text-sm font-semibold text-fg">{extension.name}</h3>
            {extension.version ? (
              <span className="shrink-0 text-xs text-fg-muted">v{extension.version}</span>
            ) : null}
            {!extension.active ? (
              <span className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase text-fg-muted">
                {m.appsPage.inactive}
              </span>
            ) : null}
          </div>
          {extension.description ? (
            <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-fg-muted">
              {extension.description}
            </p>
          ) : null}
        </div>
      </div>

      {!hasUi ? (
        <p className="text-xs text-fg-muted">{m.appsPage.backendOnlyHint}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <ContributionBadge
              template={m.appsPage.badgePages}
              count={pages.length}
              hidden={pages.length === 0}
            />
            <ContributionBadge
              template={m.appsPage.badgeSettings}
              count={settingsPanels.length}
              hidden={settingsPanels.length === 0}
            />
            <ContributionBadge
              template={m.appsPage.badgeWidgets}
              count={chatWidgets.length}
              hidden={chatWidgets.length === 0}
            />
            <ContributionBadge
              template={m.appsPage.badgeSidebar}
              count={sidebarPanels.length}
              hidden={sidebarPanels.length === 0}
            />
          </div>

          {(openPath || settingsPath) && extension.active ? (
            <div className="flex flex-wrap gap-2 border-t border-edge-subtle pt-2">
              {openPath ? (
                <Link
                  to={openPath}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs font-medium text-fg',
                    'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  )}
                >
                  <ExternalLink className="size-3.5 shrink-0 opacity-80" aria-hidden />
                  {m.appsPage.open}
                </Link>
              ) : null}
              {settingsPath ? (
                <Link
                  to={settingsPath}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs font-medium text-fg',
                    'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  )}
                >
                  <Settings className="size-3.5 shrink-0 opacity-80" aria-hidden />
                  {m.appsPage.openSettings}
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function ContributionBadge({
  template,
  count,
  hidden,
}: {
  template: string;
  count: number;
  hidden: boolean;
}) {
  if (hidden || count === 0) return null;
  return (
    <span className="inline-flex items-center rounded-md bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
      {template.replace(/\{\{count\}\}/g, String(count))}
    </span>
  );
}
