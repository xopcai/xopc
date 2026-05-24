import { ExternalLink, Server } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { SshCliSection } from '@/features/remote-access/ssh-cli-section';
import { RemoteAccessDocsLink } from '@/features/remote-access/remote-access-docs-link';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function RemoteAccessAdvancedTab() {
  const language = useLocaleStore((s) => s.language);
  const adv = messages(language).remoteAccess.advanced;

  return (
    <div className="flex flex-col gap-6">
      <SshCliSection embedded />

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Server} title={adv.lanTitle} subtitle={adv.lanSubtitle} />
        <div className="mt-4 space-y-3">
          <p className="text-sm text-fg-muted">{adv.lanBody}</p>
          <Link
            to="/settings/gateway"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            {adv.lanLink}
            <ExternalLink className="size-3.5" aria-hidden />
          </Link>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <h2 className="text-sm font-semibold text-fg">{adv.proxyTitle}</h2>
        <p className="mt-1 text-sm text-fg-muted">{adv.proxyBody}</p>
        <RemoteAccessDocsLink language={language} label={adv.proxyDocs} section="advanced" className="mt-3" />
      </SettingsFormSection>
    </div>
  );
}
