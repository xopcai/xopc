import { Clock3, GitBranch, MessageCircle, MessageSquare, PanelsTopLeft, Plug, Settings2, Terminal, Workflow } from 'lucide-react';
import { resolveSessionIdentity, type SessionIdentityInput } from '@xopcai/gateway-contract';

import { cn } from '@/lib/cn';

const BRAND_IMG_BY_CHANNEL: Record<string, string> = {
  // Static assets in `web/public` (served as `/…` in Vite + gateway static root).
  feishu: '/channel-icons/feishu.svg',
  lark: '/channel-icons/lark.svg',
  telegram: '/channel-icons/telegram.svg',
  wechat: '/channel-icons/wechat.svg',
  weixin: '/channel-icons/weixin.svg',
};

/** Small glyph for `SessionMetadata.sourceChannel` in sidebar / lists (some channels use brand marks from `web/public`). */
export function SessionChannelIcon({
  sourceChannel,
  className,
  session,
}: {
  sourceChannel: string;
  className?: string;
  session?: SessionIdentityInput;
}) {
  const identity = resolveSessionIdentity(session ?? { sourceChannel });
  const taskIcon = { automation: Clock3, workflow: Workflow, subagent: GitBranch, system: Settings2 };
  const TaskIcon = identity.purpose === 'chat' ? undefined : taskIcon[identity.purpose];
  if (TaskIcon) return <TaskIcon className={cn('shrink-0', className)} strokeWidth={1.75} aria-hidden />;
  const key = sourceChannel.trim().toLowerCase();
  const brandSrc = BRAND_IMG_BY_CHANNEL[key];
  if (brandSrc && ['telegram', 'wechat', 'feishu'].includes(identity.source)) {
    return (
      <img
        src={brandSrc}
        alt=""
        draggable={false}
        className={cn('shrink-0', className)}
        aria-hidden
      />
    );
  }

  const Icon = identity.source === 'workbench' ? MessageSquare
    : identity.source === 'browser' ? PanelsTopLeft
    : identity.source === 'terminal' ? Terminal
    : identity.source === 'api' ? Plug : MessageCircle;
  return <Icon className={cn('shrink-0', className)} strokeWidth={1.75} aria-hidden />;
}
