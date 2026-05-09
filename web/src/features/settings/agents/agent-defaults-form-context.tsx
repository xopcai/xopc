import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  parseAgentDefaultsFromConfig,
  parseParamsJsonForSave,
  patchAgentDefaults,
  type AgentDefaultsState,
} from '@/features/settings/config-api';
import { messages, type MessageBundle } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

type AgentDefaultsFormContextValue = {
  form: AgentDefaultsState | null;
  update: (patch: Partial<AgentDefaultsState>) => void;
  save: () => Promise<void>;
  discard: () => void;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  saveOk: boolean;
  loading: boolean;
  fetchError: string | null;
  hasToken: boolean;
  mutate: () => void;
  pageTitle: string;
  a: MessageBundle['agentSettings'];
  chat: MessageBundle['chat'];
  logsLoading: string;
  mSettingsSections: MessageBundle['settingsSections'];
  agentsMessages: MessageBundle['agentsSettings'];
};

const AgentDefaultsFormContext = createContext<AgentDefaultsFormContextValue | null>(null);

export function AgentDefaultsFormProvider({ children }: { children: ReactNode }) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const a = m.agentSettings;
  const chat = m.chat;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [form, setForm] = useState<AgentDefaultsState | null>(null);
  const [baseline, setBaseline] = useState<AgentDefaultsState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const dirtyRef = useRef(false);

  const { data, error: swrError, isLoading, mutate } = useGatewayConfigSwr(hasToken);

  const parsed = useMemo(
    () =>
      data?.payload?.config !== undefined ? parseAgentDefaultsFromConfig(data.payload.config) : null,
    [data],
  );

  useEffect(() => {
    if (!hasToken) {
      setForm(null);
      setBaseline(null);
      dirtyRef.current = false;
      return;
    }
    if (parsed === null) return;
    if (!dirtyRef.current) {
      setForm(parsed);
      setBaseline(parsed);
    }
  }, [hasToken, parsed]);

  const loading = Boolean(hasToken && isLoading && data === undefined && !swrError);
  const fetchError =
    swrError instanceof Error ? swrError.message : swrError ? String(swrError) : null;

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const update = useCallback((patch: Partial<AgentDefaultsState>) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, ...patch } : null));
  }, []);

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      try {
        void parseParamsJsonForSave(form.paramsJson);
      } catch (e) {
        setError(
          e instanceof SyntaxError
            ? a.advanced.paramsInvalidJson
            : e instanceof Error
              ? e.message
              : a.advanced.paramsInvalidJson,
        );
        return;
      }
      await patchAgentDefaults(form);
      dirtyRef.current = false;
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : a.saveError);
    } finally {
      setSaving(false);
    }
  }, [form, saving, a.saveError, a.advanced]);

  const discard = useCallback(() => {
    if (!baseline) return;
    dirtyRef.current = false;
    setForm(structuredClone(baseline));
    setError(null);
    setSaveOk(false);
  }, [baseline]);

  const pageTitle = m.settingsSections['agent-defaults'];

  const value = useMemo(
    () => ({
      form,
      update,
      save,
      discard,
      dirty,
      saving,
      error,
      saveOk,
      loading,
      fetchError,
      hasToken,
      mutate,
      pageTitle,
      a,
      chat,
      logsLoading: m.logs.loading,
      mSettingsSections: m.settingsSections,
      agentsMessages: m.agentsSettings,
    }),
    [
      form,
      update,
      save,
      discard,
      dirty,
      saving,
      error,
      saveOk,
      loading,
      fetchError,
      hasToken,
      mutate,
      pageTitle,
      a,
      chat,
      m.logs.loading,
      m.settingsSections,
      m.agentsSettings,
    ],
  );

  return <AgentDefaultsFormContext.Provider value={value}>{children}</AgentDefaultsFormContext.Provider>;
}

export function useAgentDefaultsForm(): AgentDefaultsFormContextValue {
  const v = useContext(AgentDefaultsFormContext);
  if (!v) {
    throw new Error('useAgentDefaultsForm must be used within AgentDefaultsFormProvider');
  }
  return v;
}
