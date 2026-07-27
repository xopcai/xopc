import { LoaderCircle } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode, type Ref } from 'react';

import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { secretInputLabelsFromToken } from '@/lib/secret-input-labels';
import { useLocaleStore } from '@/stores/locale-store';

import { verifyGatewayCredential } from './gateway-credential-verification';

export type GatewayTokenFormProps = {
  baseUrl: string;
  /** Called with the validated gateway access credential. */
  onSubmit: (credential: string) => void;
  /** Optional control before the Save button (e.g. Cancel in a dialog). */
  footerLeft?: ReactNode;
  /** Applied to the outer wrapper (fields + footer). */
  className?: string;
  /** Initial focus target when rendered inside a dialog. */
  tokenInputRef?: Ref<HTMLInputElement>;
};

/** Shared gateway URL + access credential fields and Save action. */
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
  const [isConnecting, setIsConnecting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const setInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof tokenInputRef === 'function') {
        tokenInputRef(node);
      } else if (tokenInputRef) {
        (tokenInputRef as { current: HTMLInputElement | null }).current = node;
      }
    },
    [tokenInputRef],
  );

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(language === 'zh' ? '请输入 Token' : 'Please enter a token');
      inputRef.current?.focus();
      return;
    }

    if (isConnecting) return;

    setIsConnecting(true);
    const verification = await verifyGatewayCredential(trimmed);
    setIsConnecting(false);

    if (verification !== 'valid') {
      setError(
        verification === 'rejected'
          ? t.tokenRejected
          : verification === 'unreachable'
            ? t.gatewayUnreachable
            : t.tokenVerificationFailed,
      );
      inputRef.current?.focus();
      return;
    }

    onSubmit(trimmed);
    setValue('');
    setError('');
  }

  return (
    <form
      className={cn('flex flex-col gap-3', className)}
      aria-busy={isConnecting}
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      {baseUrl ? (
        <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">{t.gatewayUrl}</span>
          <output className="truncate rounded-md border border-edge bg-surface-hover px-3 py-2 font-mono text-sm text-fg-muted">
            {baseUrl}
          </output>
        </div>
      ) : null}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">
          {language === 'zh' ? '网关访问凭据' : 'Gateway access credential'}
        </span>
        <SecretInput
          id="gateway-token"
          name="gateway-token"
          inputRef={setInputRef}
          value={value}
          disabled={isConnecting}
          ariaDescribedBy={error ? 'gateway-token-error' : undefined}
          ariaInvalid={Boolean(error)}
          onChange={(next) => {
            setValue(next);
            setError('');
          }}
          placeholder={language === 'zh' ? 'Token 或 Password' : 'Token or password'}
          labels={secretInputLabelsFromToken(t)}
        />
        {error ? <p id="gateway-token-error" className="text-xs text-danger" role="alert">{error}</p> : null}
      </label>

      <div className="mt-4 flex justify-end gap-2">
        {footerLeft}
        <Button type="submit" variant="primary" disabled={isConnecting}>
          {isConnecting ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {isConnecting ? t.connecting : t.save}
        </Button>
      </div>
    </form>
  );
}
