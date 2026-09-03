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
import { usePreferencesStore } from '../../stores/preferences-store';
import { spacing, typography, useTheme } from '../../theme';
import { PrivacyScreen } from '../privacy/PrivacyScreen';
import { switchGatewayProfile } from './gateway-switch-service';
import { GatewayQrScannerModal, requestGatewayQrCameraAccess } from './GatewayQrScannerModal';
import { pairWithGateway, readPendingDevicePairing, cancelPendingDevicePairing, pauseDevicePairing, useDevicePairingFlow } from './pair-gateway';
import type { ParsedGatewayQr } from './parse-gateway-qr';
import { GatewayPairingInputActions } from './GatewayPairingInputActions';
import { useGatewayPairingInput } from './use-gateway-pairing-input';

export type GatewayConnectLandingModalProps = { visible: boolean; onRequestClose: () => void };

export function GatewayConnectLandingModal({ visible, onRequestClose }: GatewayConnectLandingModalProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const m = useMessages();
  const copy = m.gatewayConnect;
  const f = copy.flow;
  const language = usePreferencesStore(s => s.language);
  const setLanguage = usePreferencesStore(s => s.setLanguage);
  const unauthorized = useGatewayStore(s => s.unauthorized);
  const profiles = useGatewayStore(s => s.profiles);
  const activeGatewayId = useGatewayStore(s => s.activeGatewayId);
  const progress = useDevicePairingFlow(s => s.progress);
  const flowError = useDevicePairingFlow(s => s.error);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<keyof typeof f | 'cameraDenied' | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<ParsedGatewayQr | null>(null);
  const controller = useRef<AbortController | null>(null);
  const wasReauth = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const errorKey = (reason: unknown): keyof typeof f => {
    const code = reason instanceof Error ? reason.message : '';
    if (code.includes('UPDATE_REQUIRED')) return 'update';
    if (code.includes('EXPIRED')) return 'expired';
    if (code.includes('REJECTED')) return 'rejected';
    if (code.includes('CANCELLED')) return 'cancelled';
    if (code.includes('IDENTITY')) return 'identity';
    if (code.includes('ALREADY_PENDING') || code.includes('BUSY')) return 'pending';
    return 'failed';
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
      if (!controller.current?.signal.aborted) setError(errorKey(cause));
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
    const granted = await requestGatewayQrCameraAccess(cameraPermission, requestCameraPermission, () => setError('cameraDenied'));
    if (granted) setScannerOpen(true);
  }, [cameraPermission, requestCameraPermission]);
  const connect = (qr: ParsedGatewayQr) => { setScannerOpen(false); setError(null); pairing.mutate(qr); };
  const input = useGatewayPairingInput(connect, visible && !scannerOpen && !help && !pairing.isPending && !progress && !pending);
  const cancel = async () => {
    controller.current?.abort();
    try { await cancelPendingDevicePairing(); setPending(null); setError(null); }
    catch (cause) { setError(errorKey(cause)); setPending(readPendingDevicePairing()); }
  };
  const busy = pairing.isPending || Boolean(progress) || input.busy;
  const displayedError = error === 'cameraDenied'
    ? copy[error]
    : error ? f[error] : flowError ? f[errorKey(new Error(flowError))] : '';
  const waiting = progress?.stage === 'approval';
  const title = help ? f.installTitle : progress ? (waiting ? f.waiting : progress.stage === 'completing' ? f.completing : f.connecting) : f.title;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => { if (!busy) onRequestClose(); }}>
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: colors.surface.base }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
          {help ? <IconButton icon="arrow-left" onPress={() => setHelp(false)} accessibilityLabel={f.back} /> : <Text style={typography.title}>xopc</Text>}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Button
              mode="text"
              icon="translate"
              textColor={colors.text.secondary}
              contentStyle={{ minHeight: spacing.xxxl }}
              accessibilityLabel={`${m.settings.language}: ${language === 'en' ? m.settings.languageZh : m.settings.languageEn}`}
              onPress={() => setLanguage(language === 'en' ? 'zh' : 'en')}
            >
              {language === 'en' ? m.settings.languageZh : m.settings.languageEn}
            </Button>
            {profiles.length > 0 && !busy ? <IconButton icon="close" onPress={onRequestClose} accessibilityLabel={copy.close} /> : null}
          </View>
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
              {!progress && !pending ? <>
                <Button mode="contained" icon="qrcode-scan" disabled={busy} onPress={() => void openScanner()}>{copy.scanQr}</Button>
                <GatewayPairingInputActions input={input} disabled={busy} />
              </> : null}
              {pending && !busy ? <Button mode="contained" onPress={() => connect(pending)}>{f.resume}</Button> : null}
              {(progress || pending) && progress?.stage !== 'completing' ? <Button onPress={() => void cancel()}>{f.cancel}</Button> : null}
              {!progress && !pending ? <Button disabled={busy} onPress={() => setHelp(true)}>{f.install}</Button> : null}
              {!progress ? <Button onPress={() => setMore(v => !v)}>{f.more}</Button> : null}
              {error === 'cameraDenied' ? <Button onPress={() => void Linking.openSettings()}>{f.settings}</Button> : null}
              {more ? <>
                <Button onPress={() => setPrivacyOpen(true)}>{m.privacy.title}</Button>
                {profiles.filter(p => p.gatewayId !== activeGatewayId).map(p => <Button key={p.gatewayId} disabled={busy} onPress={() => {
                  void switchGatewayProfile(p.gatewayId).then(r => { if (r.status === 'failed') setError('failed'); else onRequestClose(); });
                }}>{p.name}</Button>)}
              </> : null}
            </>}
          </View>
        </ScrollView>
        {!progress && !help ? <Text style={[typography.caption, { textAlign: 'center', padding: spacing.lg, color: colors.text.secondary }]}>{f.requirement}</Text> : null}
        <GatewayQrScannerModal embedded visible={scannerOpen} onRequestClose={() => setScannerOpen(false)} onScanned={connect} onCameraDenied={() => setError('cameraDenied')} />
        <Modal visible={privacyOpen} animationType="slide" onRequestClose={() => setPrivacyOpen(false)}><PrivacyScreen onClose={() => setPrivacyOpen(false)} /></Modal>
      </View>
    </Modal>
  );
}
