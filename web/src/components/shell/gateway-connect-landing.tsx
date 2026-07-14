import { ChevronDown, ExternalLink } from 'lucide-react';

import { APP_CHROME_DRAG_CLASS, APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { BrandLogo } from '@/components/shell/brand-logo';
import { GatewayTokenForm } from '@/components/shell/gateway-token-form';
import { PreferenceSelectFields } from '@/components/shell/preference-select-fields';
import { messages } from '@/i18n/messages';
import { docsGuidePageUrl } from '@/navigation';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

/** Shown when no gateway token is stored: full-page connect flow (first visit or after 401). */
export function GatewayConnectLanding() {
  const baseUrl = useGatewayStore((s) => s.baseUrl);
  const tokenExpired = useGatewayStore((s) => s.tokenExpired);
  const setGatewayToken = useGatewayStore((s) => s.setGatewayToken);

  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const l = m.gatewayLanding;
  const appearanceLabel = m.appearanceSettings.pageTitle;

  return (
    <div className="relative flex min-h-full flex-1 flex-col bg-surface-base">
      <div className={`flex h-14 shrink-0 items-center justify-end px-3 sm:px-4 ${APP_CHROME_DRAG_CLASS}`}>
        <div className={APP_CHROME_NO_DRAG_CLASS} role="group" aria-label={appearanceLabel}>
          <PreferenceSelectFields variant="toolbar" sections={['language', 'theme']} />
        </div>
      </div>
      <main id="app-main-content" className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-md rounded-xl border border-edge bg-surface-panel p-6 shadow-popover sm:p-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <BrandLogo className="size-14 shrink-0" alt={m.appBrand} />
            <h1 className="text-balance text-xl font-semibold tracking-tight text-fg">{l.headline}</h1>
            <p className="max-w-md text-sm leading-relaxed text-fg-muted">{l.subline}</p>
          </div>

          {tokenExpired ? (
            <div
              className="mt-5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-fg"
              role="status"
            >
              {l.sessionExpired}
            </div>
          ) : null}

          <GatewayTokenForm
            baseUrl={baseUrl}
            onSubmit={setGatewayToken}
            className="mt-6"
          />

          <details className="group mt-6 border-t border-edge-subtle pt-4 text-sm text-fg-muted">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium text-fg hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {l.tokenHelpSummary}
              <ChevronDown className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-180" aria-hidden />
            </summary>
            <div className="mt-3 space-y-2 leading-relaxed">
              <p>{l.tokenHelpOnboard}</p>
              <p>{l.tokenHelpLink}</p>
            </div>
          </details>

          <div className="mt-5 flex justify-center text-sm">
            <a
              href={docsGuidePageUrl(language, 'gateway')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              {l.docsGatewayLink}
              <ExternalLink className="size-3.5 opacity-80" aria-hidden />
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
