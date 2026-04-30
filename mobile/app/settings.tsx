import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { ScrollView, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { type GatewaySettingsForm, gatewaySettingsSchema } from '../src/config/schema';
import { useGatewayStore } from '../src/stores/gateway-store';

export default function SettingsScreen() {
  const router = useRouter();
  const baseUrl = useGatewayStore((s) => s.baseUrl);
  const token = useGatewayStore((s) => s.token);
  const thinking = useGatewayStore((s) => s.thinking);
  const setBaseUrl = useGatewayStore((s) => s.setBaseUrl);
  const setToken = useGatewayStore((s) => s.setToken);
  const setThinking = useGatewayStore((s) => s.setThinking);
  const persist = useGatewayStore((s) => s.persist);

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
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text variant="titleMedium" style={{ marginBottom: 8 }}>
        Gateway
      </Text>
      <Text variant="bodySmall" style={{ marginBottom: 16, opacity: 0.75 }}>
        MMKV persists these fields in a development build. Expo Go uses in-memory storage only.
      </Text>

      <Controller
        control={control}
        name="baseUrl"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            label="Base URL"
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
            label="Bearer token (optional)"
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
            label="Thinking level (optional)"
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            autoCapitalize="none"
            mode="outlined"
            style={{ marginTop: 8 }}
          />
        )}
      />

      <View style={{ marginTop: 24 }}>
        <Button mode="contained" onPress={handleSubmit(onSubmit)}>
          Save
        </Button>
      </View>
    </ScrollView>
  );
}
