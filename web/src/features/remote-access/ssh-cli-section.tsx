import { Copy, Terminal } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function SshCliSection() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).remoteAccess.ssh;
  const [copied, setCopied] = useState(false);

  const command = useMemo(
    () => 'xopc gateway ssh-tunnel --target user@your-host --local-port 18790 --remote-port 18790',
    [],
  );

  const onCopy = useCallback(async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [command]);

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader icon={Terminal} title={t.title} subtitle={t.subtitle} />
      <pre className="mt-4 overflow-x-auto rounded-lg border border-edge bg-surface px-3 py-2 text-xs text-fg-muted">
        {command}
      </pre>
      <div className="mt-2">
        <Button type="button" variant="ghost" onClick={() => void onCopy()}>
          <Copy className="mr-1 h-4 w-4" />
          {copied ? t.copied : t.copy}
        </Button>
      </div>
    </SettingsFormSection>
  );
}
