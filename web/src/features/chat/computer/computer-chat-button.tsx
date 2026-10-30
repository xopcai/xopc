import * as Popover from '@radix-ui/react-popover';
import { Monitor } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';

import { Button } from '@/components/ui/button';
import { useLocaleStore } from '@/stores/locale-store';
import { computerPreviewWidth, type ComputerPreviewSize } from './computer-preview-layout';
import { ComputerActivityCard } from './computer-activity-card';
import { useComputerPreview } from './use-computer-preview';

export function ComputerChatButton({ conversationId }: { conversationId: string }) {
  const { state } = useComputerPreview(conversationId, false);
  const [open, setOpen] = useState(false);
  const [frameSize, setFrameSize] = useState<ComputerPreviewSize>();
  const zh = useLocaleStore(s => s.language === 'zh');
  useEffect(() => { setOpen(false); setFrameSize(undefined); }, [conversationId, state?.previewId]);
  if (!state || state.conversationId !== conversationId || state.status === 'ended') return null;
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <Button variant="ghost" className="min-h-10 gap-1.5 px-2"
        title={zh ? '查看电脑预览' : 'View computer preview'} aria-label={zh ? '查看电脑预览' : 'View computer preview'}>
        <Monitor className="size-4" aria-hidden /><span className="text-xs">{zh ? '电脑' : 'Computer'}</span>
      </Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content align="end" sideOffset={8} collisionPadding={16} aria-label={zh ? '电脑预览' : 'Computer preview'}
        onOpenAutoFocus={event => event.preventDefault()}
        style={{ '--computer-preview-width': computerPreviewWidth(frameSize) } as CSSProperties}
        className="z-40 w-[var(--computer-preview-width)] max-h-[calc(100dvh-5rem)] overflow-hidden rounded-xl bg-transparent p-0 outline-none">
        <ComputerActivityCard key={state.previewId} conversationId={conversationId} onFrameSizeChange={setFrameSize} />

      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
