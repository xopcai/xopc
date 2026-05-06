/** Print a URL as a terminal QR code when qrcode-terminal is available. */
export async function printDingtalkSetupUrl(url: string): Promise<void> {
  try {
    const qrcodeTerminal = await import(/* @vite-ignore */ 'qrcode-terminal');
    // Must call as `default.generate(...)` — `generate` uses `this.error`; destructuring loses `this`.
    await new Promise<void>((resolve, reject) => {
      try {
        qrcodeTerminal.default.generate(url, { small: true }, (qr: string) => {
          process.stdout.write(qr.endsWith('\n') ? qr : `${qr}\n`);
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  } catch {
    console.log('Open this URL (DingTalk) to finish app registration:\n');
    console.log(url);
  }
}
