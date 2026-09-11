import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Switch, Text } from 'react-native-paper';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ListSkeleton } from '../../components/ListSkeleton';
import { VoicePreview } from '../voice/voice-preview';
import { useVoiceCall } from '../voice/voice-call';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { voiceStatusOptions } from '../../query/voice';
import { useVoicePreferences } from '../voice/voice-preferences';
import { SettingsRow, SettingsSection } from './settings-ui';
import { spacing, typography, useTheme } from '../../theme';
import { voiceErrorMessage } from '../voice/voice-error';
import { nativeVoiceAvailable } from '../voice/native-audio-session';

export function VoiceSettingsScreen() {
  const { voice: m } = useMessages();
  const { colors } = useTheme();
  const router = useRouter();
  const gatewayId = useGatewayStore(s => s.activeGatewayId);
  const status = useQuery({ ...voiceStatusOptions(gatewayId), enabled: Boolean(gatewayId) });
  const prefs = useVoicePreferences();
  const call = useVoiceCall();
  const [preview] = useState(() => new VoicePreview());
  const playPreview = useMutation({ mutationFn: () => preview.play(), retry: false });
  useEffect(() => () => preview.stop(), [preview, gatewayId]);
  const selected = gatewayId ? prefs.modes[gatewayId] : undefined;
  return <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
    <NativeScreenHeader title={m.settings} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {!nativeVoiceAvailable ? <Text style={[styles.notice, { color: colors.text.secondary }]}>{m.upgrade}</Text> : null}
      <SettingsSection title={m.mode}>
        {([undefined, 'natural', 'assistant'] as const).map((mode, index) => <SettingsRow key={mode ?? 'default'}
          icon={selected === mode ? 'radiobox-marked' : 'radiobox-blank'}
          label={mode === 'natural' ? m.chatOnly : mode === 'assistant' ? m.tools : m.followGateway}
          value={mode && status.data && !status.data.capabilities[mode].available ? m.unavailable : undefined}
          isLast={index === 2}
          showChevron={false}
          onPress={!gatewayId || (mode && !status.data?.capabilities[mode].available) ? undefined : () => {
            if (!gatewayId) return;
            const modes = { ...prefs.modes }; if (mode) modes[gatewayId] = mode; else delete modes[gatewayId];
            prefs.update({ modes });
          }} />)}
      </SettingsSection>
      <SettingsSection title={m.nextCall}>
        <SettingsRow icon="closed-caption-outline" label={m.captions} showChevron={false} rightAccessory={<Switch value={prefs.captions} onValueChange={captions => prefs.update({ captions })} />} />
        <SettingsRow icon="phone-outline" label={m.background} isLast showChevron={false} rightAccessory={<Switch value={prefs.background} onValueChange={background => prefs.update({ background })} />} />
      </SettingsSection>
      <SettingsSection title={m.service}>
        {status.isPending && gatewayId ? <ListSkeleton count={3} /> :
          status.data ? (['dictation', 'natural', 'assistant'] as const).map((kind, index) => <SettingsRow key={kind} icon="waveform" label={kind === 'dictation' ? m.dictation : kind === 'natural' ? m.chatOnly : m.tools} value={status.data.capabilities[kind].available ? m.ready : m.unavailable} isLast={index === 2} showChevron={false} />) : <Text style={[styles.notice, { color: colors.semantic.error }]}>{voiceErrorMessage(status.error?.message ?? 'SERVICE_UNAVAILABLE', m)}</Text>}
      </SettingsSection>
      {status.data && <SettingsSection>
        <SettingsRow icon="translate" label={m.languages} value={status.data.capabilities.languages.map(language => language === 'zh' ? m.languageZh : m.languageEn).join(' / ')} showChevron={false} />
        <SettingsRow icon="microphone" label={m.bargeIn} value={status.data.capabilities.bargeIn ? m.supported : m.notSupported} isLast showChevron={false} />
      </SettingsSection>}
      <SettingsSection>
        <SettingsRow
          icon="play-circle-outline"
          label={m.preview}
          value={playPreview.isPending ? m.connecting : playPreview.isError ? m.error : undefined}
          onPress={call.phase !== 'idle' || playPreview.isPending || (selected ?? status.data?.defaultMode) !== 'assistant' || !status.data?.capabilities.assistant.available ? undefined : () => playPreview.mutate()}
        />
        <SettingsRow
          icon="tune-variant"
          label={m.manage}
          onPress={() => {
            const url = new URL(useGatewayStore.getState().apiUrl('/'));
            if (url.protocol !== 'https:') return;
            url.hash = '/settings/capabilities/voice';
            void Linking.openURL(url.toString());
          }}
        />
        <SettingsRow icon="refresh" label={m.refresh} isLast onPress={() => void status.refetch()} />
      </SettingsSection>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.content,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
  },
  notice: {
    ...typography.label,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
});
