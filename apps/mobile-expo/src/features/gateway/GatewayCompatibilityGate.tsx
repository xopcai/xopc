import { Modal } from 'react-native';
import { Button, Dialog, Text } from 'react-native-paper';

import type { RealtimeCompatibilityErrorCode } from '@xopcai/realtime-protocol';

import { useMessages } from '../../i18n/messages';

type GatewayCompatibilityGateProps = {
  issue: RealtimeCompatibilityErrorCode | null;
  visible: boolean;
  onRetry: () => void;
  onUpdateApp: () => void;
  onManageGateway: () => void;
};

export function GatewayCompatibilityGate({
  issue,
  visible,
  onRetry,
  onUpdateApp,
  onManageGateway,
}: GatewayCompatibilityGateProps) {
  const copy = useMessages().gateway.compatibility;
  const clientUpdateRequired = issue === 'CLIENT_UPDATE_REQUIRED';

  return (
    <Modal visible={visible && issue !== null} transparent animationType="fade" onRequestClose={() => {}}>
      <Dialog visible={visible && issue !== null} dismissable={false}>
        <Dialog.Title>
          {clientUpdateRequired ? copy.clientTitle : copy.gatewayTitle}
        </Dialog.Title>
        <Dialog.Content>
          <Text>
            {clientUpdateRequired ? copy.clientDescription : copy.gatewayDescription}
          </Text>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={clientUpdateRequired ? onUpdateApp : onManageGateway}>
            {clientUpdateRequired ? copy.updateApp : copy.manageGateway}
          </Button>
          <Button mode="contained" onPress={onRetry}>{copy.retry}</Button>
        </Dialog.Actions>
      </Dialog>
    </Modal>
  );
}
