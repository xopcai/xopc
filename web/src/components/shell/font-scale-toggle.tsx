import { Button } from '@/components/ui/button';
import {
  segmentedThumbActiveClassName,
  segmentedThumbBaseClassName,
  segmentedTrackClassName,
} from '@/components/ui/segmented-styles';
import { cn } from '@/lib/cn';
import { type FontScalePreference, useFontScaleStore } from '@/stores/font-scale-store';

type FontScaleLabels = {
  compact: string;
  default: string;
  large: string;
};

const ORDER: readonly FontScalePreference[] = ['compact', 'default', 'large'];

type Props = {
  labels: FontScaleLabels;
  ariaLabel: string;
};

export function FontScaleToggle({ labels, ariaLabel }: Props) {
  const preference = useFontScaleStore((s) => s.preference);
  const setPreference = useFontScaleStore((s) => s.setPreference);

  return (
    <div className={segmentedTrackClassName} role="group" aria-label={ariaLabel}>
      {ORDER.map((value) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          aria-pressed={preference === value}
          onClick={() => setPreference(value)}
          className={cn(
            segmentedThumbBaseClassName,
            'h-7 min-w-[4.25rem] shrink-0 px-2 py-0',
            preference === value && segmentedThumbActiveClassName,
            preference === value && 'text-fg hover:text-fg',
          )}
        >
          {labels[value]}
        </Button>
      ))}
    </div>
  );
}
