import { Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import { AgentAvatarDisplay } from './agent-avatar-display';
import { buildXopcDicebearValue, XOPC_CUSTOM_AVATAR } from './agent-avatar-dicebear-value';

export interface PendingAgentAvatar {
  base64: string;
  mimeType: string;
  preview: string;
}

export function AgentAvatarField({ agentId, avatar, zh, disabled, pending, onPendingChange, onReadingChange, onChange }: {
  agentId: string;
  avatar?: string;
  zh: boolean;
  disabled?: boolean;
  pending: PendingAgentAvatar | null;
  onPendingChange: (avatar: PendingAgentAvatar | null) => void;
  onReadingChange: (reading: boolean) => void;
  onChange: (avatar: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const readerRef = useRef<FileReader | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    return () => readerRef.current?.abort();
  }, []);

  const options = [
    { value: '', label: zh ? '自动头像' : 'Automatic' },
    { value: 'xopc:loopi:idle', label: zh ? '小环 · 平静' : 'Loopi · Calm' },
    { value: 'xopc:loopi:care', label: zh ? '小环 · 温暖' : 'Loopi · Warm' },
    { value: 'xopc:loopi:curious', label: zh ? '小环 · 好奇' : 'Loopi · Curious' },
    { value: 'xopc:loopi:listen', label: zh ? '小环 · 倾听' : 'Loopi · Listening' },
    { value: buildXopcDicebearValue('bottts', agentId), label: zh ? '机器人' : 'Robot' },
    { value: buildXopcDicebearValue('adventurer', agentId), label: zh ? '插画人物' : 'Illustration' },
  ];
  const currentLabel = options.find(option => option.value === (avatar ?? ''))?.label
    ?? (zh ? '自定义头像' : 'Custom avatar');
  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError(zh ? '请选择 PNG、JPG 或 WebP 图片。' : 'Choose a PNG, JPG, or WebP image.');
      return;
    }
    if (!file.size || file.size > 512 * 1024) {
      setError(zh ? '图片不能为空，且不能超过 512 KB。' : 'The image must be non-empty and at most 512 KB.');
      return;
    }
    setReading(true);
    onReadingChange(true);
    const reader = new FileReader();
    readerRef.current = reader;
    const finish = () => { setReading(false); onReadingChange(false); readerRef.current = null; };
    reader.onload = () => {
      const preview = String(reader.result);
      onPendingChange({ base64: preview.slice(preview.indexOf(',') + 1), mimeType: file.type, preview });
      onChange(XOPC_CUSTOM_AVATAR);
      finish();
    };
    reader.onerror = () => {
      setError(zh ? '图片读取失败，请重新选择。' : 'Could not read the image. Choose it again.');
      finish();
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
          onChange={event => { chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
        <button type="button" disabled={disabled || reading} onClick={() => inputRef.current?.click()}
          aria-label={zh ? '上传头像' : 'Upload avatar'} aria-describedby={`avatar-help-${agentId}`}
          className="group relative size-16 shrink-0 overflow-hidden rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50">
          {pending ? <img src={pending.preview} alt="" width={64} height={64} className="size-full object-cover" />
            : <AgentAvatarDisplay agentId={agentId} avatar={avatar} size={64} />}
          <span className="absolute inset-x-0 bottom-0 flex h-5 items-center justify-center bg-black/55 text-white"><Upload className="size-3" aria-hidden /></span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{zh ? '头像' : 'Avatar'}</p>
          <p className="mt-1 text-xs text-fg-muted">{reading ? (zh ? '正在读取图片…' : 'Reading image…') : pending ? (zh ? '新头像 · 保存后生效' : 'New avatar · save to apply') : currentLabel}</p>
          <p id={`avatar-help-${agentId}`} className="mt-1 text-xs text-fg-muted">{zh ? '点击头像上传 · PNG、JPG、WebP · 最大 512 KB' : 'Click to upload · PNG, JPG, WebP · Max 512 KB'}</p>
        </div>
        <Button variant="ghost" disabled={disabled || reading} aria-expanded={choosing} aria-controls={`avatar-options-${agentId}`} onClick={() => setChoosing(!choosing)}>
          {choosing ? (zh ? '收起选择' : 'Hide choices') : (zh ? '默认头像' : 'Built-in avatars')}
        </Button>
      </div>
      {choosing ? (
        <div id={`avatar-options-${agentId}`} className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label={zh ? '选择头像' : 'Choose avatar'}>
          {options.map(option => (
            <button key={option.value} type="button" disabled={disabled || reading} aria-pressed={(avatar ?? '') === option.value}
              onClick={() => { onPendingChange(null); onChange(option.value); setError(null); }}
              className={cn('flex min-h-24 flex-col items-center gap-2 rounded-xl border p-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                (avatar ?? '') === option.value ? 'border-accent bg-accent-soft text-fg' : 'border-edge bg-surface-panel text-fg-muted hover:bg-surface-hover')}>
              <AgentAvatarDisplay agentId={agentId} avatar={option.value} size={44} />
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
