import { useEffect } from 'react';
import { AppState, Modal, ScrollView, View } from 'react-native';
import { Button, Dialog, Text } from 'react-native-paper';

import { t, useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { spacing } from '../../theme';
import { useDataSharingPrompt } from './data-sharing-consent';

export function DataSharingConsentDialog() {
  const prompt = useDataSharingPrompt((state) => state.prompt);
  const gatewayId = useGatewayStore((state) => state.activeGatewayId);
  const gatewayName = useGatewayStore((state) => state.getActiveProfile()?.name ?? '');
  const m = useMessages().privacy;

  useEffect(() => {
    if (prompt && prompt.gatewayId !== gatewayId) prompt.finish(false);
  }, [gatewayId, prompt]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') useDataSharingPrompt.getState().prompt?.finish(false);
    });
    return () => listener.remove();
  }, []);

  return (
    <Modal visible={Boolean(prompt)} transparent animationType="fade" onRequestClose={() => prompt?.finish(false)}>
      <Dialog visible={Boolean(prompt)} onDismiss={() => prompt?.finish(false)} style={{ maxHeight: '85%' }}>
        <Dialog.Title>{m.consentTitle}</Dialog.Title>
        <Dialog.ScrollArea>
          <ScrollView contentContainerStyle={{ paddingVertical: spacing.md, gap: spacing.md }}>
            <Text>{t(m.consentDescription, { gateway: gatewayName })}</Text>
            <Text>{m.dataTypes}</Text>
            <Text variant="titleSmall">{m.recipients}</Text>
            {prompt?.disclosure.recipients.map((recipient) => (
              <View key={`${recipient.capability}:${recipient.id}:${recipient.origin ?? ''}`}>
                <Text>{recipient.name} · {m[recipient.capability]}</Text>
                {recipient.origin ? <Text variant="bodySmall">{recipient.origin}</Text> : null}
              </View>
            ))}
            {!prompt?.disclosure.recipients.length ? <Text>{m.noRecipients}</Text> : null}
            <Text>{m.providerNotice}</Text>
            <Text>{m.revocationNotice}</Text>
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={() => prompt?.finish(false)}>{m.decline}</Button>
          <Button onPress={() => prompt?.finish(true)}>{m.agree}</Button>
        </Dialog.Actions>
      </Dialog>
    </Modal>
  );
}
