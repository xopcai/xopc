import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useLocaleStore } from '@/stores/locale-store';

import { connectionUsagePath, type UsageTarget } from '../utils/connection-usage';

type Props = {
  target: UsageTarget;
  preview?: boolean;
  showAction?: boolean;
  onStart?: () => void;
};

export function ConnectionUsageGuide({ target, preview = false, showAction = true, onStart }: Props) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  return <section className="space-y-3 rounded-xl border border-edge bg-surface-base p-4" aria-label={zh ? '使用说明' : 'How to use'}>
    <div className="flex items-center gap-2">
      <Sparkles className="size-4 shrink-0 text-accent-fg" aria-hidden />
      <h3 className="text-sm font-semibold text-fg">{zh ? '在对话中使用' : 'Use in chat'}</h3>
    </div>
    <p className="text-sm leading-6 text-fg-muted">{preview
      ? (zh ? '保存并启用后，在对话中提到它，再说说你想做什么。' : 'Once saved and enabled, mention it in chat and describe what you want to do.')
      : (zh ? '在对话中提到它，再说说你想做什么。不知道从哪开始，也可以先问问它能帮你做什么。' : 'Mention it in chat and describe what you want to do. If you’re unsure where to start, ask what it can help with.')}</p>
    {!preview && showAction ? <>
      <Button asChild variant="secondary"><Link onClick={onStart} to={connectionUsagePath(target, zh)}>{zh ? '去对话中使用' : 'Open chat'}</Link></Button>
      <p className="text-xs leading-5 text-fg-subtle">{zh ? '将打开对话并填好开场白，你可以修改后再发送。' : 'Opens a chat with a draft message you can edit before sending.'}</p>
    </> : null}
  </section>;
}
