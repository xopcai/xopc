import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import { cn } from '@/lib/cn';

export type ClarifyPromptState = {
  requestId: string;
  question: string;
  choices?: string[];
  default?: string;
};

type ClarifyPromptProps = {
  prompt: ClarifyPromptState | null;
  submitting: boolean;
  onSubmit: (answer: string) => void | Promise<void>;
};

export function ClarifyPrompt({ prompt, submitting, onSubmit }: ClarifyPromptProps) {
  const [freeText, setFreeText] = useState('');

  const pick = useCallback(
    (answer: string) => {
      void onSubmit(answer);
    },
    [onSubmit],
  );

  if (!prompt) {
    return null;
  }

  const hasChoices = Array.isArray(prompt.choices) && prompt.choices.length >= 2;

  return (
    <div
      role="region"
      aria-label="Clarification"
      className="mb-4 rounded-lg border border-edge bg-surface-elevated px-4 py-3 text-sm text-fg shadow-sm"
    >
      <MarkdownView content={prompt.question} compact className="mb-3" />
      {hasChoices ? (
        <div className="flex flex-wrap gap-2">
          {prompt.choices!.map((c) => (
            <Button
              key={c}
              type="button"
              variant="secondary"
              disabled={submitting}
              className={cn(
                'min-h-9 justify-start rounded-lg px-3 py-2 text-left text-sm font-normal shadow-none',
                'hover:border-edge',
              )}
              onClick={() => pick(c)}
            >
              {c}
            </Button>
          ))}
          {prompt.default ? (
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              className={cn(
                'min-h-9 justify-start rounded-lg border border-dashed border-edge px-3 py-2 text-left text-sm font-normal text-fg-muted',
                'hover:border-edge hover:text-fg',
              )}
              onClick={() => pick(prompt.default!)}
            >
              Default: {prompt.default}
            </Button>
          ) : null}
        </div>
      ) : (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const t = freeText.trim();
            if (!t) return;
            void onSubmit(t);
            setFreeText('');
          }}
        >
          <input
            type="text"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            disabled={submitting}
            placeholder="Your answer…"
            className="min-w-0 flex-1 rounded-md border border-edge bg-surface-panel px-3 py-2 text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={submitting || !freeText.trim()}
            className="shrink-0 rounded-lg px-4 py-2 shadow-surface"
          >
            Send
          </Button>
          {prompt.default ? (
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              className="shrink-0 rounded-lg px-3 py-2 text-sm font-normal text-fg-muted shadow-none hover:text-fg"
              onClick={() => pick(prompt.default!)}
            >
              Use default
            </Button>
          ) : null}
        </form>
      )}
    </div>
  );
}
