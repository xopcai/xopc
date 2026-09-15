import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';
import { loadRecordings, reconcileRecording, useRecordings } from './recordings';

export function RecordingBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const m = useMessages().recordings;
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const active = useRecordings(state => state.items.some(item => item.state === 'recording' || item.state === 'paused'));
  useEffect(() => {
    try { loadRecordings(); } catch { setFailed(true); return; }
    const reconcile = () => { void reconcileRecording().catch(() => setFailed(true)); };
    reconcile();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') reconcile(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') reconcile(); }, 2000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, []);
  if ((!active && !failed) || (pathname === '/recordings' && !failed)) return null;
  return <Pressable accessibilityRole="button" onPress={() => router.push('/recordings')} style={{ padding: 12, paddingBottom: Math.max(12, insets.bottom), backgroundColor: colors.surface.panel }}>
    <Text style={{ color: colors.accent.primary }}>{failed ? m.indexError : m.returnToRecording}</Text>
  </Pressable>;
}
