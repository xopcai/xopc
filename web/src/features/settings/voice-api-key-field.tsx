import { Check, Copy, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { revealVoiceConfigApiKey } from '@/features/settings/voice-config-api';
import { isMaskedKey } from '@/features/settings/providers-api';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

export type VoiceApiKeyFieldLabels = {
  maskedHelp: string;
  copy: string;
  copied: string;
  show: string;
  hide: string;
  notInConfigFile: string;
  loadFailed: string;
};

export function VoiceApiKeyField({
  kind,
  providerId,
  fieldId,
  value,
  onChange,
  labels,
  placeholder = 'sk-...',
  className,
}: {
  kind: 'stt' | 'tts';
  providerId: string;
  fieldId: string;
  value: string;
  onChange: (next: string) => void;
  labels: VoiceApiKeyFieldLabels;
  placeholder?: string;
  className?: string;
}) {
  const [showKey, setShowKey] = useState(false);
  const [revealed, setRevealed] = useState<string | null | undefined>(undefined);
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealErr, setRevealErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const masked = isMaskedKey(value);

  useEffect(() => {
    if (!masked) {
      setRevealed(undefined);
      setRevealErr(null);
    }
  }, [masked, value]);

  const inputValue = (() => {
    if (!masked) return value;
    if (showKey && typeof revealed === 'string') return revealed;
    return value;
  })();

  const inputType = showKey ? ('text' as const) : ('password' as const);

  const copyEnabled =
    (!masked && value.trim().length > 0) ||
    (typeof revealed === 'string' && revealed.length > 0);

  const copyKey = useCallback(async () => {
    const text =
      !masked && value.trim() && !isMaskedKey(value)
        ? value.trim()
        : typeof revealed === 'string' && revealed.length > 0
          ? revealed
          : '';
    if (!text) return;
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [masked, revealed, value]);

  const toggleEye = useCallback(async () => {
    setRevealErr(null);
    if (!masked) {
      setShowKey((s) => !s);
      return;
    }
    if (revealed !== undefined) {
      setShowKey((s) => !s);
      return;
    }
    setRevealLoading(true);
    try {
      const payload = await revealVoiceConfigApiKey({ kind, provider: providerId });
      setRevealed(payload.apiKey ?? null);
      setShowKey(true);
    } catch (e) {
      setRevealErr(e instanceof Error ? e.message : labels.loadFailed);
      setRevealed(null);
    } finally {
      setRevealLoading(false);
    }
  }, [kind, labels.loadFailed, masked, providerId, revealed]);

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {masked ? <p className="text-xs text-fg-subtle">{labels.maskedHelp}</p> : null}
      <div className="flex flex-wrap gap-2">
        <input
          id={fieldId}
          type={inputType}
          autoComplete="off"
          spellCheck={false}
          className={cn(
            'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-fg',
            'placeholder:text-fg-subtle',
            settingsInputFocusClass,
            'dark:border-edge',
            'min-w-0 flex-1 font-mono text-xs',
          )}
          value={inputValue}
          placeholder={masked ? '••••••••' : placeholder}
          onChange={(e) => {
            const next = e.target.value;
            if (masked && typeof revealed === 'string' && showKey && next !== revealed) {
              setRevealed(undefined);
              setShowKey(false);
            }
            onChange(next);
          }}
        />
        {copyEnabled ? (
          <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => void copyKey()}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? labels.copied : labels.copy}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          className="px-2 py-1 text-xs"
          disabled={revealLoading}
          onClick={() => void toggleEye()}
        >
          {revealLoading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : showKey ? (
            <EyeOff className="size-3.5" />
          ) : (
            <Eye className="size-3.5" />
          )}
          {showKey ? labels.hide : labels.show}
        </Button>
      </div>
      {masked && showKey && revealed === null && !revealErr ? (
        <p className="text-xs text-amber-700 dark:text-amber-400/90">{labels.notInConfigFile}</p>
      ) : null}
      {revealErr ? <p className="text-xs text-red-600 dark:text-red-400">{revealErr}</p> : null}
    </div>
  );
}
