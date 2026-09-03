import { useMutation } from '@tanstack/react-query';
import { testWorkComputer } from './test-work-computer';
import { useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, RadioButton, Text, TextInput } from 'react-native-paper';

import { NativeScreenHeader } from '@/components/NativeScreenHeader';
import { useSettingsColors } from '@/features/settings/settings-ui';
import { useMessages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';

import { GatewayQrScannerModal, requestGatewayQrCameraAccess } from './GatewayQrScannerModal';
import { pairWithGateway } from './pair-gateway';
import type { ParsedGatewayQr } from './parse-gateway-qr';
import { GatewayPairingInputActions } from './GatewayPairingInputActions';
import { useGatewayPairingInput } from './use-gateway-pairing-input';

export function GatewayEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const m = useMessages();
  const s = m.settings;
  const copy = m.gatewayConnect;
  const colors = useSettingsColors();
  const profile = useGatewayStore((state) => state.profiles.find((item) => item.gatewayId === id) ?? null);
  const renameProfile = useGatewayStore((state) => state.renameProfile);
  const removeProfile = useGatewayStore((state) => state.removeProfile);
  const selectRoute = useGatewayStore((state) => state.selectRoute);
  const [details, setDetails] = useState(false);
  const test = useMutation({ mutationFn: () => testWorkComputer(id) });
  const [name, setName] = useState(profile?.name ?? '');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  useEffect(() => setName(profile?.name ?? ''), [profile?.name]);
  useEffect(() => {
    if (!isNew && !profile) router.replace('/settings/gateway');
  }, [isNew, profile, router]);

  const openScanner = useCallback(async () => {
    const granted = await requestGatewayQrCameraAccess(
      cameraPermission,
      requestCameraPermission,
      () => setError(copy.cameraDenied),
    );
    if (granted) setScannerOpen(true);
  }, [cameraPermission, copy.cameraDenied, requestCameraPermission]);

  const connect = useCallback((pairing: ParsedGatewayQr) => {
    setScannerOpen(false);
    setBusy(true);
    setError('');
    void pairWithGateway(pairing)
      .then(() => router.replace('/'))
      .catch(() => setError(copy.connectFailed))
      .finally(() => setBusy(false));
  }, [copy.connectFailed, router]);
  const input = useGatewayPairingInput(connect, isNew && !scannerOpen && !busy);

  const confirmDelete = useCallback(() => {
    if (!profile) return;
    Alert.alert(s.deleteGateway, s.deleteGatewayConfirm, [
      { text: m.common.cancel, style: 'cancel' },
      {
        text: s.deleteGateway,
        style: 'destructive',
        onPress: () => {
          removeProfile(profile.gatewayId);
          router.replace('/settings/gateway');
        },
      },
    ]);
  }, [m.common.cancel, profile, removeProfile, router, s.deleteGateway, s.deleteGatewayConfirm]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
      <NativeScreenHeader title={isNew ? s.newGateway : s.editGateway} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        {isNew ? (
          <>
            <Text variant="bodyMedium" style={{ color: colors.textMuted }}>{copy.subline}</Text>
            <Button mode="contained" icon="qrcode-scan" loading={busy} disabled={busy || input.busy} onPress={() => void openScanner()}>
              {copy.scanQr}
            </Button>
            <GatewayPairingInputActions input={input} disabled={busy} />
          </>
        ) : profile ? (
          <>
            <TextInput label={s.gatewayName} value={name} onChangeText={setName} mode="outlined" />
            <Button mode="contained" disabled={!name.trim()} onPress={() => renameProfile(profile.gatewayId, name)}>
              {s.save}
            </Button>
            <Button mode="outlined" loading={test.isPending} disabled={test.isPending} onPress={() => test.mutate()}>{copy.flow.test}</Button>
            <Text style={{ color: colors.textMuted }}>{test.isSuccess ? test.data === 'cellular' ? copy.flow.testCellular : copy.flow.testCurrent : test.isError ? test.error.message === 'SWITCH_COMPUTER' ? copy.flow.testSwitch : copy.flow.testFailed : copy.flow.testHint}</Text>
            <Button onPress={() => setDetails(v => !v)}>{copy.flow.details}</Button>
            {details ? <>
            <Text variant="titleSmall">{s.secureRoutes}</Text>
            <RadioButton.Group value={profile.activeRouteId} onValueChange={(routeId) => selectRoute(profile.gatewayId, routeId)}>
              {profile.routes.map((route) => (
                <RadioButton.Item key={route.id} value={route.id} label={`${route.kind} · ${route.url}`} />
              ))}
            </RadioButton.Group>
            </> : null}
            <Button mode="outlined" textColor={colors.error} onPress={confirmDelete}>{s.deleteGateway}</Button>
          </>
        ) : null}
        {error ? <Text style={{ color: colors.error }}>{error}</Text> : null}
      </ScrollView>
      <GatewayQrScannerModal
        visible={scannerOpen}
        onRequestClose={() => setScannerOpen(false)}
        onScanned={connect}
        onCameraDenied={() => setError(copy.cameraDenied)}
      />
    </View>
  );
}

const styles = StyleSheet.create({ content: { padding: 20, gap: 16 } });
