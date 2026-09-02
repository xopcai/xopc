import { ExternalLink, Server } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function RemoteAccessLanTab() {
  const language = useLocaleStore((s) => s.language);
  const lan = messages(language).remoteAccess.lan;

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
    </div>
  );
}
