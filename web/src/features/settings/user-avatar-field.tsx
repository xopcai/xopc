import { Trash2, Upload, UserRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      const comma = value.indexOf(',');
      resolve(comma >= 0 ? value.slice(comma + 1) : value);
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

export function UserAvatarField() {
  const zh = useLocaleStore((s) => s.language) === 'zh';
  const inputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAvatar = useCallback(async () => {
    try {
      const response = await fetch(apiUrl(`/api/user-context/avatar?t=${Date.now()}`), {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        setAvatarUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
        return;
      }
      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);
      setAvatarUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });
    } catch {
      // Ignore transient load failure
    }
  }, []);

  useEffect(() => {
    void loadAvatar();
    const onUpdated = () => { void loadAvatar(); };
    window.addEventListener('user-avatar-updated', onUpdated);
    return () => {
      window.removeEventListener('user-avatar-updated', onUpdated);
      setAvatarUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [loadAvatar]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!ALLOWED_TYPES.has(file.type)) {
      setError(zh ? '仅支持 PNG、JPEG 或 WebP 格式图片。' : 'Only PNG, JPEG, or WebP images are supported.');
      return;
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      setError(zh ? '头像图片需小于 2 MB。' : 'Avatar image must be 2 MB or smaller.');
      return;
    }
    setBusy(true);
    try {
      const base64 = await fileToBase64(file);
      await fetchJson(apiUrl('/api/user-context/avatar'), {
        method: 'PUT',
        body: JSON.stringify({ base64, mimeType: file.type }),
      });
      await loadAvatar();
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? '上传头像失败。' : 'Failed to upload avatar.'));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(apiUrl('/api/user-context/avatar'), { method: 'DELETE' });
      await loadAvatar();
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? '移除头像失败。' : 'Failed to remove avatar.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
      <div className="flex items-center gap-3.5">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-edge bg-surface-subtle">
          {avatarUrl ? (
            <img src={avatarUrl} alt={zh ? '用户头像' : 'User avatar'} className="size-full object-cover" />
          ) : (
            <UserRound className="size-5 text-fg-muted" aria-hidden />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-fg">{zh ? '用户头像' : 'User avatar'}</div>
          <p className="text-xs text-fg-muted">
            {zh ? '支持 PNG / JPEG / WebP（≤2 MB），也可直接在对话中发图或生图设置。' : 'PNG, JPEG, or WebP up to 2 MB. You can also set it in chat.'}
          </p>
          {error ? <p role="alert" className="mt-1 text-xs text-danger">{error}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => { void handleFile(event.target.files?.[0]); }}
        />
        <Button
          variant="secondary"
          className="h-8 px-3 text-xs"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mr-1.5 size-3.5" aria-hidden />
          {zh ? '上传头像' : 'Upload'}
        </Button>
        {avatarUrl ? (
          <Button
            variant="ghost"
            className="h-8 px-3 text-xs"
            disabled={busy}
            onClick={() => { void handleRemove(); }}
          >
            <Trash2 className="mr-1.5 size-3.5" aria-hidden />
            {zh ? '移除' : 'Remove'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
