import { useState } from 'react';

import { messages } from '@/i18n/messages';
import { Button } from '@/components/ui/button';
import { useLocaleStore } from '@/stores/locale-store';

export function ChatComposer({
  disabled,
  sending,
  streaming,
  onSend,
  onAbort,
}: {
  disabled: boolean;
  sending: boolean;
  streaming: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const [value, setValue] = useState('');

  const busy = sending || streaming;

  return (
    <div className="border-t border-edge bg-surface-panel p-3 dark:border-edge">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <textarea
          className="min-h-[88px] w-full resize-y rounded-md border border-edge bg-surface-base px-3 py-2 text-sm text-fg placeholder:text-fg-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          placeholder={m.chat.typeMessage}
          value={value}
          disabled={disabled || busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!busy && value.trim()) {
                onSend(value);
                setValue('');
              }
            }
          }}
        />
        <div className="flex justify-end gap-2">
          {busy ? (
            <Button type="button" variant="secondary" onClick={onAbort}>
              {m.chat.abort}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="primary"
            disabled={disabled || busy || !value.trim()}
            onClick={() => {
              if (!value.trim()) return;
              onSend(value);
              setValue('');
            }}
          >
            {m.chat.sendMessage}
          </Button>
        </div>
      </div>
    </div>
  );
}
