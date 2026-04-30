import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, HelperText, Text, TextInput } from 'react-native-paper';

import { type GatewaySettingsForm, gatewaySettingsSchema } from '../src/config/schema';
import { useMessages } from '../src/i18n/messages';
import { AgentSection } from '../src/features/settings/AgentSection';
import { AppearanceSection } from '../src/features/settings/AppearanceSection';
import { useGatewayStore } from '../src/stores/gateway-store';

export default function SettingsScreen() {
  const router = useRouter();
  const m = useMessages();
  const s = m.settings;

  const baseUrl = useGatewayStore((st) => st.baseUrl);
  const token = useGatewayStore((st) => st.token);
  const thinking = useGatewayStore((st) => st.thinking);
  const setBaseUrl = useGatewayStore((st) => st.setBaseUrl);
  const setToken = useGatewayStore((st) => st.setToken);
  const setThinking = useGatewayStore((st) => st.setThinking);
  const persist = useGatewayStore((st) => st.persist);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<GatewaySettingsForm>({
    resolver: zodResolver(gatewaySettingsSchema),
    defaultValues: {
      baseUrl: baseUrl || 'http://127.0.0.1:8787',
      token: token || '',
      thinking: thinking || '',
    },
  });

  const onSubmit = (data: GatewaySettingsForm) => {
    setBaseUrl(data.baseUrl);
    setToken(data.token);
    setThinking(data.thinking);
    persist();
    router.back();
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {/* ── Gateway section ──────────────────────────── */}
      <Text variant="titleMedium" style={styles.sectionTitle}>
        {s.gateway}
      </Text>
      <Text variant="bodySmall" style={styles.sectionHint}>
        {s.gatewayHint}
      </Text>

      <Controller
        control={control}
        name="baseUrl"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            label={s.baseUrl}
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            mode="outlined"
            error={!!errors.baseUrl}
          />
        )}
      />
      <HelperText type="error" visible={!!errors.baseUrl}>
        {errors.baseUrl?.message}
      </HelperText>

      <Controller
        control={control}
        name="token"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            label={s.token}
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            autoCapitalize="none"
            secureTextEntry
            mode="outlined"
          />
        )}
      />

      <Controller
        control={control}
        name="thinking"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            label={s.thinkingLevel}
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            autoCapitalize="none"
            mode="outlined"
            style={styles.thinkingInput}
          />
        )}
      />

      <View style={styles.saveRow}>
        <Button mode="contained" onPress={handleSubmit(onSubmit)}>
          {s.save}
        </Button>
      </View>

      <Divider style={styles.sectionDivider} />

      {/* ── Appearance section ───────────────────────── */}
      <AppearanceSection />

      <Divider style={styles.sectionDivider} />

      {/* ── Agent section ────────────────────────────── */}
      <AgentSection />

      {/* Bottom spacer */}
      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 16,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  sectionHint: {
    marginBottom: 16,
    opacity: 0.75,
  },
  thinkingInput: {
    marginTop: 8,
  },
  saveRow: {
    marginTop: 24,
  },
  sectionDivider: {
    marginTop: 28,
    marginBottom: 4,
  },
  bottomSpacer: {
    height: 40,
  },
});
