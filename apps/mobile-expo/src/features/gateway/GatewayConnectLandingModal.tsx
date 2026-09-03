import { useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Modal, StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { useTheme } from '../../theme';
import { switchGatewayProfile } from './gateway-switch-service';
import { GatewayQrScannerModal, requestGatewayQrCameraAccess } from './GatewayQrScannerModal';
import { navigateHomeAfterGatewayConnect } from './navigate-after-gateway-connect';
import { pairWithGateway } from './pair-gateway';
import { parseGatewayQrPayload, type ParsedGatewayQr } from './parse-gateway-qr';
import { PrivacyScreen } from '../privacy/PrivacyScreen';

export type GatewayConnectLandingModalProps = { visible: boolean; onRequestClose: () => void };

export function GatewayConnectLandingModal({ visible, onRequestClose }: GatewayConnectLandingModalProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const m = useMessages();
  const copy = m.gatewayConnect;
  const unauthorized = useGatewayStore((state) => state.unauthorized);
  const profiles = useGatewayStore((state) => state.profiles);
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  useEffect(() => {
    if (!visible || !unauthorized) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [unauthorized, visible]);

  const openScanner = useCallback(async () => {
    const granted = await requestGatewayQrCameraAccess(
      cameraPermission,
      requestCameraPermission,
      () => setError(copy.cameraDenied),
    );
    if (granted) setScannerOpen(true);
  }, [cameraPermission, copy.cameraDenied, requestCameraPermission]);

  const connect = useCallback((pairing: ParsedGatewayQr) => {
    setBusy(true);
    setError('');
    void pairWithGateway(pairing)
      .then(() => navigateHomeAfterGatewayConnect(router.replace))
      .catch((cause) => setError(cause instanceof Error ? cause.message : copy.connectFailed))
      .finally(() => setBusy(false));
  }, [copy.connectFailed, router.replace]);

  const pastePairingLink = async () => {
    try {
      const pairing = parseGatewayQrPayload(await Clipboard.getStringAsync());
      if (pairing) connect(pairing);
      else setError(copy.invalidPairingLink);
    } catch { setError(copy.invalidPairingLink); }
  };

  const switchProfile = useCallback((gatewayId: string) => {
    setBusy(true);
    setError('');
    void switchGatewayProfile(gatewayId)
      .then((result) => {
        if (result.status === 'failed') setError(result.error.message);
        else if (result.status !== 'superseded') router.replace('/');
      })
      .finally(() => setBusy(false));
  }, [router]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={unauthorized ? undefined : onRequestClose}>
      <View style={[styles.root, { paddingTop: insets.top, backgroundColor: colors.surface.base }]}>
        <View style={styles.header}>
          <View style={styles.headerSide} />
          <Text variant="titleMedium">{copy.title}</Text>
          {unauthorized ? <View style={styles.headerSide} /> : (
            <IconButton icon="close" onPress={onRequestClose} accessibilityLabel={copy.close} />
          )}
        </View>
        <View style={styles.content}>
          <Text variant="headlineSmall" style={styles.title}>{copy.headline}</Text>
          <Text variant="bodyMedium" style={{ color: colors.text.secondary }}>{copy.subline}</Text>
          {unauthorized ? <Text style={{ color: colors.semantic.errorBold }}>{copy.sessionExpired}</Text> : null}
          <Text variant="bodySmall" style={{ color: colors.text.secondary }}>
            {copy.step1}{'\n'}{copy.step2}{'\n'}{copy.step3}
          </Text>
          <Button mode="contained" icon="qrcode-scan" loading={busy} disabled={busy} onPress={() => void openScanner()}>
            {copy.scanQr}
          </Button>
          <Button disabled={busy} onPress={() => void pastePairingLink()}>{copy.pastePairingLink}</Button>
          <Button onPress={() => setPrivacyOpen(true)}>{m.privacy.title}</Button>
          {error ? <Text style={{ color: colors.semantic.errorBold }}>{error}</Text> : null}
          {profiles.filter((profile) => profile.gatewayId !== activeGatewayId).map((profile) => (
            <Button key={profile.gatewayId} mode="outlined" disabled={busy} onPress={() => switchProfile(profile.gatewayId)}>
              {profile.name}
            </Button>
          ))}
        </View>
        <Modal visible={privacyOpen} animationType="slide" onRequestClose={() => setPrivacyOpen(false)}>
          <PrivacyScreen onClose={() => setPrivacyOpen(false)} />
        </Modal>
        <GatewayQrScannerModal
          embedded
          visible={scannerOpen}
          onRequestClose={() => setScannerOpen(false)}
          onScanned={connect}
          onCameraDenied={() => setError(copy.cameraDenied)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerSide: { width: 48 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 20 },
  title: { fontWeight: '700' },
});
