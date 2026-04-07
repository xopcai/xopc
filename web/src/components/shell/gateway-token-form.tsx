import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { useLocaleStore } from '@/stores/locale-store';

export type GatewayTokenFormProps = {
  baseUrl: string;
  /** Called with trimmed token after validation. */
  onSubmit: (token: string) => void;
  /** Optional control before the Save button (e.g. Cancel in a dialog). */
  footerLeft?: ReactNode;
  /** Applied to the outer wrapper (fields + footer). */
  className?: string;
};

/** Shared gateway URL + token fields and Save action (landing page and token dialog). */
export function GatewayTokenForm({ baseUrl, onSubmit, footerLeft, className }: GatewayTokenFormProps) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).token;

  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');

  function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(language === 'zh' ? '请输入 Token' : 'Please enter a token');
      return;
    }
    onSubmit(trimmed);
    setValue('');
    setError('');
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">{t.gatewayUrl}</span>
        <input
          readOnly
          className="rounded-md border border-edge bg-surface-hover px-3 py-2 text-sm text-fg-muted"
          value={baseUrl}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">{t.tokenLabel}</span>
        <div className="flex gap-2">
          <input
            type={show ? 'text' : 'password'}
            autoComplete="off"
            className={cn(
              'min-w-0 flex-1 rounded-md border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-disabled',
              settingsInputFocusClass,
            )}
            placeholder={t.placeholder}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
            }}
          />
          <Button type="button" variant="secondary" className="shrink-0 px-2" onClick={() => setShow((s) => !s)}>
            {show ? t.hide : t.show}
          </Button>
        </div>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </label>

      <div className="mt-4 flex justify-end gap-2">
        {footerLeft}
        <Button type="button" variant="primary" onClick={handleSave}>
          {t.save}
        </Button>
      </div>
    </div>
  );
}
