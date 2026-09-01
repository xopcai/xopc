import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const runtimeSections = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const optionalLocalRuntimePeers = ['@huggingface/transformers', 'sherpa-onnx-node'];
const invalid = [];

for (const section of runtimeSections) {
  for (const [name, specifier] of Object.entries(packageJson[section] ?? {})) {
    if (typeof specifier === 'string' && specifier.startsWith('workspace:')) {
      invalid.push(`${section}.${name} (${specifier})`);
    }
  }
}

for (const name of optionalLocalRuntimePeers) {
  if (!packageJson.peerDependencies?.[name]) {
    invalid.push(`peerDependencies.${name} (missing optional local runtime peer)`);
  }
  if (packageJson.peerDependenciesMeta?.[name]?.optional !== true) {
    invalid.push(`peerDependenciesMeta.${name}.optional (must be true)`);
  }
  if (packageJson.optionalDependencies?.[name]) {
    invalid.push(`optionalDependencies.${name} (must not install by default)`);
  }
}

if (invalid.length > 0) {
  console.error(
    [
      'Publish manifest check failed.',
      'Runtime dependencies must not use workspace ranges, and local model runtimes must remain optional peers:',
      ...invalid.map((entry) => `- ${entry}`),
    ].join('\n'),
  );
  process.exitCode = 1;
} else {
  console.log('Publish manifest check passed.');
}
