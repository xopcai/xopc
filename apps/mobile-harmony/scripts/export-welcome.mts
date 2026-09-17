import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { en } from '../../mobile-expo/src/i18n/locales/en.ts';
import { zh } from '../../mobile-expo/src/i18n/locales/zh.ts';

// Copy only product-owned text; ranking stays native and is checked against the shared contract.
const directory = new URL('../entry/src/main/resources/rawfile/', import.meta.url);
for (const [locale, messages] of [['en', en], ['zh', zh]] as const) {
  const data = { copy: messages.chat.welcomeSpotlight, names: messages.agentsPage.builtInAgents };
  const output = JSON.stringify(data, null, 2) + '\n';
  const destination = new URL(`welcome-${locale}.json`, directory);
  if (process.argv.includes('--check')) {
    if (await readFile(destination, 'utf8') !== output) throw new Error(`Stale ${locale} welcome copy; run export-welcome.mts`);
  } else { await mkdir(directory, { recursive: true }); await writeFile(destination, output); }
}
console.log(process.argv.includes('--check') ? 'Harmony welcome copy is current' : 'Exported shared mobile welcome copy');
