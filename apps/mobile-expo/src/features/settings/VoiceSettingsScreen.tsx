import { useEffect, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { Button, Switch, Text } from 'react-native-paper';
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
import { spacing, useTheme } from '../../theme';
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
  const selected = gatewayId ? prefs.engines[gatewayId] : undefined;
  return <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
    <NativeScreenHeader title={m.settings} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
      {!nativeVoiceAvailable && <Text>{m.upgrade}</Text>}
      <SettingsSection title={m.mode}>
        {([undefined, 'omni', 'agent'] as const).map(engine => <SettingsRow key={engine ?? 'default'}
          icon={selected === engine ? 'radiobox-marked' : 'radiobox-blank'}
          label={engine === 'omni' ? m.chatOnly : engine === 'agent' ? m.tools : m.followGateway}
          value={engine && status.data && !status.data.capabilities[engine].available ? m.unavailable : undefined}
          showChevron={false}
          onPress={!gatewayId || (engine && !status.data?.capabilities[engine].available) ? undefined : () => {
            if (!gatewayId) return;
            const engines = { ...prefs.engines }; if (engine) engines[gatewayId] = engine; else delete engines[gatewayId];
            prefs.update({ engines });
          }} />)}
      </SettingsSection>
      <Text>{m.nextCall}</Text>
      <SettingsSection>
        <SettingsRow icon="closed-caption-outline" label={m.captions} showChevron={false} rightAccessory={<Switch value={prefs.captions} onValueChange={captions => prefs.update({ captions })} />} />
        <SettingsRow icon="phone-outline" label={m.background} showChevron={false} rightAccessory={<Switch value={prefs.background} onValueChange={background => prefs.update({ background })} />} />
      </SettingsSection>
      <Text>{m.backgroundHint}</Text>
      <SettingsSection title={m.service}>
        {status.isPending && gatewayId ? <ListSkeleton count={3} /> :
          status.data ? (['dictation', 'omni', 'agent'] as const).map(kind => <SettingsRow key={kind} icon="waveform" label={kind === 'dictation' ? m.dictation : kind === 'omni' ? m.chatOnly : m.tools} value={status.data.capabilities[kind].available ? m.ready : m.unavailable} showChevron={false} />) : <Text>{voiceErrorMessage(status.error?.message ?? 'SERVICE_UNAVAILABLE', m)}</Text>}
      </SettingsSection>
      <Text>{m.serviceHint}</Text>
      {status.data && <SettingsSection>
        <SettingsRow icon="translate" label={m.languages} value={status.data.capabilities.languages.map(language => language === 'zh' ? m.languageZh : m.languageEn).join(' / ')} showChevron={false} />
        <SettingsRow icon="microphone" label={m.bargeIn} value={status.data.capabilities.bargeIn ? m.supported : m.notSupported} showChevron={false} />
      </SettingsSection>}
      <Button loading={playPreview.isPending} disabled={call.phase !== 'idle' || playPreview.isPending || (selected ?? status.data?.defaultEngine) !== 'agent' || !status.data?.capabilities.agent.available} onPress={() => playPreview.mutate()}>{m.preview}</Button>
      {playPreview.isError && <Text>{m.error}</Text>}
      <Text>{m.previewHint}</Text>
      <Button onPress={() => {
        const url = new URL(useGatewayStore.getState().apiUrl('/'));
        if (url.protocol !== 'https:') return;
        url.hash = '/settings/capabilities/voice';
        void Linking.openURL(url.toString());
      }}>{m.manage}</Button>
      <Button onPress={() => void status.refetch()}>{m.refresh}</Button>
    </ScrollView>
  </View>;
}
