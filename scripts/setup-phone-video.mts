import { loadConfig } from '../src/config/loader.js';
import { resolveStateDir } from '../src/config/paths-state.js';
import { PhoneDependencyManager } from '../src/runtime-tools/phone-dependencies.js';
import { managedScrcpyServerPath, SCRCPY_VERSION } from '../src/runtime-tools/phone-dependency-catalog.js';

const config = loadConfig();
await new PhoneDependencyManager({ stateDir: resolveStateDir(), config: config.runtimeTools }).install('scrcpy');
console.log(`Verified scrcpy ${SCRCPY_VERSION} installed: ${managedScrcpyServerPath()}`);
