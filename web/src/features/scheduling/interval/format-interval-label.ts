import {
  HEARTBEAT_INTERVAL_PRESET_MS,
  HEARTBEAT_INTERVAL_PRESET_MS_ORDER,
} from '@/features/scheduling/interval/interval-presets';

export type IntervalPresetLabels = {
  custom: string;
  every30s: string;
  every1min: string;
  every5min: string;
  every10min: string;
  every15min: string;
  every30min: string;
  every1h: string;
  every2h: string;
};

function presetLabel(ms: number, presets: IntervalPresetLabels): string | null {
  switch (ms) {
    case 30_000:
      return presets.every30s;
    case 60_000:
      return presets.every1min;
    case 300_000:
      return presets.every5min;
    case 600_000:
      return presets.every10min;
    case 900_000:
      return presets.every15min;
    case 1_800_000:
      return presets.every30min;
    case 3_600_000:
      return presets.every1h;
    case 7_200_000:
      return presets.every2h;
    default:
      return null;
  }
}

/** Human-readable label for a millisecond interval (preset phrase or compact duration). */
export function formatIntervalMsLabel(
  intervalMs: number,
  locale: string,
  presets?: IntervalPresetLabels,
): string {
  const ms = Math.max(1000, Math.round(intervalMs));
  if (presets && HEARTBEAT_INTERVAL_PRESET_MS.has(ms)) {
    const labeled = presetLabel(ms, presets);
    if (labeled) return labeled;
  }

  const sec = Math.max(1, Math.round(ms / 1000));
  if (sec < 120) {
    return new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'long' }).format(sec);
  }
  const min = Math.round(sec / 60);
  if (min < 120) {
    return new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(min);
  }
  const hr = Math.round(min / 60);
  return new Intl.NumberFormat(locale, { style: 'unit', unit: 'hour', unitDisplay: 'long' }).format(hr);
}

export function defaultIntervalPresetsOrder(): readonly number[] {
  return HEARTBEAT_INTERVAL_PRESET_MS_ORDER;
}
