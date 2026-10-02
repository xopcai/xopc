import { gatewaySession } from '../service/gatewaySession';
import { realtimeClient } from '../service/realtimeClient';
import { XopcGatewayProbe, XopcProfile } from '../model/gateway';
import { pushNotifications } from '../service/pushNotifications';

export interface XopcGatewayProbeState {
  gatewayId: string; phase: string; result?: XopcGatewayProbe; error: string;
}

@ObservedV2
export class XopcConnectionViewModel {
  @Trace busy: boolean = false;
  @Trace connected: boolean = false;
  @Trace gatewayName: string = '';
  @Trace confirmationCode: string = '';
  @Trace errorMessage: string = '';
  @Trace managing: boolean = false;
  @Trace adding: boolean = false;
  @Trace profiles: XopcProfile[] = [];
  @Trace activeGatewayId: string = '';
  @Trace probes: XopcGatewayProbeState[] = [];
  private probeGeneration: number = 0;

  probeState(gatewayId: string): XopcGatewayProbeState | undefined {
    return this.probes.find((item: XopcGatewayProbeState): boolean => item.gatewayId === gatewayId);
  }

  private setProbe(state: XopcGatewayProbeState): void {
    this.probes = this.probes.filter((item: XopcGatewayProbeState): boolean => item.gatewayId !== state.gatewayId).concat([state]);
  }

  async probeOne(gatewayId: string): Promise<void> {
    if (!this.profiles.some((item: XopcProfile): boolean => item.gatewayId === gatewayId)
      || this.probeState(gatewayId)?.phase === 'checking') return;
    const generation = this.probeGeneration;
    this.setProbe({ gatewayId, phase: 'checking', error: '' });
    try {
      const result = await gatewaySession.probeProfile(gatewayId);
      if (generation === this.probeGeneration) this.setProbe({ gatewayId, phase: result.status === 'healthy' ? 'online' : 'degraded', result, error: '' });
    } catch (error) {
      if (generation === this.probeGeneration) this.setProbe({ gatewayId, phase: 'offline', error: (error as Error).message });
    }
  }

  async probeAll(): Promise<void> {
    await Promise.all(this.profiles.map((profile: XopcProfile): Promise<void> => this.probeOne(profile.gatewayId)));
  }

  private syncProfiles(): void {
    const profile = gatewaySession.currentProfile();
    this.profiles = gatewaySession.savedProfiles().sort((left: XopcProfile, right: XopcProfile): number =>
      left.gatewayId === profile?.gatewayId ? -1 : right.gatewayId === profile?.gatewayId ? 1 : 0);
    this.activeGatewayId = profile?.gatewayId ?? '';
    this.gatewayName = profile?.name ?? ''; this.connected = !!profile;
  }

  openGateways(): void {
    if (this.busy || pushNotifications.busy) return;
    this.syncProfiles(); this.errorMessage = ''; this.managing = true;
    this.probeGeneration++; this.probes = [];
    void this.probeAll();
  }
  closeGateways(): void {
    if (this.busy) return;
    this.managing = false; this.adding = false; this.errorMessage = '';
    this.probeGeneration++;
    this.syncProfiles();
  }
  addGateway(): void {
    if (this.busy) return;
    this.managing = false; this.adding = true; this.errorMessage = '';
  }

  async activate(gatewayId: string): Promise<void> {
    if (this.busy || pushNotifications.busy) return;
    this.busy = true; this.errorMessage = '';
    try {
      await gatewaySession.activate(gatewayId);
      this.probeGeneration++;
      realtimeClient.reset(); pushNotifications.reset();
      this.syncProfiles(); this.managing = false;
      realtimeClient.start();
    } catch (error) {
      this.errorMessage = (error as Error).message;
      this.setProbe({ gatewayId, phase: 'offline', error: this.errorMessage });
    }
    finally { this.busy = false; }
  }

  async rename(gatewayId: string, name: string): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.errorMessage = '';
    try { await gatewaySession.renameProfile(gatewayId, name); this.syncProfiles(); }
    catch (error) { this.errorMessage = (error as Error).message; }
    finally { this.busy = false; }
  }

  async remove(gatewayId: string): Promise<void> {
    if (this.busy || pushNotifications.busy) return;
    this.busy = true; this.errorMessage = '';
    try {
      const wasActive = gatewayId === this.activeGatewayId;
      if (wasActive) {
        if (pushNotifications.enabled && !await pushNotifications.disable()) throw new Error('PUSH_REMOVE_FAILED');
      }
      await gatewaySession.removeProfile(gatewayId); this.syncProfiles();
      if (wasActive) { realtimeClient.reset(); pushNotifications.reset(); if (this.connected) realtimeClient.start(); }
      this.probes = this.probes.filter((item: XopcGatewayProbeState): boolean => item.gatewayId !== gatewayId);
    } catch (error) { this.errorMessage = (error as Error).message; }
    finally { this.busy = false; }
  }

  async restore(): Promise<void> {
    this.busy = true;
    try {
      const profile = await gatewaySession.restore((code: string): void => { this.confirmationCode = code; });
      if (profile) { this.gatewayName = profile.name; this.connected = true; realtimeClient.start(); }
    } catch (error) { this.errorMessage = (error as Error).message; }
    finally {
      this.syncProfiles(); this.busy = false; this.confirmationCode = '';
      if (this.connected && !this.managing && !this.adding) realtimeClient.start();
    }
  }

  async connect(link: string): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.errorMessage = ''; this.confirmationCode = '';
    try {
      realtimeClient.reset(); pushNotifications.reset();
      const profile = await gatewaySession.pair(link, (code: string): void => { this.confirmationCode = code; });
      this.gatewayName = profile.name; this.connected = true;
      this.adding = false; this.managing = false; this.syncProfiles();
      realtimeClient.start();
    } catch (error) {
      this.errorMessage = (error as Error).message;
      const profile = gatewaySession.currentProfile();
      if (profile) { this.gatewayName = profile.name; this.connected = true; }
    }
    finally { this.syncProfiles(); this.busy = false; this.confirmationCode = ''; }
  }

  async cancel(): Promise<void> {
    try { await gatewaySession.cancelPairing(); this.errorMessage = ''; }
    catch (error) { this.errorMessage = (error as Error).message; }
    finally {
      this.busy = false; this.confirmationCode = ''; this.syncProfiles();
      if (!this.errorMessage && this.profiles.length) { this.adding = false; this.managing = true; }
    }
  }
}

export const connectionModel: XopcConnectionViewModel = new XopcConnectionViewModel();
