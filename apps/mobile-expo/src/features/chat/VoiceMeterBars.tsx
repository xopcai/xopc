/**
 * Compact waveform strip driven by metering samples (Kimi-style bars).
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

const BAR_COUNT = 36;

export const VoiceMeterBars = memo(function VoiceMeterBars({
  samples,
  accentColor,
  trackColor,
}: {
  /** Normalized heights 0–1, oldest left; padded to BAR_COUNT */
  samples: number[];
  accentColor: string;
  trackColor: string;
}) {
  const bars: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const idx = samples.length - BAR_COUNT + i;
    bars.push(idx >= 0 ? samples[idx] ?? 0.12 : 0.12);
  }

  return (
    <View style={styles.row}>
      {bars.map((h, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              height: Math.max(6, 52 * h),
              backgroundColor: h > 0.2 ? accentColor : trackColor,
            },
          ]}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
    height: 56,
    paddingHorizontal: 8,
  },
  bar: {
    width: 3,
    borderRadius: 2,
    minHeight: 6,
  },
});
