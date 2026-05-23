import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

export function ChannelPairingSetupSteps({
  ch,
  usesPairing,
  tokenReady,
  pairingComplete,
}: {
  ch: ChannelsSettingsMessages;
  usesPairing: boolean;
  tokenReady: boolean;
  pairingComplete: boolean;
}) {
  if (!usesPairing) return null;

  const step1Done = tokenReady;
  const step2Done = pairingComplete;
  const step1Current = !step1Done;
  const step2Current = step1Done && !step2Done;

  return (
    <ol className="space-y-2 rounded-xl border border-accent/25 bg-accent-soft/20 px-4 py-3 text-xs">
      <li className="flex items-start gap-2">
        <StepDot done={step1Done} current={step1Current} index={1} />
        <span className={cn('text-fg', step1Done && 'text-fg-muted')}>{ch.telegramSetupStepToken}</span>
      </li>
      <li className="flex items-start gap-2">
        <StepDot done={step2Done} current={step2Current} index={2} />
        <span className={cn('text-fg', step2Done && 'text-fg-muted')}>{ch.telegramSetupStepPairing}</span>
      </li>
    </ol>
  );
}

function StepDot({ done, current, index }: { done: boolean; current: boolean; index: number }) {
  return (
    <span
      className={cn(
        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
        done && 'border-success bg-success text-white',
        !done && current && 'border-accent bg-accent text-white',
        !done && !current && 'border-edge text-fg-muted',
      )}
      aria-hidden
    >
      {done ? '✓' : String(index)}
    </span>
  );
}
