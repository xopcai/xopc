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
        <Dialog.Overlay className="fixed inset-0 z-[140] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[150] flex h-[min(26rem,calc(100vh-2rem))] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
          <div className="border-b border-edge-subtle px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-fg">
              {zh ? '允许端侧工具执行？' : 'Allow endpoint tool?'}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-fg-muted">
              {request?.title ?? ''}
            </Dialog.Description>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {zh ? '实际参数' : 'Arguments'}
            </div>
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-edge bg-surface-base p-3 font-mono text-xs leading-5 text-fg">
              {request?.argumentsPreview ?? '{}'}
            </pre>
          </div>
          <div className="flex justify-end gap-2 border-t border-edge-subtle px-5 py-4">
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
