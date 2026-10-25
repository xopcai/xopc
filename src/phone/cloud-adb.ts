import { AdbPhoneDriver } from './adb-driver.js';
import { CloudAdbConnection as CloudAdbTransport } from './cloud-adb-connection.js';
export { parseCloudEndpoint, parseCloudPrivateKey, PhoneCloudKeyStore } from './cloud-adb-connection.js';

export class CloudAdbConnection extends CloudAdbTransport {
  driver(): AdbPhoneDriver {
    return new AdbPhoneDriver('', this.command.bind(this), false, async signal => {
      // Management metadata must not abort a concurrent control connection.
      const listing = new CloudAdbConnection(this.endpoint, Buffer.from(this.key));
      try { return await listing.applications(signal); } finally { listing.dispose(); }
    }, async (text, signal) => {
      const { CloudScrcpyProvider } = await import('./cloud-scrcpy.js');
      const provider = new CloudScrcpyProvider(this.endpoint, Buffer.from(this.key), () => {}, undefined, true);
      try { await provider.pasteText(text, signal); } finally { await provider.close(); }
    }, this.hierarchy.bind(this));
  }
}
