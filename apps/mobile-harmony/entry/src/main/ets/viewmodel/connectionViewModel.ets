import { gatewaySession } from '../service/gatewaySession';
import { realtimeClient } from '../service/realtimeClient';
import { XopcProfile } from '../model/gateway';
import { pushNotifications } from '../service/pushNotifications';

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

  private syncProfiles(): void {
    this.profiles = gatewaySession.savedProfiles();
    const profile = gatewaySession.currentProfile();
    this.activeGatewayId = profile?.gatewayId ?? '';
    this.gatewayName = profile?.name ?? ''; this.connected = !!profile;
  }

  openGateways(): void {
    if (this.busy || pushNotifications.busy) return;
    this.syncProfiles(); this.errorMessage = ''; this.managing = true;
    realtimeClient.reset();
  }
  closeGateways(): void {
    if (this.busy) return;
    this.managing = false; this.adding = false; this.errorMessage = '';
    this.syncProfiles();
    if (this.connected) realtimeClient.start();
  }
  addGateway(): void {
    if (this.busy) return;
    this.managing = false; this.adding = true; this.errorMessage = '';
  }

  async activate(gatewayId: string): Promise<void> {
    if (this.busy || pushNotifications.busy) return;
    this.busy = true; this.errorMessage = '';
    try {
      realtimeClient.reset(); pushNotifications.reset();
      await gatewaySession.activate(gatewayId);
      this.syncProfiles(); this.managing = false;
      realtimeClient.start();
    } catch (error) { this.errorMessage = (error as Error).message; }
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
      if (gatewayId === this.activeGatewayId) {
        if (pushNotifications.enabled && !await pushNotifications.disable()) throw new Error('PUSH_REMOVE_FAILED');
        realtimeClient.reset(); pushNotifications.reset();
      }
      await gatewaySession.removeProfile(gatewayId); this.syncProfiles();
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
