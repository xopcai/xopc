import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PI_RUNTIME_PACKAGES = [
  '@earendil-works/chord',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-codemode',
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-mcp',
  '@earendil-works/pi-tui',
];

export function collectPublishManifestErrors(packageJson) {
  const errors = [];
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, specifier] of Object.entries(packageJson[section] ?? {})) {
      if (typeof specifier === 'string' && specifier.startsWith('workspace:')) {
        errors.push(`Runtime dependency ${section}.${name} must not use ${specifier}`);
      }
    }
  }
  // These packages share internal APIs; upstream minor versions can remove exports.
  const version = packageJson.dependencies?.['@earendil-works/pi-coding-agent'];
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version ?? '')) {
    errors.push('pi-coding-agent must have an exact runtime version');
  }
  for (const name of PI_RUNTIME_PACKAGES) {
    if (!version || packageJson.dependencies?.[name] !== version) {
      errors.push(`${name} must be a direct dependency pinned to pi-coding-agent ${version ?? '<missing>'}`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const errors = collectPublishManifestErrors(packageJson);
  if (errors.length === 0) {
    const { verifyInstalledGatewayRuntime } = await import(
      pathToFileURL(join(root, 'dist/src/infra/package-runtime-check.js')).href
    );
    errors.push(...await verifyInstalledGatewayRuntime({ packageRoot: root }));
  }
  if (errors.length > 0) {
    console.error(['Publish manifest check failed.', ...errors.map((entry) => `- ${entry}`)].join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Publish manifest and gateway runtime check passed.');
  }
}
