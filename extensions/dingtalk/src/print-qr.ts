/** Print a URL as a terminal QR code when qrcode-terminal is available. */
export async function printDingtalkSetupUrl(url: string): Promise<void> {
  try {
    const qrcodeTerminal = await import(/* @vite-ignore */ 'qrcode-terminal');
    const mod = qrcodeTerminal as { default?: { generate: Function }; generate?: Function };
    const generate = mod.default?.generate ?? mod.generate;
    if (typeof generate !== 'function') {
      throw new Error('no generate');
    }
    await new Promise<void>((resolve) => {
      generate(url, { small: true }, (qr: string) => {
        process.stdout.write(qr.endsWith('\n') ? qr : `${qr}\n`);
        resolve();
      });
    });
  } catch {
    console.log('Open this URL (DingTalk) to finish app registration:\n');
    console.log(url);
  }
}
