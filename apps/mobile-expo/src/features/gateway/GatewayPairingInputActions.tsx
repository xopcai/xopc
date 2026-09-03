import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { darkColors, spacing, useTheme } from '../../theme';
import type { useGatewayPairingInput } from './use-gateway-pairing-input';

export function GatewayPairingInputActions({ input, disabled = false, overCamera = false }: {
  input: ReturnType<typeof useGatewayPairingInput>;
  disabled?: boolean;
  overCamera?: boolean;
}) {
  const copy = useMessages().gatewayConnect;
  const theme = useTheme();
  const colors = overCamera ? darkColors : theme.colors;
  return <View style={{ gap: spacing.xs }}>
    <Button icon="content-paste" disabled={disabled || input.busy} loading={input.source === 'clipboard'}
      textColor={colors.text.secondary} contentStyle={{ minHeight: spacing.xxxl }} onPress={() => void input.read('clipboard')}>
      {copy.pastePairingLink}
    </Button>
    <Button icon="image-outline" disabled={disabled || input.busy} loading={input.source === 'image'}
      textColor={colors.text.secondary} contentStyle={{ minHeight: spacing.xxxl }} onPress={() => void input.read('image')}>
      {copy.pickQrImage}
    </Button>
    {input.error ? <Text accessibilityRole="alert" style={{ color: colors.semantic.errorBold }}>{copy[input.error]}</Text> : null}
  </View>;
}
