#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(process.argv[2] || '.');
const trustedRuntimeEntry = '.xopc/runtime/local-ui.js';
const trustedRuntimeSource = 'export default Object.freeze({});\n';
const required = ['.xopc/app.json', 'xopc.extension.json', 'ui/index.html'];
const errors = required.filter((file) => !existsSync(join(root, file))).map((file) => `Missing ${file}`);

let app = {};
let manifest = {};
let acceptance = null;
try { app = JSON.parse(readFileSync(join(root, '.xopc/app.json'), 'utf8')); } catch { errors.push('Invalid .xopc/app.json'); }
try { manifest = JSON.parse(readFileSync(join(root, 'xopc.extension.json'), 'utf8')); } catch { errors.push('Invalid xopc.extension.json'); }
if (existsSync(join(root, '.xopc/acceptance.json'))) {
  try { acceptance = JSON.parse(readFileSync(join(root, '.xopc/acceptance.json'), 'utf8')); } catch { errors.push('Invalid .xopc/acceptance.json'); }
}

if (app.extensionId !== manifest.id) errors.push('App metadata and manifest ids do not match');
if (app.capabilityLevel !== 'ui') errors.push('Phase 1 capabilityLevel must be ui');
const legacyRuntimeSource = `export default {\n  id: ${JSON.stringify(manifest.id)},\n  name: ${JSON.stringify(manifest.name)},\n  version: '0.1.0',\n  kind: 'utility',\n  register(api) {\n    api.logger.info('Local app registered');\n  },\n};\n`;
const recognizedRuntimeEntry = manifest.main === trustedRuntimeEntry || manifest.main === 'index.js';
const runtimeSource = recognizedRuntimeEntry && existsSync(join(root, manifest.main))
  ? readFileSync(join(root, manifest.main), 'utf8')
  : null;
const trustedRuntime = manifest.main === trustedRuntimeEntry && runtimeSource === trustedRuntimeSource;
const trustedLegacyRuntime = manifest.main === 'index.js' && runtimeSource === legacyRuntimeSource;
if (!trustedRuntime && !trustedLegacyRuntime) errors.push(`Phase 1 runtime main must be the unchanged xopc-owned ${trustedRuntimeEntry}`);
if (manifest.ui?.main !== app.entrypoint) errors.push('UI entrypoints do not match');
if (manifest.ui?.contributions?.pages?.[0]?.path !== `/extensions/${manifest.id}`) {
  errors.push('Navigation path must use the stable extension id');
}

const testIdPattern = /^[A-Za-z0-9_-]{1,80}$/;
if (acceptance) {
  if (acceptance.schemaVersion !== 1 || !Array.isArray(acceptance.scenarios) || acceptance.scenarios.length > 10) {
    errors.push('Acceptance config must use schemaVersion 1 and contain at most 10 scenarios');
  } else {
    const ids = new Set();
    acceptance.scenarios.forEach((scenario, scenarioIndex) => {
      const label = `Acceptance scenario ${scenarioIndex + 1}`;
      if (!testIdPattern.test(scenario?.id || '') || ids.has(scenario.id)) errors.push(`${label} has an invalid or duplicate id`);
      else ids.add(scenario.id);
      if (typeof scenario?.name !== 'string' || !scenario.name.trim() || scenario.name.length > 120) errors.push(`${label} has an invalid name`);
      if (!Array.isArray(scenario?.steps) || !scenario.steps.length || scenario.steps.length > 20) {
        errors.push(`${label} must contain 1 to 20 steps`);
        return;
      }
      scenario.steps.forEach((step, stepIndex) => {
        const stepLabel = `${label} step ${stepIndex + 1}`;
        const hasOnly = (...keys) => Object.keys(step || {}).every((key) => keys.includes(key));
        const validTarget = typeof step.target === 'string' && testIdPattern.test(step.target);
        const validValue = typeof step.value === 'string' && step.value.length <= 500;
        const validText = typeof step.text === 'string' && step.text.trim() && step.text.length <= 500;
        const valid = step.action === 'click' && validTarget && hasOnly('action', 'target')
          || step.action === 'fill' && validTarget && validValue && hasOnly('action', 'target', 'value')
          || step.assert === 'text_visible' && validText && hasOnly('assert', 'text')
          || step.assert === 'element_exists' && validTarget && hasOnly('assert', 'target')
          || step.assert === 'value_equals' && validTarget && validValue && hasOnly('assert', 'target', 'value');
        if (!valid) errors.push(`${stepLabel} uses an unsupported or invalid operation`);
      });
    });
  }
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Local app ${manifest.id} is valid.`);
}
