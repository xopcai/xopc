import { useCallback } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router-dom';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export function SceneDirtyGuard({ dirty, zh }: { dirty: boolean; zh: boolean }) {
  useBeforeUnload(useCallback((event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  }, [dirty]));

  const blocker = useBlocker(dirty);
  const blocked = blocker.state === 'blocked';

  return (
    <ConfirmDialog
      open={blocked}
      title={zh ? '放弃未保存的更改？' : 'Discard unsaved changes?'}
      description={zh
        ? '当前内容尚未保存，现在离开将丢失这些更改。'
        : 'Your changes have not been saved. Leaving now will discard them.'}
      confirmLabel={zh ? '放弃并离开' : 'Discard and leave'}
      cancelLabel={zh ? '继续编辑' : 'Keep editing'}
      destructive
      overlayClassName="z-[100]"
      contentClassName="z-[101]"
      onConfirm={() => {
        if (blocker.state === 'blocked') blocker.proceed();
      }}
      onCancel={() => {
        if (blocker.state === 'blocked') blocker.reset();
      }}
    />
  );
}
