import { useCallback, useState } from 'react';

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
      <p className="mb-3 font-medium text-fg">{prompt.question}</p>
      {hasChoices ? (
        <div className="flex flex-wrap gap-2">
          {prompt.choices!.map((c) => (
            <button
              key={c}
              type="button"
              disabled={submitting}
              className="rounded-md border border-edge bg-surface-panel px-3 py-1.5 text-left text-fg transition hover:bg-surface-muted disabled:opacity-50"
              onClick={() => pick(c)}
            >
              {c}
            </button>
          ))}
          {prompt.default ? (
            <button
              type="button"
              disabled={submitting}
              className="rounded-md border border-dashed border-edge px-3 py-1.5 text-fg-muted hover:bg-surface-muted disabled:opacity-50"
              onClick={() => pick(prompt.default!)}
            >
              Default: {prompt.default}
            </button>
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
          <button
            type="submit"
            disabled={submitting || !freeText.trim()}
            className="shrink-0 rounded-md bg-accent px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            Send
          </button>
          {prompt.default ? (
            <button
              type="button"
              disabled={submitting}
              className="shrink-0 rounded-md border border-edge px-3 py-2 text-fg-muted hover:bg-surface-muted disabled:opacity-50"
              onClick={() => pick(prompt.default!)}
            >
              Use default
            </button>
          ) : null}
        </form>
      )}
    </div>
  );
}
