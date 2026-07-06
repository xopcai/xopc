import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';

import {
  buildCronSchedule,
  type IntervalPreset,
  type ScheduleMode,
  type ScheduleState,
} from './cron-schedule';

type CronSchedulePickerProps = {
  value: ScheduleState;
  onChange: (next: ScheduleState) => void;
};

const INTERVAL_OPTIONS: IntervalPreset[] = [15, 30, 60];
const MINUTE_OPTIONS = [0, 15, 30, 45] as const;

export function CronSchedulePicker({ value, onChange }: CronSchedulePickerProps) {
  const { colors } = useTheme();
  const m = useMessages();
  const pm = m.cronForm;

  const chipBg = colors.surface.input;
  const chipActiveBg = colors.accent.primary;
  const textPrimary = colors.text.primary;
  const textSecondary = colors.text.secondary;
  const preview = buildCronSchedule(value);

  const setMode = (mode: ScheduleMode) => onChange({ ...value, mode });

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: textSecondary }]}>{pm.scheduleLabel}</Text>

      <View style={styles.chipRow}>
        <ModeChip
          label={pm.modeInterval}
          active={value.mode === 'interval'}
          onPress={() => setMode('interval')}
          chipBg={chipBg}
          activeBg={chipActiveBg}
          activeText={colors.text.inverse}
          textSecondary={textSecondary}
        />
        <ModeChip
          label={pm.modeDaily}
          active={value.mode === 'daily'}
          onPress={() => setMode('daily')}
          chipBg={chipBg}
          activeBg={chipActiveBg}
          activeText={colors.text.inverse}
          textSecondary={textSecondary}
        />
        <ModeChip
          label={pm.modeWeekdays}
          active={value.mode === 'weekdays'}
          onPress={() => setMode('weekdays')}
          chipBg={chipBg}
          activeBg={chipActiveBg}
          activeText={colors.text.inverse}
          textSecondary={textSecondary}
        />
      </View>

      {value.mode === 'interval' ? (
        <View style={styles.chipRow}>
          {INTERVAL_OPTIONS.map((minutes) => (
            <ModeChip
              key={minutes}
              label={intervalLabel(minutes, pm)}
              active={value.intervalMinutes === minutes}
              onPress={() => onChange({ ...value, intervalMinutes: minutes })}
              chipBg={chipBg}
              activeBg={chipActiveBg}
              activeText={colors.text.inverse}
              textSecondary={textSecondary}
            />
          ))}
        </View>
      ) : (
        <View style={styles.timeRow}>
          <View style={styles.timeField}>
            <Text style={[styles.fieldLabel, { color: textSecondary }]}>{pm.hour}</Text>
            <TextInput
              mode="outlined"
              dense
              keyboardType="number-pad"
              value={String(value.hour)}
              onChangeText={(text) => {
                const hour = Math.min(23, Math.max(0, Number(text) || 0));
                onChange({ ...value, hour });
              }}
              style={styles.timeInput}
            />
          </View>
          <View style={styles.timeField}>
            <Text style={[styles.fieldLabel, { color: textSecondary }]}>{pm.minute}</Text>
            <View style={styles.chipRow}>
              {MINUTE_OPTIONS.map((minute) => (
                <ModeChip
                  key={minute}
                  label={String(minute).padStart(2, '0')}
                  active={value.minute === minute}
                  onPress={() => onChange({ ...value, minute })}
                  chipBg={chipBg}
                  activeBg={chipActiveBg}
                  activeText={colors.text.inverse}
                  textSecondary={textSecondary}
                />
              ))}
            </View>
          </View>
        </View>
      )}

      <Text style={[styles.preview, { color: textSecondary }]}>
        {pm.schedulePreview}: <Text style={{ color: textPrimary, fontFamily: 'monospace' }}>{preview}</Text>
      </Text>
    </View>
  );
}

function intervalLabel(minutes: IntervalPreset, pm: ReturnType<typeof useMessages>['cronForm']): string {
  if (minutes === 15) return pm.every15Min;
  if (minutes === 30) return pm.every30Min;
  return pm.everyHour;
}

function ModeChip({
  label,
  active,
  onPress,
  chipBg,
  activeBg,
  activeText,
  textSecondary,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  chipBg: string;
  activeBg: string;
  activeText: string;
  textSecondary: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? activeBg : chipBg }]}
    >
      <Text style={[styles.chipText, { color: active ? activeText : textSecondary }, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  label: { fontSize: 13, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: { fontSize: 13, fontWeight: '500' },
  chipTextActive: { fontWeight: '600' },
  timeRow: { gap: 12 },
  timeField: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '500' },
  timeInput: { maxWidth: 88 },
  preview: { fontSize: 12, lineHeight: 18 },
});
