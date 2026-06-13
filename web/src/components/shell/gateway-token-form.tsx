import { useState, type ReactNode, type Ref } from 'react';

import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { secretInputLabelsFromToken } from '@/lib/secret-input-labels';
import { useLocaleStore } from '@/stores/locale-store';

export type GatewayTokenFormProps = {
  baseUrl: string;
  /** Called with trimmed token after validation. */
  onSubmit: (token: string) => void;
  /** Optional control before the Save button (e.g. Cancel in a dialog). */
  footerLeft?: ReactNode;
  /** Applied to the outer wrapper (fields + footer). */
  className?: string;
  /** Initial focus target when rendered inside a dialog. */
  tokenInputRef?: Ref<HTMLInputElement>;
};

/** Shared gateway URL + token fields and Save action (landing page and token dialog). */
export function GatewayTokenForm({
  baseUrl,
  onSubmit,
  footerLeft,
  className,
  tokenInputRef,
}: GatewayTokenFormProps) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).token;

  const [value, setValue] = useState('');
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
    <form
      className={cn('flex flex-col gap-3', className)}
      onSubmit={(event) => {
        event.preventDefault();
        handleSave();
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">{t.gatewayUrl}</span>
        <input
          readOnly
          tabIndex={-1}
          className="rounded-md border border-edge bg-surface-hover px-3 py-2 text-sm text-fg-muted"
          value={baseUrl}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">{t.tokenLabel}</span>
        <SecretInput
          inputRef={tokenInputRef}
          value={value}
          onChange={(next) => {
            setValue(next);
            setError('');
          }}
          placeholder={t.placeholder}
          labels={secretInputLabelsFromToken(t)}
        />
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </label>

      <div className="mt-4 flex justify-end gap-2">
        {footerLeft}
        <Button type="submit" variant="primary">
          {t.save}
        </Button>
      </div>
    </form>
  );
}
