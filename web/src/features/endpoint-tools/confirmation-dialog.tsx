import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { useLocaleStore } from '@/stores/locale-store';
import {
  settleEndpointConfirmation,
  useEndpointConfirmation,
} from './confirmation-store';

export function EndpointToolConfirmationDialog() {
  const request = useEndpointConfirmation();
  const language = useLocaleStore((state) => state.language);
  const zh = language === 'zh';

  return (
    <Dialog.Root
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open && request) settleEndpointConfirmation(request.invocationId, false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[140] bg-scrim" />
        <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[150] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-overlay p-5 shadow-float focus:outline-none">
          <Dialog.Title className="text-base font-semibold text-fg">
            {request?.title}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-fg-muted">
            {request?.remember
              ? (zh ? '允许当前 Gateway 使用这项设备能力？只需授权一次。' : 'Allow the current Gateway to use this device capability? This permission is saved.')
              : (zh ? '允许当前 Gateway 使用这项设备能力？' : 'Allow the current Gateway to use this device capability?')}
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              onClick={() => request && settleEndpointConfirmation(request.invocationId, false)}
            >
              {zh ? '拒绝' : 'Deny'}
            </Button>
            <Button
              variant="primary"
              onClick={() => request && settleEndpointConfirmation(request.invocationId, true)}
            >
              {zh ? '允许' : 'Allow'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
