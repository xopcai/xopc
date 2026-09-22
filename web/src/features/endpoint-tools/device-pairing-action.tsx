import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import type { DevicePairingTargetKind } from '@xopcai/gateway-contract';
import { DevicePairingWizard } from './device-pairing-wizard';

export function DevicePairingAction({ onPaired }: { onPaired: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).endpointToolsSettings.deviceAccess;
  const [dialog, setDialog] = useState<{ open: boolean; target?: DevicePairingTargetKind }>({ open: false });

  useEffect(() => {
    const requestedTarget = searchParams.get('startDevicePairing');
    if (requestedTarget !== 'mobile' && requestedTarget !== 'browser') return;
    setDialog({ open: true, target: requestedTarget });
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('startDevicePairing');
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <>
      <Button
        variant="primary"
        onClick={() => setDialog({ open: true })}
      >
        <Plus className="size-4" aria-hidden />
        {copy.addDevice}
      </Button>
      <DevicePairingWizard
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
        onPaired={onPaired}
        targetKind={dialog.target}
      />
    </>
  );
}
