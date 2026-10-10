import { XopcPersonalAgentRecord, XopcPersonalAgentResponse, XopcPersonalPreferences,
  XopcPersonalProactivity, XopcPersonalProactivityResponse, XopcPersonalVoicePreference,
  XopcPersonalVoiceOption, XopcPersonalVoiceStatus, XopcPersonalVoicesResponse, XopcPersonalProfilePatch } from '../model/personalAgent';
import { gatewaySession } from '../service/gatewaySession';

@ObservedV2
export class XopcPersonalAgentSettingsViewModel {
  @Trace record: XopcPersonalAgentRecord | null = null;
  @Trace outreach: XopcPersonalProactivity | null = null;
  @Trace voices: XopcPersonalVoiceOption[] = [];
  @Trace voiceRoute: XopcPersonalVoicePreference | null = null;
  @Trace loading: boolean = false;
  @Trace saving: boolean = false;
  @Trace error: string = '';
  @Trace outreachError: string = '';
  @Trace voiceError: string = '';
  private generation: number = 0;

  dispose(): void { this.generation++; }
  async load(record: XopcPersonalAgentRecord): Promise<void> {
    const generation = ++this.generation;
    const connection = gatewaySession.connectionRevision();
    this.record = record; this.loading = true; this.error = ''; this.outreach = null;
    this.voices = []; this.voiceRoute = null; this.outreachError = ''; this.voiceError = '';
    try {
      const response = JSON.parse(await gatewaySession.request('/api/personal-agent')) as XopcPersonalAgentResponse;
      gatewaySession.assertConnection(connection);
      if (generation !== this.generation) return;
      if (!response.ok || !response.payload) throw new Error(response.error ?? 'PERSONAL_AGENT_UNAVAILABLE');
      this.record = response.payload;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    try {
      const response = JSON.parse(await gatewaySession.request('/api/personal-agent/proactivity')) as XopcPersonalProactivityResponse;
      gatewaySession.assertConnection(connection);
      if (generation !== this.generation) return;
      if (!response.ok) throw new Error(response.error ?? 'PERSONAL_AGENT_UNAVAILABLE');
      this.outreach = response.payload;
    } catch (error) { if (generation === this.generation) this.outreachError = (error as Error).message; }
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

  async saveProfile(name: string, appearance: string, preferences: XopcPersonalPreferences,
    voiceId: string): Promise<XopcPersonalAgentRecord | null> {
    const record = this.record;
    if (this.saving || this.loading || !record?.revision || !name.trim() || name.trim().length > 60) return null;
    const generation = this.generation;
    const connection = gatewaySession.connectionRevision();
    const patch: XopcPersonalProfilePatch = { revision: record.revision, displayName: name.trim(), appearance: appearance,
      preferences: preferences, voicePreference: voiceId === record.voicePreference?.voice ? record.voicePreference : this.voiceRoute ? (voiceId ? { provider: this.voiceRoute.provider,
        model: this.voiceRoute.model, voice: voiceId } : null) : record.voicePreference };
    this.saving = true; this.error = '';
    try {
      const response = JSON.parse(await gatewaySession.request('/api/personal-agent/profile', 'PATCH', JSON.stringify(patch))) as XopcPersonalAgentResponse;
      gatewaySession.assertConnection(connection);
      if (generation !== this.generation) return null;
      if (!response.ok || !response.payload) throw new Error(response.error ?? 'PERSONAL_AGENT_UNAVAILABLE');
      this.record = response.payload;
      return response.payload;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; return null; }
    finally { if (generation === this.generation) this.saving = false; }
  }

  async saveOutreach(mode: string, timezone: string, quietStart: number, quietEnd: number): Promise<boolean> {
    const current = this.outreach;
    if (!current || this.loading || this.saving) return false;
    const generation = this.generation;
    const connection = gatewaySession.connectionRevision();
    const patch: XopcPersonalProactivity = { revision: current.revision, mode: mode, timezone: timezone.trim(),
      quietStart: quietStart, quietEnd: quietEnd, dailyMessages: current.dailyMessages, dailyModelCalls: current.dailyModelCalls };
    this.saving = true; this.outreachError = '';
    try {
      const response = JSON.parse(await gatewaySession.request('/api/personal-agent/proactivity', 'PATCH', JSON.stringify(patch))) as XopcPersonalProactivityResponse;
      gatewaySession.assertConnection(connection);
      if (generation !== this.generation) return false;
      if (!response.ok) throw new Error(response.error ?? 'PERSONAL_AGENT_UNAVAILABLE');
      this.outreach = response.payload; return true;
    } catch (error) { if (generation === this.generation) this.outreachError = (error as Error).message; return false; }
    finally { if (generation === this.generation) this.saving = false; }
  }
}
