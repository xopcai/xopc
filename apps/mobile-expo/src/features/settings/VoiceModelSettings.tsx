import { useState } from 'react';
import { FlatList } from 'react-native';
import { Dialog, Portal, RadioButton, Text } from 'react-native-paper';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { VoiceSelection } from '@xopcai/realtime-protocol/voice';
import { voiceCatalogOptions, updateVoiceSelection } from '../../query/voice';
import { useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { useTheme } from '../../theme';
import { ListSkeleton } from '../../components/ListSkeleton';
import { SettingsRow, SettingsSection } from './settings-ui';

export function VoiceModelSettings() {
  const gatewayId = useGatewayStore(state => state.activeGatewayId);
  const {voice: m} = useMessages();
  const {colors} = useTheme();
  const catalog = useQuery({...voiceCatalogOptions(gatewayId), enabled: Boolean(gatewayId)});
  const [picker, setPicker] = useState<{mode: VoiceSelection['mode']; voices: boolean} | null>(null);
  const mutation = useMutation({
    mutationFn: (selection?: VoiceSelection) => {
      if (!gatewayId || !catalog.data) throw new Error('SERVICE_UNAVAILABLE');
      return updateVoiceSelection(gatewayId, catalog.data.revision, selection);
    },
    onSuccess: () => setPicker(null),
    onError: () => { void catalog.refetch(); },
    retry: false,
  });
  const modes: Array<[VoiceSelection['mode'], string]> = [['transcription', m.recordedModel], ['transcription.stream', m.dictationModel], ['speech', m.readoutModel], ['speech.stream', m.assistantVoiceModel], ['conversation', m.conversationModel]];
  const selected = catalog.data?.selections.find(item => item.mode === picker?.mode);
  const selectedModel = catalog.data?.models.find(item => item.id === selected?.model);
  const options: Array<{id:string; name:string}> = picker?.voices ? selectedModel?.voice.voices ?? [] : catalog.data?.models.filter(model => picker && model.voice.modes.includes(picker.mode)) ?? [];
  return <>
    <SettingsSection title={m.modelSettings}>
      <Text style={{color: colors.text.secondary}}>{m.sharedSettings}</Text>
      {catalog.isPending ? <ListSkeleton count={5} /> : modes.map(([mode, label]) => {
        const selection = catalog.data?.selections.find(item => item.mode === mode);
        const model = catalog.data?.models.find(item => item.id === selection?.model && item.voice.modes.includes(mode));
        return <SettingsRow key={mode} icon="waveform" label={label} value={model?.name ?? (selection ? `${selection.model} · ${m.unavailable}` : m.chooseModel)} onPress={mutation.isPending ? undefined : () => setPicker({mode, voices:false})} />;
      })}
      {modes.map(([mode, label]) => {
        const selection = catalog.data?.selections.find(item => item.mode === mode);
        const model = catalog.data?.models.find(item => item.id === selection?.model);
        return model?.voice.voices.length ? <SettingsRow key={`${mode}-voice`} icon="account-voice" label={`${label} · ${m.chooseVoice}`} value={selection?.voice} onPress={mutation.isPending ? undefined : () => setPicker({mode, voices:true})} /> : null;
      })}
      {mutation.error || catalog.error ? <Text style={{color: colors.semantic.error}}>{mutation.error?.message === 'SETTINGS_CHANGED' ? m.settingsChanged : mutation.error?.message === 'VOICE_CONFIGURE_FORBIDDEN' ? m.configureForbidden : m.selectionFailed}</Text> : null}
      <SettingsRow icon="refresh" label={m.refresh} isLast onPress={mutation.isPending ? undefined : () => catalog.data ? mutation.mutate(undefined) : void catalog.refetch()} />
    </SettingsSection>
    <Portal><Dialog visible={Boolean(picker)} onDismiss={() => !mutation.isPending && setPicker(null)}>
      <Dialog.Title>{picker?.voices ? m.chooseVoice : m.chooseModel}</Dialog.Title>
      <Dialog.ScrollArea style={{maxHeight: 360}}><FlatList data={options} keyExtractor={item => item.id} renderItem={({item}) => <RadioButton.Item label={item.name} value={item.id} status={(picker?.voices ? selected?.voice : selected?.model) === item.id ? 'checked' : 'unchecked'} disabled={mutation.isPending} onPress={() => {
        if (!picker) return;
        mutation.mutate(picker.voices && selected ? {...selected, voice:item.id} : {mode:picker.mode, model:item.id});
      }} />} ListEmptyComponent={<Text>{m.unavailable}</Text>} /></Dialog.ScrollArea>
    </Dialog></Portal>
  </>;
}
