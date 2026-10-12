import { RotateCcw } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export function ThinkingEffortSlider({ options, value, label, levelLabel, disabled, onCommit, modelControl, resetLabel, defaultValue }: {
  options: string[];
  value: string;
  label: string;
  levelLabel: (level: string) => string;
  disabled: boolean;
  onCommit: (level: string) => void | Promise<void>;
  modelControl: ReactNode;
  resetLabel: string;
  defaultValue: string;
}) {
  const [preview, setPreview] = useState<number>();
  const committing = useRef(false);
  const selectedIndex = Math.max(0, options.indexOf(value));
  const index = preview ?? selectedIndex;
  const lastIndex = options.length - 1;
  const commit = async (next: number) => {
    if (committing.current || disabled) return;
    if (!options[next] || options[next] === value) { setPreview(undefined); return; }
    committing.current = true;
    setPreview(next);
    try {
      await onCommit(options[next]);
    } finally {
      committing.current = false;
      setPreview(undefined);
    }
  };

  return <div className="px-1 pt-1">
    <div className="relative text-center">
      <p className="text-base font-medium text-accent-fg" aria-hidden>{levelLabel(options[index])}</p>
      <button type="button" aria-label={resetLabel} title={resetLabel}
        disabled={disabled || value === defaultValue} onClick={() => void commit(options.indexOf(defaultValue))}
        className={cn('absolute -right-2 -top-2 flex size-9 items-center justify-center rounded-lg text-fg-subtle hover:bg-surface-hover hover:text-fg disabled:opacity-40', interaction.focusRingPanel)}>
        <RotateCcw className="size-4" aria-hidden />
      </button>
      {modelControl}
    </div>
    <div className="relative mt-1 h-11">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-6 -translate-y-1/2 overflow-hidden rounded-full bg-surface-active" aria-hidden>
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `calc(16px + (100% - 32px) * ${lastIndex > 0 ? index / lastIndex : 0})` }} />
        <div className="absolute inset-x-4 inset-y-0">{options.map((level, tick) => <span key={level}
          className={cn('absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full', tick <= index ? 'bg-surface-panel/60' : 'bg-fg-subtle/50')}
          style={{ left: `${lastIndex > 0 ? tick / lastIndex * 100 : 0}%` }} />)}</div>
      </div>
      <input type="range" min={0} max={Math.max(0, lastIndex)} step={1} value={index}
        aria-label={label} aria-valuetext={levelLabel(options[index])} disabled={disabled || lastIndex < 1}
        className={cn('xopc-thinking-effort-slider relative m-0 block h-11 w-full cursor-pointer rounded-lg disabled:cursor-not-allowed', interaction.focusRingPanel)}
        onChange={event => setPreview(Number(event.currentTarget.value))}
        onPointerUp={event => void commit(Number(event.currentTarget.value))}
        onPointerCancel={() => { if (!committing.current) setPreview(undefined); }}
        onKeyUp={event => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) void commit(Number(event.currentTarget.value));
        }}
        onBlur={event => { if (preview !== undefined) void commit(Number(event.currentTarget.value)); }} />
    </div>

  </div>;
}
