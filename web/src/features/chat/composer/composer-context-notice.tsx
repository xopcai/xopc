import { AlertTriangle, CircleAlert, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

export const COMPOSER_NOTICE_EVENT = 'xopc-composer-notice';

export type ComposerNoticeType = 'info' | 'success' | 'warning' | 'error';

export type ComposerNoticeDetail = {
  type: ComposerNoticeType;
  message: string;
  duration?: number;
  href?: string;
};

const META = {
  info: { Icon: Info, className: 'border-accent/25 bg-accent-soft text-accent-fg' },
  success: { Icon: Info, className: 'border-success/25 bg-success-soft text-success' },
  warning: { Icon: AlertTriangle, className: 'border-warning/25 bg-warning-soft text-fg' },
  error: { Icon: CircleAlert, className: 'border-danger/25 bg-danger-soft text-danger' },
} as const;

export function ComposerContextNotice() {
  const language = useLocaleStore((s) => s.language);
  const navigate = useNavigate();
  const [notice, setNotice] = useState<ComposerNoticeDetail | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ComposerNoticeDetail>).detail;
      if (!detail?.message?.trim()) return;
      setNotice({ ...detail, message: detail.message.trim() });
      window.clearTimeout(timer);
      const duration = detail.duration ?? (detail.type === 'error' ? 8000 : 5000);
      if (duration > 0) timer = window.setTimeout(() => setNotice(null), duration);
    };
    window.addEventListener(COMPOSER_NOTICE_EVENT, handler);
    return () => {
      window.removeEventListener(COMPOSER_NOTICE_EVENT, handler);
      window.clearTimeout(timer);
    };
  }, []);

  if (!notice) return null;
  const { Icon, className } = META[notice.type];

  return (
    <div className={cn('mx-3 mt-3 flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs', className)} role={notice.type === 'error' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 leading-5">{notice.message}</span>
      {notice.href ? (
        <button type="button" className="shrink-0 font-medium underline underline-offset-2" onClick={() => navigate(notice.href!)}>
          {language === 'zh' ? '前往设置' : 'Open settings'}
        </button>
      ) : null}
      <button type="button" className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current" aria-label={language === 'zh' ? '关闭提示' : 'Dismiss notice'} onClick={() => setNotice(null)}>
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
