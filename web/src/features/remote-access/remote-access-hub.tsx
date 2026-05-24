import { TunnelSettingsPanel } from '@/features/tunnel/tunnel-settings';
import { TailscaleServeSection } from '@/features/remote-access/tailscale-serve-section';
import { SshCliSection } from '@/features/remote-access/ssh-cli-section';

export function RemoteAccessHub() {
  return (
    <div className="space-y-8">
      <TailscaleServeSection />
      <TunnelSettingsPanel />
      <SshCliSection />
    </div>
  );
}
