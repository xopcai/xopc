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
  const location = request?.toolName?.endsWith('.device.get_location');
  const args = location ? JSON.parse(request!.argumentsPreview) as { purpose: string; precision: string } : undefined;

  return (
    <Dialog.Root
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open && request) settleEndpointConfirmation(request.invocationId, false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[140] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[150] flex h-[min(26rem,calc(100vh-2rem))] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-float focus:outline-none">
          <div className="border-b border-edge-subtle px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-fg">
              {location ? (zh ? '允许本次使用位置？' : 'Use location once?') : (zh ? '允许端侧工具执行？' : 'Allow endpoint tool?')}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-fg-muted">
              {request?.title ?? ''}
            </Dialog.Description>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {location ? <div className="space-y-3 text-sm text-fg-muted"><p>{zh ? '用途：' : 'Purpose: '}{args?.purpose === 'weather' ? (zh ? '查询天气' : 'Weather') : (zh ? '查询附近地点' : 'Nearby places')}</p><p>{zh ? '精度：' : 'Precision: '}{args?.precision === 'precise' ? (zh ? '精确位置' : 'Precise') : (zh ? '大致位置' : 'Approximate')}</p><p>{zh ? '此浏览器的位置仅用于本次查询。坐标将发送给 ' : 'This browser’s location is used only for this query. Coordinates are sent to '}{args?.purpose === 'weather' ? 'Open-Meteo' : 'OpenStreetMap'}{zh ? '，原始坐标不进入聊天历史。系统权限开启后，每次调用仍需确认。' : '; raw coordinates are excluded from chat history. Each call requires consent even when OS permission is enabled.'}</p></div> : <><div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {zh ? '实际参数' : 'Arguments'}
            </div>
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-edge bg-surface-base p-3 font-mono text-xs leading-5 text-fg">
              {request?.argumentsPreview ?? '{}'}
            </pre></>}
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
              {zh ? '允许一次' : 'Allow once'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
