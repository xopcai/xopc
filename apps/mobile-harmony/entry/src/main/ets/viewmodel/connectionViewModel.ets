import { gatewaySession } from '../service/gatewaySession';
import { realtimeClient } from '../service/realtimeClient';

@ObservedV2
export class XopcConnectionViewModel {
  @Trace busy: boolean = false;
  @Trace connected: boolean = false;
  @Trace gatewayName: string = '';
  @Trace confirmationCode: string = '';
  @Trace errorMessage: string = '';

  async restore(): Promise<void> {
    this.busy = true;
    try {
      const profile = await gatewaySession.restore((code: string): void => { this.confirmationCode = code; });
      if (profile) { this.gatewayName = profile.name; this.connected = true; realtimeClient.start(); }
    } catch (error) { this.errorMessage = (error as Error).message; }
    finally { this.busy = false; this.confirmationCode = ''; }
  }

  async connect(link: string): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.errorMessage = ''; this.confirmationCode = '';
    try {
      const profile = await gatewaySession.pair(link, (code: string): void => { this.confirmationCode = code; });
      this.gatewayName = profile.name; this.connected = true;
      realtimeClient.start();
    } catch (error) {
      this.errorMessage = (error as Error).message;
      const profile = gatewaySession.currentProfile();
      if (profile) { this.gatewayName = profile.name; this.connected = true; realtimeClient.start(); }
    }
    finally { this.busy = false; this.confirmationCode = ''; }
  }

  async cancel(): Promise<void> {
    try { await gatewaySession.cancelPairing(); this.errorMessage = ''; }
    catch (error) { this.errorMessage = (error as Error).message; }
    finally { this.busy = false; this.confirmationCode = ''; }
  }
}
