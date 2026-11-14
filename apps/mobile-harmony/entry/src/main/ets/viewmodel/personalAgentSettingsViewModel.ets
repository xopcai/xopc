import { XopcPersonalAgentRecord, XopcPersonalAgentResponse, XopcPersonalCallMode, XopcPersonalVoiceCallPatch,
  XopcPersonalVoicePreference,
  XopcPersonalVoiceOption, XopcPersonalVoiceStatus, XopcPersonalVoicesResponse, XopcPersonalProfilePatch } from '../model/personalAgent';
import { XopcHttpError } from '../service/transport';
import { gatewaySession } from '../service/gatewaySession';

@ObservedV2
export class XopcPersonalAgentSettingsViewModel {
  @Trace record: XopcPersonalAgentRecord | null = null;
  @Trace voices: XopcPersonalVoiceOption[] = [];
  @Trace voiceRoute: XopcPersonalVoicePreference | null = null;
  @Trace loading: boolean = false;
  @Trace saving: boolean = false;
  @Trace error: string = '';
  @Trace voiceError: string = '';
  private generation: number = 0;

  dispose(): void { this.generation++; }
  async load(record: XopcPersonalAgentRecord): Promise<void> {
    const generation = ++this.generation;
    const connection = gatewaySession.connectionRevision();
    this.record = record; this.loading = true; this.error = '';
    this.voices = []; this.voiceRoute = null; this.voiceError = '';
    try {
      const response = JSON.parse(await gatewaySession.request('/api/personal-agent')) as XopcPersonalAgentResponse;
      gatewaySession.assertConnection(connection);
      if (generation !== this.generation) return;
      if (!response.ok || !response.payload) throw new Error(response.error ?? 'PERSONAL_AGENT_UNAVAILABLE');
      this.record = response.payload;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    try {
      const status = JSON.parse(await gatewaySession.request('/api/voice/realtime/status')) as XopcPersonalVoiceStatus;
      gatewaySession.assertConnection(connection);
      if (generation !== this.generation) return;
      const route = status.payload.tts;
      if (route) {
        const response = JSON.parse(await gatewaySession.request('/api/voice/tts-voices?provider='
          + encodeURIComponent(route.provider) + '&model=' + encodeURIComponent(route.model) + '&purpose=realtime')) as XopcPersonalVoicesResponse;
        gatewaySession.assertConnection(connection);
        if (generation !== this.generation) return;
        if (!response.ok) throw new Error(response.error ?? 'PERSONAL_VOICE_UNAVAILABLE');
        this.voiceRoute = route; this.voices = response.payload.voices;
      }
    } catch (error) { if (generation === this.generation) this.voiceError = (error as Error).message; }
    if (generation === this.generation) this.loading = false;
  }

  private retryPatch(original: XopcPersonalAgentRecord, latest: XopcPersonalAgentRecord,
    patch: XopcPersonalProfilePatch): XopcPersonalProfilePatch {
    const nameChanged = patch.displayName !== original.displayName;
    const appearanceChanged = patch.appearance !== original.appearance;
    const greeting = patch.voiceCallPreferences?.openingGreetingEnabled;
    const engine = patch.voiceCallPreferences?.enginePreference;
    const latestGreeting = latest.voiceCallPreferences?.openingGreetingEnabled ?? true;
    const latestEngine = latest.voiceCallPreferences?.enginePreference ?? 'auto';
    const voiceChanged = JSON.stringify(patch.voicePreference ?? null) !== JSON.stringify(original.voicePreference ?? null);
    if (latest.agentId !== original.agentId || latest.state !== 'ready' || !latest.revision ||
      (nameChanged && latest.displayName !== original.displayName && latest.displayName !== patch.displayName) ||
      (appearanceChanged && latest.appearance !== original.appearance && latest.appearance !== patch.appearance) ||
      (greeting !== undefined && latestGreeting !== (original.voiceCallPreferences?.openingGreetingEnabled ?? true) && latestGreeting !== greeting) ||
      (engine !== undefined && latestEngine !== (original.voiceCallPreferences?.enginePreference ?? 'auto') && latestEngine !== engine) ||
      (voiceChanged && JSON.stringify(latest.voicePreference ?? null) !== JSON.stringify(original.voicePreference ?? null) &&
        JSON.stringify(latest.voicePreference ?? null) !== JSON.stringify(patch.voicePreference ?? null))) {
      throw new Error('PERSONAL_PROFILE_CONFLICT');
    }
    return { revision: latest.revision, displayName: nameChanged ? patch.displayName : latest.displayName,
      appearance: appearanceChanged ? patch.appearance : latest.appearance,
      voiceCallPreferences: patch.voiceCallPreferences,
      voicePreference: voiceChanged ? patch.voicePreference : latest.voicePreference };
  }

  async saveProfile(name: string, appearance: string,
    voiceId: string, greetingEnabled?: boolean, callMode?: XopcPersonalCallMode): Promise<XopcPersonalAgentRecord | null> {
    const record = this.record;
    if (this.saving || this.loading || !record?.revision || !name.trim() || name.trim().length > 60) return null;
    const generation = this.generation;
    const connection = gatewaySession.connectionRevision();
    const callPreferences: XopcPersonalVoiceCallPatch = {};
    if (record.voiceCallPreferences && greetingEnabled !== undefined &&
      greetingEnabled !== record.voiceCallPreferences.openingGreetingEnabled) callPreferences.openingGreetingEnabled = greetingEnabled;
    if (callMode !== undefined && callMode !== (record.voiceCallPreferences?.enginePreference ?? 'auto')) {
      callPreferences.enginePreference = callMode;
    }
    const patch: XopcPersonalProfilePatch = { revision: record.revision, displayName: name.trim(), appearance: appearance,
      voiceCallPreferences: Object.keys(callPreferences).length ? callPreferences : undefined,
      voicePreference: voiceId === record.voicePreference?.voice || (!voiceId && record.voicePreference?.voice === 'default') ? record.voicePreference : this.voiceRoute ? (voiceId ? { provider: this.voiceRoute.provider,
        model: this.voiceRoute.model, voice: voiceId } : null) : record.voicePreference };
    this.saving = true; this.error = '';
    try {
      let raw: string;
      try {
        raw = await gatewaySession.request('/api/personal-agent/profile', 'PATCH', JSON.stringify(patch));
      } catch (error) {
        if (!(error instanceof XopcHttpError) || error.status !== 409) throw new Error((error as Error).message);
        gatewaySession.assertConnection(connection);
        if (generation !== this.generation) return null;
        const refreshed = JSON.parse(await gatewaySession.request('/api/personal-agent')) as XopcPersonalAgentResponse;
        gatewaySession.assertConnection(connection);
        if (generation !== this.generation) return null;
        if (!refreshed.ok || !refreshed.payload) throw new Error('PERSONAL_PROFILE_CONFLICT');
        const retry = this.retryPatch(record, refreshed.payload, patch);
        raw = await gatewaySession.request('/api/personal-agent/profile', 'PATCH', JSON.stringify(retry));
      }
      const response = JSON.parse(raw) as XopcPersonalAgentResponse;
      gatewaySession.assertConnection(connection);
      if (generation !== this.generation) return null;
      if (!response.ok || !response.payload) throw new Error(response.error ?? 'PERSONAL_AGENT_UNAVAILABLE');
      this.record = response.payload;
      return response.payload;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; return null; }
    finally { if (generation === this.generation) this.saving = false; }
  }

}
