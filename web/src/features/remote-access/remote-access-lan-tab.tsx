import { ExternalLink, Server } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { MobilePairQrSection } from '@/features/tunnel/mobile-pair-qr-section';
import { useMobilePairQr } from '@/features/tunnel/use-mobile-pair-qr';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

export function RemoteAccessLanTab() {
  const language = useLocaleStore((s) => s.language);
  const token = useGatewayStore((s) => s.token);
  const lan = messages(language).remoteAccess.lan;
  const pairQr = useMobilePairQr(token ?? '', { preferLan: true });

  return (
    <div className="flex flex-col gap-4">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Server} title={lan.title} subtitle={lan.subtitle} />
        <div className="mt-4 space-y-3">
          <p className="text-sm text-fg-muted">{lan.body}</p>
          <Link
            to="/settings/gateway"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            {lan.link}
            <ExternalLink className="size-3.5" aria-hidden />
          </Link>
        </div>
      </SettingsFormSection>

      <MobilePairQrSection
        pairQr={pairQr}
        gatewayToken={token ?? ''}
        lanOnly
        onRefreshQr={() => void pairQr.refreshQr()}
      />
    </div>
  );
}
