import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { useLocaleStore } from '@/stores/locale-store';
import {
  settleEndpointReenrollment,
  useEndpointReenrollmentRequested,
} from './reenrollment-store';

export function EndpointReenrollmentDialog() {
  const open = useEndpointReenrollmentRequested();
  const zh = useLocaleStore((state) => state.language) === 'zh';
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && settleEndpointReenrollment(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[140] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[150] flex h-[min(22rem,calc(100vh-2rem))] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <Dialog.Title className="text-base font-semibold text-fg">
              {zh ? '重新注册此端？' : 'Re-enroll this endpoint?'}
            </Dialog.Title>
            <Dialog.Description className="mt-3 text-sm leading-6 text-fg-muted">
              {zh
                ? '此端身份已被撤销。继续会删除旧密钥并生成一个新的端身份，然后重新连接 Gateway。'
                : 'This endpoint identity was revoked. Continuing deletes the old key, creates a new endpoint identity, and reconnects to the Gateway.'}
            </Dialog.Description>
          </div>
          <div className="flex justify-end gap-2 border-t border-edge-subtle px-5 py-4">
            <Button onClick={() => settleEndpointReenrollment(false)}>
              {zh ? '取消' : 'Cancel'}
            </Button>
            <Button variant="primary" onClick={() => settleEndpointReenrollment(true)}>
              {zh ? '生成新身份' : 'Create new identity'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
