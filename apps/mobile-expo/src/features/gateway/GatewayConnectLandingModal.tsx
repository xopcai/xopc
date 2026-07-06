/**
 * Full-screen connect flow when no gateway base URL is stored (mirrors web GatewayConnectLanding).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  Modal,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Button, IconButton, Text, TextInput } from 'react-native-paper';

import { AppToast } from '../../components/AppToast';
import { TOAST_DURATION_SHORT } from '../../constants/toast';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';

import { gatewaySettingsSchema } from '../../config/schema';
import { useMessages } from '../../i18n/messages';
import { queryKeys } from '../../query/keys';
import { invalidateSessionLists } from '../../query/workspace-sync';
import { DEFAULT_GATEWAY_BASE_URL, useGatewayStore } from '../../stores/gateway-store';
import {
  gatewayUrlValidationMessage,
  zodGatewayBaseUrlErrorMessage,
} from './gateway-url-messages';
import { validateGatewayUrlForManualConnect } from './validate-gateway-url';
import {
  GatewayQrScannerModal,
  requestGatewayQrCameraAccess,
} from './GatewayQrScannerModal';
import type { ParsedGatewayQr } from './parse-gateway-qr';
import { resolveGatewayCredentialsFromQr } from './pair-gateway';
import { openDefaultSessionAfterConnect } from './navigate-after-gateway-connect';
import { GatewayTokenInput } from './GatewayTokenInput';
import { upsertGatewayFromCredentials } from './upsert-gateway-from-credentials';
import { isGatewayConnectivityError } from '../../api/gateway-error';
import type { GatewayConnectivityError } from '../../api/gateway-error';
import type { MessageBundle } from '../../i18n/messages';

function connectivityErrorMessage(
  err: GatewayConnectivityError,
  l: MessageBundle['gatewayConnect'],
): string {
  switch (err.kind) {
    case 'token-invalid':
      return l.sessionExpired;
    case 'offline-network':
      return l.offlineNetwork;
    case 'offline-device':
      return l.offlineDevice;
    case 'no-route':
      return l.unreachableUrl;
    case 'reverse-proxy-unreachable':
      return l.reverseProxyUnreachable ?? l.unreachableUrl;
    case 'misconfigured':
      return l.invalidUrl;
    case 'server-error':
      return err.message;
    default:
      return l.connectFailed;
  }
}

export type GatewayConnectLandingModalProps = {
  visible: boolean;
  /** User closed the sheet without finishing setup — parent resets route to home. */
  onRequestClose: () => void;
};

export function GatewayConnectLandingModal({ visible, onRequestClose }: GatewayConnectLandingModalProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const m = useMessages();
  const l = m.gatewayConnect;
  const s = m.settings;

  const unauthorized = useGatewayStore((st) => st.unauthorized);

  const [baseUrl, setBaseUrlField] = useState(DEFAULT_GATEWAY_BASE_URL);
  const [token, setTokenField] = useState('');
  const [pendingLanUrl, setPendingLanUrl] = useState<string | null>(null);
  const [baseUrlError, setBaseUrlError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [tokenNotice, setTokenNotice] = useState<string | null>(null);
  const [camPermission, requestCamPermission] = useCameraPermissions();

  useEffect(() => {
    if (!visible) return;
    const st = useGatewayStore.getState();
    setBaseUrlField(st.baseUrl.trim() || DEFAULT_GATEWAY_BASE_URL);
    setTokenField(st.token);
    setPendingLanUrl(st.lanUrl);
    setBaseUrlError('');
    setSaveError('');
  }, [visible]);

  /** Match web token-expired UX: cannot dismiss landing with hardware back while 401. */
  useEffect(() => {
    if (!visible || !unauthorized) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [visible, unauthorized]);

  const colors = {
    bg: themeColors.surface.base,
    card: themeColors.surface.panel,
    border: themeColors.border.default,
    text: themeColors.text.primary,
    muted: themeColors.text.secondary,
    dangerBg: themeColors.surface.input,
    dangerBorder: themeColors.semantic.errorBold,
    danger: themeColors.semantic.errorBold,
  };

  const applyParsed = useCallback((parsed: ParsedGatewayQr) => {
    void (async () => {
      if (parsed.pairingSecret && parsed.baseUrl) {
        setSaveError('');
        setSaving(true);
        try {
          const resolved = await resolveGatewayCredentialsFromQr(parsed);
          if (!resolved) return;
          setBaseUrlField(resolved.baseUrl);
          setTokenField(resolved.token);
          setPendingLanUrl(resolved.lanUrl);
        } catch (err) {
          setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
          setSaving(false);
        }
        return;
      }

      setSaveError('Scan a pairing QR with base URL and pairing secret (ps).');
    })();
  }, []);

  const openScanner = useCallback(async () => {
    const ok = await requestGatewayQrCameraAccess(
      camPermission,
      requestCamPermission,
      () => setSaveError(l.cameraDenied),
    );
    if (ok) setScannerOpen(true);
  }, [camPermission, l.cameraDenied, requestCamPermission]);

  const handleSave = useCallback(async () => {
    setSaveError('');
    setBaseUrlError('');
    const parsed = gatewaySettingsSchema.safeParse({
      baseUrl: baseUrl.trim(),
      token: token.trim(),
    });
    if (!parsed.success) {
      const urlIssue = parsed.error.flatten().fieldErrors.baseUrl?.[0];
      setBaseUrlError(
        zodGatewayBaseUrlErrorMessage(urlIssue, {
          invalidUrl: l.invalidUrl,
          loopbackUrl: l.loopbackUrl,
          unreachableUrl: l.unreachableUrl,
        }),
      );
      return;
    }

    const urlCheck = await validateGatewayUrlForManualConnect(parsed.data.baseUrl, {
      requireReachable: true,
    });
    if (!urlCheck.ok) {
      setBaseUrlError(
        gatewayUrlValidationMessage(urlCheck.code, {
          invalidUrl: l.invalidUrl,
          loopbackUrl: l.loopbackUrl,
          unreachableUrl: l.unreachableUrl,
        }),
      );
      return;
    }

    const snapshot = useGatewayStore.getState();
    const before = {
      profiles: snapshot.profiles,
      activeGatewayId: snapshot.activeGatewayId,
      baseUrl: snapshot.baseUrl,
      lanUrl: snapshot.lanUrl,
      token: snapshot.token,
      activeBaseUrl: snapshot.activeBaseUrl,
    };
    setSaving(true);
    try {
      try {
        await upsertGatewayFromCredentials(
          {
            baseUrl: urlCheck.url,
            token: parsed.data.token,
            lanUrl: pendingLanUrl,
          },
          { preflight: true },
        );
      } catch (err) {
        if (isGatewayConnectivityError(err)) {
          setSaveError(connectivityErrorMessage(err, l));
          return;
        }
        throw err;
      }

      const nav = await openDefaultSessionAfterConnect(router.replace);
      if (!nav.ok) {
        useGatewayStore.setState({
          profiles: before.profiles,
          activeGatewayId: before.activeGatewayId,
          baseUrl: before.baseUrl,
          lanUrl: before.lanUrl,
          token: before.token,
          activeBaseUrl: before.activeBaseUrl,
        });
        useGatewayStore.getState().persist();
        setSaveError(nav.message || l.connectFailed);
        return;
      }
      invalidateSessionLists(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
    } finally {
      setSaving(false);
    }
  }, [
    baseUrl,
    token,
    pendingLanUrl,
    l.connectFailed,
    l.invalidUrl,
    l.loopbackUrl,
    l.unreachableUrl,
    queryClient,
    router.replace,
  ]);

  const goFullSettings = useCallback(() => {
    router.push('/settings');
  }, [router]);

  const requestClose = useCallback(() => {
    if (unauthorized) return;
    onRequestClose();
  }, [onRequestClose, unauthorized]);

  const landingContent = (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <View style={{ width: 48 }} />
        <Text variant="titleMedium" style={{ color: colors.text }}>
          {l.title}
        </Text>
        {unauthorized ? (
          <View style={{ width: 48 }} />
        ) : (
          <IconButton icon="close" size={22} onPress={requestClose} accessibilityLabel={l.close} />
        )}
      </View>

      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        bottomOffset={16}
        extraKeyboardSpace={insets.bottom}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text variant="titleLarge" style={[styles.headline, { color: colors.text }]}>
            {l.headline}
          </Text>
          <Text variant="bodyMedium" style={[styles.subline, { color: colors.muted }]}>
            {l.subline}
          </Text>

          {unauthorized ? (
            <View
              style={[
                styles.banner,
                { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
              ]}
            >
              <Text variant="bodySmall" style={{ color: colors.text }}>
                {l.sessionExpired}
              </Text>
            </View>
          ) : null}

          <Text variant="bodySmall" style={[styles.steps, { color: colors.muted }]}>
            {l.step1}
            {'\n'}
            {l.step2}
            {'\n'}
            {l.step3}
          </Text>

          <TextInput
            label={s.baseUrl}
            value={baseUrl}
            placeholder={l.baseUrlPlaceholder}
            onChangeText={(text) => {
              setBaseUrlField(text);
              setBaseUrlError('');
              setPendingLanUrl(null);
            }}
            mode="outlined"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            error={Boolean(baseUrlError)}
            style={styles.field}
          />
          {baseUrlError ? (
            <Text variant="bodySmall" style={[styles.fieldError, { color: colors.danger }]}>
              {baseUrlError}
            </Text>
          ) : null}

          <GatewayTokenInput
            label={s.token}
            value={token}
            onChangeText={setTokenField}
            mode="outlined"
            style={styles.field}
            copyAccessibilityLabel={l.copyToken}
            showAccessibilityLabel={l.showToken}
            hideAccessibilityLabel={l.hideToken}
            onCopied={() => setTokenNotice(l.tokenCopied)}
            onCopyFailed={() => setTokenNotice(m.chat.messageCopyFailed)}
          />
          <View style={styles.row}>
            <Button mode="outlined" onPress={openScanner} icon="barcode-scan">
              {l.scanQr}
            </Button>
          </View>

          {saveError ? (
            <Text variant="bodySmall" style={[styles.saveError, { color: colors.danger }]}>
              {saveError}
            </Text>
          ) : null}

          <View style={[styles.actions, unauthorized && styles.actionsSingle]}>
            {!unauthorized ? (
              <Button mode="text" onPress={goFullSettings}>
                {l.openFullSettings}
              </Button>
            ) : null}
            <Button mode="contained" onPress={() => void handleSave()} loading={saving} disabled={saving}>
              {l.saveContinue}
            </Button>
          </View>
        </View>
      </KeyboardAwareScrollView>

      <AppToast visible={Boolean(tokenNotice)} onDismiss={() => setTokenNotice(null)} duration={TOAST_DURATION_SHORT}>
        {tokenNotice}
      </AppToast>
    </View>
  );

  if (Platform.OS === 'web') {
    if (!visible) return null;
    return (
      <View style={styles.webOverlay}>
        {landingContent}
        <GatewayQrScannerModal
          embedded
          visible={scannerOpen}
          onRequestClose={() => setScannerOpen(false)}
          onScanned={applyParsed}
          onCameraDenied={() => setSaveError(l.cameraDenied)}
        />
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={requestClose}
    >
      {landingContent}
      <GatewayQrScannerModal
        embedded
        visible={scannerOpen}
        onRequestClose={() => setScannerOpen(false)}
        onScanned={applyParsed}
        onCameraDenied={() => setSaveError(l.cameraDenied)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  webOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    elevation: 1000,
  },
  root: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
  },
  headline: {
    textAlign: 'center',
    marginBottom: 8,
  },
  subline: {
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 12,
  },
  banner: {
    marginTop: 8,
    marginBottom: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  steps: {
    marginTop: 12,
    lineHeight: 22,
  },
  field: {
    marginTop: 14,
    backgroundColor: 'transparent',
  },
  fieldError: {
    marginTop: 4,
  },
  row: {
    marginTop: 16,
    alignItems: 'flex-start',
  },
  saveError: {
    marginTop: 12,
  },
  actions: {
    marginTop: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  actionsSingle: {
    justifyContent: 'flex-end',
  },
});
