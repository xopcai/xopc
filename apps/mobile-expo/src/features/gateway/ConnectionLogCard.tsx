/**
 * Settings card listing the most recent connection events. Surfaces race
 * outcomes, dual-fire winners, apiFetch failures, and SSE state changes so
 * the user has something concrete to copy when reporting a problem and we
 * have something concrete to read.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { setAppClipboardStringAsync } from '../clipboard-intake/write-app-clipboard';
import { SettingsSection, useSettingsColors } from '../settings/settings-ui';

import {
  clearConnectionEvents,
  subscribeConnectionEvents,
  type ConnectionEvent,
} from './connection-log';

const RECENT_LIMIT = 25;

export const ConnectionLogCard = memo(function ConnectionLogCard({
  onCopied,
}: {
  onCopied?: () => void;
}) {
  const colors = useSettingsColors();
  const m = useMessages();
  const log = m.gateway.log;
  const [events, setEvents] = useState<ConnectionEvent[]>([]);

  useEffect(() => subscribeConnectionEvents(setEvents), []);

  const recent = useMemo(
    () => events.slice(-RECENT_LIMIT).reverse(),
    [events],
  );

  const copyAsText = async () => {
    if (!recent.length) return;
    const text = events
      .map((e) => formatEventLine(e))
      .join('\n');
    await setAppClipboardStringAsync(text);
    onCopied?.();
  };

  return (
    <SettingsSection title={log.title}>
      {recent.length === 0 ? (
        <View style={styles.empty}>
          <Text style={{ color: colors.textMuted }}>{log.empty}</Text>
        </View>
      ) : (
        <ScrollView style={styles.list} nestedScrollEnabled>
          {recent.map((e, idx) => (
            <View
              key={`${e.at}-${idx}`}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <Text style={[styles.line, { color: colors.text }]} selectable>
                {formatEventLine(e)}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
      <View style={styles.actions}>
        <Button mode="text" compact onPress={() => void copyAsText()} disabled={!recent.length}>
          {log.copy}
        </Button>
        <Pressable onPress={clearConnectionEvents}>
          <Text style={[styles.clear, { color: colors.textMuted }]}>{log.clear}</Text>
        </Pressable>
      </View>
    </SettingsSection>
  );
});

function formatEventLine(e: ConnectionEvent): string {
  const ts = formatTimestamp(e.at);
  const status = e.ok ? 'ok' : 'fail';
  const route = e.route ? ` ${e.route}` : '';
  const latency = typeof e.latencyMs === 'number' ? ` ${Math.round(e.latencyMs)}ms` : '';
  const reason = e.reason ? ` reason=${e.reason}` : '';
  const network = e.network ? ` net=${e.network}` : '';
  const message = e.message ? ` "${e.message.replace(/\n/g, ' ')}"` : '';
  return `[${ts}] ${e.kind}${route} ${status}${latency}${reason}${network}${message}`.trim();
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const styles = StyleSheet.create({
  empty: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  list: {
    maxHeight: 220,
    paddingHorizontal: 12,
  },
  row: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  line: {
    fontFamily: 'Menlo',
    fontSize: 11,
    lineHeight: 14,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  clear: {
    fontSize: 13,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
});
