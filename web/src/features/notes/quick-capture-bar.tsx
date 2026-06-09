import { Image, Mic, Send } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export type QuickCaptureBarProps = {
  placeholder: string;
  sendLabel: string;
  onCapture: (text: string) => Promise<void>;
  onImagePick?: () => void;
  onVoiceRecord?: () => void;
};

export function QuickCaptureBar({ placeholder, sendLabel, onCapture, onImagePick, onVoiceRecord }: QuickCaptureBarProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    try {
      await onCapture(trimmed);
    } catch {
      setText(trimmed);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [text, sending, onCapture]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div
      className={cn(
        'flex items-end gap-1.5 rounded-2xl border border-edge bg-surface-panel px-2 py-2 shadow-sm',
        'focus-within:border-accent focus-within:ring-1 focus-within:ring-accent',
      )}
    >
      {onImagePick && (
        <button
          type="button"
          onClick={onImagePick}
          className="shrink-0 rounded-lg p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          aria-label="Image"
        >
          <Image className="h-4 w-4" />
        </button>
      )}
      {onVoiceRecord && (
        <button
          type="button"
          onClick={onVoiceRecord}
          className="shrink-0 rounded-lg p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          aria-label="Voice"
        >
          <Mic className="h-4 w-4" />
        </button>
      )}
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        className="min-h-[2rem] flex-1 resize-none bg-transparent text-sm text-fg placeholder:text-fg-muted focus:outline-none"
        style={{ fieldSizing: 'content' }}
      />
      <Button
        variant="primary"
        className="shrink-0 rounded-lg px-2.5 py-1.5"
        disabled={!text.trim() || sending}
        onClick={() => void handleSubmit()}
        aria-label={sendLabel}
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
