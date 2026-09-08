import { loadConfig } from '../../config/loader.js';
import { checkBrowserReadiness } from '../../browser/readiness.js';

export async function doctorCli(): Promise<void> {
  const config = await loadConfig();
  const readiness = await checkBrowserReadiness(config);
  console.log('Browser Control v2');
  console.log(`Driver: ${config.browser.driver.kind}`);
  if (!readiness) {
    console.log('Status: ready');
    return;
  }
  console.error(`Status: ${readiness.hint.reason}`);
  if (readiness.hint.detail) console.error(`Detail: ${readiness.hint.detail}`);
  process.exitCode = 1;
}
