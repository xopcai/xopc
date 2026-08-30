import {
  forwardRef,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type KeyboardEventHandler,
  type TextareaHTMLAttributes,
} from 'react';

type TabCompletionBehaviorProps<Element extends HTMLInputElement | HTMLTextAreaElement> = {
  /** The complete value represented by the visible recommendation. */
  suggestion?: string | null;
  onAcceptSuggestion: (suggestion: string) => void;
  onKeyDown?: KeyboardEventHandler<Element>;
};

export type TabCompletionInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onKeyDown'>
  & TabCompletionBehaviorProps<HTMLInputElement>;

export type TabCompletionTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onKeyDown'>
  & TabCompletionBehaviorProps<HTMLTextAreaElement>;

function ariaKeyShortcuts(existing: string | undefined, suggestion: string | null | undefined): string | undefined {
  if (!suggestion?.trim()) return existing;
  if (!existing) return 'Tab';
  return existing.split(/\s+/).includes('Tab') ? existing : `${existing} Tab`;
}

function shouldAcceptSuggestion<Element extends HTMLInputElement | HTMLTextAreaElement>(
  event: KeyboardEvent<Element>,
  suggestion: string | null | undefined,
): suggestion is string {
  return event.key === 'Tab'
    && !event.shiftKey
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.nativeEvent.isComposing
    && !event.currentTarget.disabled
    && !event.currentTarget.readOnly
    && !event.currentTarget.value.trim()
    && Boolean(suggestion?.trim());
}

function handleTabCompletion<Element extends HTMLInputElement | HTMLTextAreaElement>(
  event: KeyboardEvent<Element>,
  suggestion: string | null | undefined,
  onAcceptSuggestion: (suggestion: string) => void,
  onKeyDown?: KeyboardEventHandler<Element>,
): void {
  onKeyDown?.(event);
  if (event.defaultPrevented || !shouldAcceptSuggestion(event, suggestion)) return;

  event.preventDefault();
  onAcceptSuggestion(suggestion);
}

/** Controlled input that accepts its visible recommendation with Tab while empty. */
export const TabCompletionInput = forwardRef<HTMLInputElement, TabCompletionInputProps>(
  function TabCompletionInput({ suggestion, onAcceptSuggestion, onKeyDown, 'aria-keyshortcuts': shortcuts, ...props }, ref) {
    return (
      <input
        {...props}
        ref={ref}
        aria-keyshortcuts={ariaKeyShortcuts(shortcuts, suggestion)}
        onKeyDown={(event) => handleTabCompletion(event, suggestion, onAcceptSuggestion, onKeyDown)}
      />
    );
  },
);

/** Controlled textarea that accepts its visible recommendation with Tab while empty. */
export const TabCompletionTextarea = forwardRef<HTMLTextAreaElement, TabCompletionTextareaProps>(
  function TabCompletionTextarea({ suggestion, onAcceptSuggestion, onKeyDown, 'aria-keyshortcuts': shortcuts, ...props }, ref) {
    return (
      <textarea
        {...props}
        ref={ref}
        aria-keyshortcuts={ariaKeyShortcuts(shortcuts, suggestion)}
        onKeyDown={(event) => handleTabCompletion(event, suggestion, onAcceptSuggestion, onKeyDown)}
      />
    );
  },
);
