import { ExternalLink } from 'lucide-react';

import { BrandLogo } from '@/components/shell/brand-logo';
import { GatewayTokenForm } from '@/components/shell/gateway-token-form';
import { PreferenceSelectFields } from '@/components/shell/preference-select-fields';
import { messages } from '@/i18n/messages';
import { docsGuidePageUrl, helpDocsHomeUrl } from '@/navigation';
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

  return (
    <div className="flex min-h-full flex-1 flex-col bg-surface-base">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-lg rounded-xl border border-edge bg-surface-panel p-6 shadow-popover sm:p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <BrandLogo className="size-14 shrink-0" alt={m.appBrand} />
            <h1 className="text-lg font-semibold tracking-tight text-fg sm:text-xl">{l.headline}</h1>
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

          <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-fg-muted">
            <li>{l.stepOnboard}</li>
            <li>{l.stepPaste}</li>
            <li>{l.stepUrlHint}</li>
          </ol>

          <GatewayTokenForm
            baseUrl={baseUrl}
            onSubmit={setGatewayToken}
            className="mt-6 border-t border-edge-subtle pt-6"
          />

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
            <a
              href={helpDocsHomeUrl(language)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              {m.sidebar.helpDocs}
              <ExternalLink className="size-3.5 opacity-80" aria-hidden />
            </a>
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
      </div>

      <footer className="border-t border-edge-subtle bg-surface-panel/80 px-4 py-4">
        <div className="mx-auto w-full max-w-lg">
          <PreferenceSelectFields variant="sidebar" sections={['language', 'theme']} />
        </div>
      </footer>
    </div>
  );
}
