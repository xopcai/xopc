import { useMutation } from '@tanstack/react-query';
import { useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, ScrollView, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { spacing, typography, useTheme } from '../../theme';
import { PrivacyScreen } from '../privacy/PrivacyScreen';
import { switchGatewayProfile } from './gateway-switch-service';
import { GatewayQrScannerModal, requestGatewayQrCameraAccess } from './GatewayQrScannerModal';
import { pairWithGateway, readPendingDevicePairing, cancelPendingDevicePairing, pauseDevicePairing, useDevicePairingFlow } from './pair-gateway';
import { parseGatewayQrPayload, type ParsedGatewayQr } from './parse-gateway-qr';

export type GatewayConnectLandingModalProps = { visible: boolean; onRequestClose: () => void };

export function GatewayConnectLandingModal({ visible, onRequestClose }: GatewayConnectLandingModalProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const m = useMessages();
  const copy = m.gatewayConnect;
  const f = copy.flow;
  const unauthorized = useGatewayStore(s => s.unauthorized);
  const profiles = useGatewayStore(s => s.profiles);
  const activeGatewayId = useGatewayStore(s => s.activeGatewayId);
  const progress = useDevicePairingFlow(s => s.progress);
  const flowError = useDevicePairingFlow(s => s.error);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<ParsedGatewayQr | null>(null);
  const controller = useRef<AbortController | null>(null);
  const wasReauth = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const errorCopy = (reason: unknown) => {
    const code = reason instanceof Error ? reason.message : '';
    if (code.includes('UPDATE_REQUIRED')) return f.update;
    if (code.includes('EXPIRED')) return f.expired;
    if (code.includes('REJECTED')) return f.rejected;
    if (code.includes('CANCELLED')) return f.cancelled;
    if (code.includes('IDENTITY')) return f.identity;
    if (code.includes('ALREADY_PENDING') || code.includes('BUSY')) return f.pending;
    return f.failed;
  };
  const pairing = useMutation({
    mutationFn: (qr: ParsedGatewayQr) => {
      wasReauth.current = unauthorized;
      controller.current?.abort();
      controller.current = new AbortController();
      return pairWithGateway(qr, controller.current.signal);
    },
    onSuccess: () => {
      setPending(null);
      if (!wasReauth.current) router.replace('/');
      onRequestClose();
    },
    onError: cause => {
      if (!controller.current?.signal.aborted) setError(errorCopy(cause));
      setPending(readPendingDevicePairing());
    },
  });

  useEffect(() => {
    if (visible) {
      setPending(readPendingDevicePairing());
    } else controller.current?.abort();
  }, [visible, flowError]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') { controller.current?.abort(); pauseDevicePairing(); }
      else setPending(readPendingDevicePairing());
    });
    return () => { subscription.remove(); controller.current?.abort(); };
  }, []);

  const openScanner = useCallback(async () => {
    const granted = await requestGatewayQrCameraAccess(cameraPermission, requestCameraPermission, () => setError(copy.cameraDenied));
    if (granted) setScannerOpen(true);
  }, [cameraPermission, copy.cameraDenied, requestCameraPermission]);
  const connect = (qr: ParsedGatewayQr) => { setScannerOpen(false); setError(''); pairing.mutate(qr); };
  const cancel = async () => {
    controller.current?.abort();
    try { await cancelPendingDevicePairing(); setPending(null); setError(''); }
    catch (cause) { setError(errorCopy(cause)); setPending(readPendingDevicePairing()); }
  };
  const paste = async () => {
    try {
      const qr = parseGatewayQrPayload(await Clipboard.getStringAsync());
      if (qr) connect(qr); else setError(copy.invalidPairingLink);
    } catch { setError(copy.invalidPairingLink); }
  };
  const busy = pairing.isPending || Boolean(progress);
  const displayedError = error || (flowError ? errorCopy(new Error(flowError)) : '');
  const waiting = progress?.stage === 'approval';
  const title = help ? f.installTitle : progress ? (waiting ? f.waiting : progress.stage === 'completing' ? f.completing : f.connecting) : f.title;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => { if (!busy) onRequestClose(); }}>
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: colors.surface.base }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
          {help ? <IconButton icon="arrow-left" onPress={() => setHelp(false)} accessibilityLabel={f.back} /> : <Text style={typography.title}>xopc</Text>}
          {profiles.length > 0 && !busy ? <IconButton icon="close" onPress={onRequestClose} accessibilityLabel={copy.close} /> : <View />}
        </View>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.lg }}>
          <Text accessibilityRole="header" style={[typography.largeTitle, { marginBottom: spacing.md }]}>{title}</Text>
          <Text style={[typography.body, { color: colors.text.secondary }]}>
            {help ? f.installSteps : progress ? progress.name : unauthorized ? copy.sessionExpired : f.hint}
          </Text>
          {waiting && progress.confirmationCode ? <View style={{ marginTop: spacing.xxl }}>
            <Text selectable style={[typography.display, { fontVariant: ['tabular-nums'], marginBottom: spacing.md }]}>
              {progress.confirmationCode.slice(0, 3)} {progress.confirmationCode.slice(3)}
            </Text>
            <Text style={[typography.label, { color: colors.text.secondary }]}>{f.compare}</Text>
          </View> : null}
          {displayedError ? <Text accessibilityRole="alert" style={{ marginTop: spacing.lg, color: colors.semantic.errorBold }}>{displayedError}</Text> : null}
          <View style={{ flex: 1, minHeight: spacing.xxl }} />
          <View style={{ gap: spacing.sm }}>
            {help ? <>
              <Button mode="contained" onPress={() => { void Clipboard.setStringAsync('https://xopc.ai').then(() => setCopied(true)); }}>{copied ? f.copied : f.copyDownload}</Button>
              <Button onPress={() => setHelp(false)}>{f.back}</Button>
            </> : <>
              {!progress && !pending ? <Button mode="contained" icon="qrcode-scan" onPress={() => void openScanner()}>{copy.scanQr}</Button> : null}
              {pending && !busy ? <Button mode="contained" onPress={() => connect(pending)}>{f.resume}</Button> : null}
              {(progress || pending) && progress?.stage !== 'completing' ? <Button onPress={() => void cancel()}>{f.cancel}</Button> : null}
              {!progress && !pending ? <Button onPress={() => setHelp(true)}>{f.install}</Button> : null}
              {!progress ? <Button onPress={() => setMore(v => !v)}>{f.more}</Button> : null}
              {error === copy.cameraDenied ? <Button onPress={() => void Linking.openSettings()}>{f.settings}</Button> : null}
              {more ? <>
                <Button disabled={busy} onPress={() => void paste()}>{copy.pastePairingLink}</Button>
                <Button onPress={() => setPrivacyOpen(true)}>{m.privacy.title}</Button>
                {profiles.filter(p => p.gatewayId !== activeGatewayId).map(p => <Button key={p.gatewayId} disabled={busy} onPress={() => {
                  void switchGatewayProfile(p.gatewayId).then(r => { if (r.status === 'failed') setError(f.failed); else onRequestClose(); });
                }}>{p.name}</Button>)}
              </> : null}
            </>}
          </View>
        </ScrollView>
        {!progress && !help ? <Text style={[typography.caption, { textAlign: 'center', padding: spacing.lg, color: colors.text.secondary }]}>{f.requirement}</Text> : null}
        <GatewayQrScannerModal embedded visible={scannerOpen} onRequestClose={() => setScannerOpen(false)} onScanned={connect} onCameraDenied={() => setError(copy.cameraDenied)} />
        <Modal visible={privacyOpen} animationType="slide" onRequestClose={() => setPrivacyOpen(false)}><PrivacyScreen onClose={() => setPrivacyOpen(false)} /></Modal>
      </View>
    </Modal>
  );
}
