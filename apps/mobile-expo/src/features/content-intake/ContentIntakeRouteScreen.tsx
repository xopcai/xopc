import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useGatewayConfigured } from '@/query/sessions';
import { getColors, useTheme } from '@/theme';

import { ContentIntakeModal } from './ContentIntakeModal';
import { analyzeIntakeContent, shouldOfferContentIntake } from './content-intent';
import { buildRouteIntakeText } from './route-intake';
import { savedContentRoute } from './save-navigation';
import { useContentIntakeActions, type ContentIntakeCandidate } from './use-content-intake-actions';

export function ContentIntakeRouteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ text?: string | string[]; url?: string | string[]; title?: string | string[] }>();
  const configured = useGatewayConfigured();
  const { isDark } = useTheme();
  const [handled, setHandled] = useState(false);
  const candidate = useMemo<ContentIntakeCandidate | null>(() => {
    if (!configured) return null;
    const text = buildRouteIntakeText(params);
    if (!shouldOfferContentIntake(text)) return null;
    return { text, intent: analyzeIntakeContent(text), source: 'share' };
  }, [configured, params]);

  const markHandled = useCallback(() => setHandled(true), []);
  const { saving, toast, setToast, saveToNote, exploreInChat } = useContentIntakeActions(markHandled, {
    chatNavigation: 'replace',
  });

  useEffect(() => {
    if (!candidate) router.replace('/');
  }, [candidate, router]);

  const handleSave = useCallback(async () => {
    if (!candidate || saving) return;
    const result = await saveToNote(candidate);
    if (result.status !== 'ignored') router.replace(savedContentRoute(result));
  }, [candidate, router, saveToNote, saving]);

  const handleExplore = useCallback(() => {
    if (!candidate || saving) return;
    exploreInChat(candidate);
  }, [candidate, exploreInChat, saving]);

  return (
    <View style={[styles.root, { backgroundColor: getColors(isDark).surface.base }]}>
      <ContentIntakeModal
        visible={Boolean(candidate) && !handled}
        intent={candidate?.intent ?? null}
        saving={saving}
        toast={toast}
        onSave={() => void handleSave()}
        onExplore={handleExplore}
        onDismiss={() => {
          markHandled();
          router.replace('/');
        }}
        onToastDismiss={() => setToast('')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
