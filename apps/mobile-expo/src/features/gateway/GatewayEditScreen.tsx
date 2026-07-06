import { zodResolver } from '@hookform/resolvers/zod';
import { useCameraPermissions } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { AppToast } from '@/components/AppToast';
import { FloatingHeader } from '@/components/FloatingHeader';
import { type GatewayProfileForm, gatewayProfileSchema } from '@/config/schema';
import { TOAST_DURATION_LONG, TOAST_DURATION_SHORT } from '@/constants/toast';
import { useSettingsColors } from '@/features/settings/settings-ui';
import { useMessages } from '@/i18n/messages';
import { useGatewayConfigured } from '@/query/sessions';
import { DEFAULT_GATEWAY_BASE_URL, useGatewayStore } from '@/stores/gateway-store';
import { gatewayProfileNameFromUrl } from '@/stores/gateway-types';

import { syncGatewayUrlsFromTunnelQr } from './apply-tunnel-qr-from-api';
import { syncAfterGatewaySettingsSave } from './gateway-connection-sync';
import { openDefaultSessionAfterConnect } from './navigate-after-gateway-connect';
import {
  gatewayUrlValidationMessage,
  zodGatewayBaseUrlErrorMessage,
} from './gateway-url-messages';
import { validateGatewayUrlForManualConnect } from './validate-gateway-url';
import {
  GatewayQrScannerModal,
  requestGatewayQrCameraAccess,
} from './GatewayQrScannerModal';
import { GatewayTokenInput } from './GatewayTokenInput';
import { resolveGatewayCredentialsFromQr } from './pair-gateway';
import type { ParsedGatewayQr } from './parse-gateway-qr';

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export function GatewayEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const m = useMessages();
  const s = m.settings;
  const g = m.gateway;
  const l = m.gatewayConnect;
  const colors = useSettingsColors();

  const profiles = useGatewayStore((st) => st.profiles);
  const activeGatewayId = useGatewayStore((st) => st.activeGatewayId);
  const addProfile = useGatewayStore((st) => st.addProfile);
  const updateProfile = useGatewayStore((st) => st.updateProfile);
  const removeProfile = useGatewayStore((st) => st.removeProfile);
  const switchGateway = useGatewayStore((st) => st.switchGateway);
  const configured = useGatewayConfigured();

  const existingProfile = useMemo(
    () => (isNew ? null : profiles.find((p) => p.id === id) ?? null),
    [id, isNew, profiles],
  );

  const [pendingLanUrl, setPendingLanUrl] = useState<string | null>(existingProfile?.lanUrl ?? null);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [tokenNotice, setTokenNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [camPermission, requestCamPermission] = useCameraPermissions();

  const {
    control,
    handleSubmit,
    setValue,
    reset,
    watch,
    formState: { errors },
  } = useForm<GatewayProfileForm>({
    resolver: zodResolver(gatewayProfileSchema),
    defaultValues: {
      name: existingProfile?.name ?? '',
      baseUrl: existingProfile?.baseUrl || DEFAULT_GATEWAY_BASE_URL,
      token: existingProfile?.token ?? '',
    },
  });
  useEffect(() => {
    if (isNew) return;
    if (!existingProfile) {
      router.replace('/settings/gateway');
    }
  }, [existingProfile, isNew, router]);

  useEffect(() => {
    reset({
      name: existingProfile?.name ?? '',
      baseUrl: existingProfile?.baseUrl || DEFAULT_GATEWAY_BASE_URL,
      token: existingProfile?.token ?? '',
    });
    setPendingLanUrl(existingProfile?.lanUrl ?? null);
  }, [existingProfile, reset]);

  useFocusEffect(
    useCallback(() => {
      if (!configured || isNew) return;
      const tunnel = useGatewayStore.getState().baseUrl.trim();
      if (tunnel && existingProfile?.id === activeGatewayId) {
        void syncGatewayUrlsFromTunnelQr();
      }
    }, [activeGatewayId, configured, existingProfile?.id, isNew]),
  );

  const applyParsedQr = useCallback(
    (parsed: ParsedGatewayQr) => {
      void (async () => {
        if (parsed.pairingSecret && parsed.baseUrl) {
          try {
            const resolved = await resolveGatewayCredentialsFromQr(parsed);
            if (!resolved) return;
            setValue('baseUrl', resolved.baseUrl, { shouldValidate: true });
            setValue('token', resolved.token);
            setValue('name', gatewayProfileNameFromUrl(resolved.baseUrl));
            setPendingLanUrl(resolved.lanUrl);
            setScanNotice(g.qrApplied);
            setTestMessage(null);
            setTestOk(null);
          } catch (err) {
            setScanNotice(err instanceof Error ? err.message : String(err));
          }
          return;
        }

        setScanNotice('Scan a pairing QR with base URL and pairing secret (ps).');
      })();
    },
    [g.qrApplied, setValue],
  );

  const openScanner = useCallback(async () => {
    const ok = await requestGatewayQrCameraAccess(
      camPermission,
      requestCamPermission,
      () => setScanNotice(l.cameraDenied),
    );
    if (ok) setScannerOpen(true);
  }, [camPermission, l.cameraDenied, requestCamPermission]);

  const watchedBaseUrl = watch('baseUrl');
  const watchedToken = watch('token');

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestMessage(null);
    setTestOk(null);
    const st = useGatewayStore.getState();
    const prev = {
      baseUrl: st.baseUrl,
      lanUrl: st.lanUrl,
      token: st.token,
      activeBaseUrl: st.activeBaseUrl,
    };
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let shouldRestoreStore = false;
    try {
      const formBaseUrl = normalizeBaseUrl(watchedBaseUrl ?? '');
      const formToken = watchedToken ?? '';
      if (!formBaseUrl) return;

      const urlCheck = await validateGatewayUrlForManualConnect(formBaseUrl, {
        requireReachable: true,
      });
      if (!urlCheck.ok) {
        setTestOk(false);
        setTestMessage(
          gatewayUrlValidationMessage(urlCheck.code, {
            invalidUrl: s.baseUrlInvalid,
            loopbackUrl: g.loopbackUrl,
            unreachableUrl: g.unreachableUrl,
          }),
        );
        return;
      }

      useGatewayStore.setState({
        baseUrl: urlCheck.url,
        lanUrl: pendingLanUrl,
        token: formToken,
        activeBaseUrl: urlCheck.url,
      });
      shouldRestoreStore = true;
      const active = await st.refreshActiveBaseUrl();
      if (!active) {
        setTestOk(false);
        setTestMessage(g.unreachableUrl);
        return;
      }

      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 5000);
      const headers: Record<string, string> = {};
      if (formToken) headers.Authorization = `Bearer ${formToken}`;
      const res = await fetch(`${active}/health`, { signal: controller.signal, headers });

      if (res.ok) {
        setTestOk(true);
        setTestMessage(g.testOk);
      } else {
        setTestOk(false);
        setTestMessage(`${g.testFailed} (${res.status})`);
      }
    } catch {
      setTestOk(false);
      setTestMessage(g.testFailed);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (shouldRestoreStore) useGatewayStore.setState(prev);
      setTesting(false);
    }
  }, [g.loopbackUrl, g.testFailed, g.testOk, g.unreachableUrl, pendingLanUrl, s.baseUrlInvalid, watchedBaseUrl, watchedToken]);

  const onSubmit = async (data: GatewayProfileForm) => {
    const nextBaseUrl = normalizeBaseUrl(data.baseUrl);
    const prevBaseUrl = existingProfile ? normalizeBaseUrl(existingProfile.baseUrl) : '';
    const baseUrlChanged = !isNew && prevBaseUrl !== nextBaseUrl;

    const urlCheck = await validateGatewayUrlForManualConnect(data.baseUrl, {
      requireReachable: !data.token.trim(),
    });
    if (!urlCheck.ok) {
      Alert.alert(
        s.editGateway,
        gatewayUrlValidationMessage(urlCheck.code, {
          invalidUrl: s.baseUrlInvalid,
          loopbackUrl: g.loopbackUrl,
          unreachableUrl: g.unreachableUrl,
        }),
      );
      return;
    }

    setSaving(true);
    try {
      const saveBaseUrl = urlCheck.url;
      if (isNew) {
        const duplicate = useGatewayStore.getState().findProfileByBaseUrl(nextBaseUrl);
        if (duplicate) {
          updateProfile(duplicate.id, {
            name: data.name,
            baseUrl: saveBaseUrl,
            lanUrl: pendingLanUrl,
            token: data.token,
          });
          switchGateway(duplicate.id);
        } else {
          addProfile(
            {
              name: data.name,
              baseUrl: saveBaseUrl,
              lanUrl: pendingLanUrl,
              token: data.token,
            },
            { setActive: true },
          );
        }
      } else if (existingProfile) {
        updateProfile(existingProfile.id, {
          name: data.name,
          baseUrl: saveBaseUrl,
          lanUrl: pendingLanUrl,
          token: data.token,
        });
        if (existingProfile.id !== activeGatewayId) {
          switchGateway(existingProfile.id);
        }
      }

      await syncAfterGatewaySettingsSave();

      if (isNew || baseUrlChanged) {
        await openDefaultSessionAfterConnect(router.replace);
      } else {
        router.back();
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = useCallback(() => {
    if (!existingProfile) return;
    Alert.alert(s.deleteGateway, s.deleteGatewayConfirm, [
      { text: m.common.cancel, style: 'cancel' },
      {
        text: s.deleteGateway,
        style: 'destructive',
        onPress: () => {
          const wasActive = existingProfile.id === activeGatewayId;
          removeProfile(existingProfile.id);
          if (wasActive && useGatewayStore.getState().profiles.length === 0) {
            router.replace('/');
          } else {
            router.replace('/settings/gateway');
          }
        },
      },
    ]);
  }, [
    activeGatewayId,
    existingProfile,
    m.common.cancel,
    removeProfile,
    router,
    s.deleteGateway,
    s.deleteGatewayConfirm,
  ]);

  if (!isNew && !existingProfile) {
    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
      <FloatingHeader title={isNew ? s.newGateway : s.editGateway} onBack={() => router.back()} />
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
      >
        <Controller
          control={control}
          name="name"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              label={s.gatewayName}
              placeholder={s.gatewayNamePlaceholder}
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              mode="outlined"
            />
          )}
        />

        <Controller
          control={control}
          name="baseUrl"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              label={s.baseUrl}
              value={value}
              placeholder={l.baseUrlPlaceholder}
              onBlur={onBlur}
              onChangeText={(text) => {
                onChange(text);
                setPendingLanUrl(null);
                setTestMessage(null);
                setTestOk(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              mode="outlined"
              error={!!errors.baseUrl}
              style={styles.fieldGap}
            />
          )}
        />
        <HelperText type="error" visible={!!errors.baseUrl}>
          {zodGatewayBaseUrlErrorMessage(errors.baseUrl?.message, {
            invalidUrl: s.baseUrlInvalid,
            loopbackUrl: g.loopbackUrl,
            unreachableUrl: g.unreachableUrl,
          })}
        </HelperText>

        <Controller
          control={control}
          name="token"
          render={({ field: { onChange, onBlur, value } }) => (
            <GatewayTokenInput
              label={s.token}
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              mode="outlined"
              style={styles.fieldGap}
              copyAccessibilityLabel={l.copyToken}
              showAccessibilityLabel={l.showToken}
              hideAccessibilityLabel={l.hideToken}
              onCopied={() => setTokenNotice(l.tokenCopied)}
              onCopyFailed={() => setTokenNotice(m.chat.messageCopyFailed)}
            />
          )}
        />

        <View style={styles.actionRow}>
          {Platform.OS !== 'web' ? (
            <Button mode="outlined" onPress={() => void openScanner()} icon="barcode-scan">
              {l.scanQr}
            </Button>
          ) : (
            <View />
          )}
          <Button mode="outlined" loading={testing} disabled={testing} onPress={() => void handleTestConnection()}>
            {testing ? g.testingConnection : g.testConnection}
          </Button>
        </View>
        {testMessage ? (
          <HelperText type={testOk ? 'info' : 'error'} visible>
            {testMessage}
          </HelperText>
        ) : null}

        <View style={styles.saveRow}>
          <Button
            mode="contained"
            loading={saving}
            disabled={saving}
            onPress={handleSubmit((d) => void onSubmit(d))}
          >
            {s.save}
          </Button>
          <Text variant="bodySmall" style={[styles.applyHint, { color: colors.textMuted }]}>
            {g.applyImmediatelyHint}
          </Text>
        </View>

        {!isNew ? (
          <View style={styles.deleteRow}>
            <Button mode="outlined" textColor={colors.error} onPress={confirmDelete}>
              {s.deleteGateway}
            </Button>
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      <GatewayQrScannerModal
        visible={scannerOpen}
        onRequestClose={() => setScannerOpen(false)}
        onScanned={applyParsedQr}
        onCameraDenied={() => setScanNotice(l.cameraDenied)}
      />

      <AppToast visible={Boolean(scanNotice)} onDismiss={() => setScanNotice(null)} duration={TOAST_DURATION_LONG}>
        {scanNotice}
      </AppToast>
      <AppToast visible={Boolean(tokenNotice)} onDismiss={() => setTokenNotice(null)} duration={TOAST_DURATION_SHORT}>
        {tokenNotice}
      </AppToast>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 16,
    paddingBottom: 32,
  },
  fieldGap: {
    marginTop: 8,
  },
  actionRow: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  saveRow: {
    marginTop: 24,
    gap: 8,
  },
  applyHint: {
    lineHeight: 18,
  },
  deleteRow: {
    marginTop: 24,
    alignItems: 'flex-start',
  },
});
