import { XopcPersonalAgentRecord, XopcPersonalAgentResponse, XopcPersonalPreferences,
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
    const detailChanged = patch.preferences.detailLevel !== original.preferences?.detailLevel;
    const greetingChanged = patch.voiceCallPreferences?.openingGreetingEnabled !== (original.voiceCallPreferences?.openingGreetingEnabled ?? true);
    const voiceChanged = JSON.stringify(patch.voicePreference ?? null) !== JSON.stringify(original.voicePreference ?? null);
    if (latest.agentId !== original.agentId || latest.state !== 'ready' || !latest.revision ||
      (nameChanged && latest.displayName !== original.displayName && latest.displayName !== patch.displayName) ||
      (appearanceChanged && latest.appearance !== original.appearance && latest.appearance !== patch.appearance) ||
      (detailChanged && latest.preferences?.detailLevel !== original.preferences?.detailLevel && latest.preferences?.detailLevel !== patch.preferences.detailLevel) ||
      (greetingChanged && (latest.voiceCallPreferences?.openingGreetingEnabled ?? true) !== (original.voiceCallPreferences?.openingGreetingEnabled ?? true) &&
        (latest.voiceCallPreferences?.openingGreetingEnabled ?? true) !== patch.voiceCallPreferences?.openingGreetingEnabled) ||
      (voiceChanged && JSON.stringify(latest.voicePreference ?? null) !== JSON.stringify(original.voicePreference ?? null) &&
        JSON.stringify(latest.voicePreference ?? null) !== JSON.stringify(patch.voicePreference ?? null))) {
      throw new Error('PERSONAL_PROFILE_CONFLICT');
    }
    const prefs = latest.preferences;
    const merged: XopcPersonalPreferences = { addressAs: prefs?.addressAs, warmth: prefs?.warmth,
      supportMode: prefs?.supportMode, detailLevel: detailChanged ? patch.preferences.detailLevel : prefs?.detailLevel,
      proactivity: prefs?.proactivity, humor: prefs?.humor, guidance: prefs?.guidance };
    return { revision: latest.revision, displayName: nameChanged ? patch.displayName : latest.displayName,
      appearance: appearanceChanged ? patch.appearance : latest.appearance, preferences: merged,
      voiceCallPreferences: greetingChanged ? patch.voiceCallPreferences : latest.voiceCallPreferences,
      voicePreference: voiceChanged ? patch.voicePreference : latest.voicePreference };
  }

  async saveProfile(name: string, appearance: string, preferences: XopcPersonalPreferences,
    voiceId: string, greetingEnabled?: boolean): Promise<XopcPersonalAgentRecord | null> {
    const record = this.record;
    if (this.saving || this.loading || !record?.revision || !name.trim() || name.trim().length > 60) return null;
    const generation = this.generation;
    const connection = gatewaySession.connectionRevision();
    const patch: XopcPersonalProfilePatch = { revision: record.revision, displayName: name.trim(), appearance: appearance,
      voiceCallPreferences: record.voiceCallPreferences ? { openingGreetingEnabled: greetingEnabled ?? record.voiceCallPreferences.openingGreetingEnabled } : undefined,
      preferences: preferences, voicePreference: voiceId === record.voicePreference?.voice || (!voiceId && record.voicePreference?.voice === 'default') ? record.voicePreference : this.voiceRoute ? (voiceId ? { provider: this.voiceRoute.provider,
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
