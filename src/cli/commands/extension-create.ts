import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Command } from 'commander';

import { PACKAGE_VERSION } from '../../package-version.js';
import { colors } from '../utils/colors.js';

const TEMPLATE_TYPES = ['tool', 'ui', 'provider', 'channel'] as const;
type TemplateType = (typeof TEMPLATE_TYPES)[number];

function toPackageName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function basePackageJson(id: string, template: TemplateType): Record<string, unknown> {
  const scripts: Record<string, string> = {
    build: template === 'ui' ? 'tsc -p tsconfig.json && npm run build:ui' : 'tsc -p tsconfig.json',
    prepack: 'npm run build',
  };
  if (template === 'ui') scripts['build:ui'] = 'node scripts/build-ui.mjs';
  const devDependencies: Record<string, string> = {
    '@xopcai/xopc': `^${PACKAGE_VERSION}`,
    typescript: '^6.0.0',
  };
  if (template === 'ui') {
    devDependencies['@xopcai/extension-ui-sdk'] = `^${PACKAGE_VERSION}`;
    devDependencies.esbuild = '^0.28.1';
  }
  return {
    name: `xopc-extension-${id}`,
    version: '0.1.0',
    type: 'module',
    main: 'dist/index.js',
    files: ['dist', 'ui', 'xopc.extension.json', 'README.md', 'LICENSE'],
    keywords: ['xopc', 'xopc-extension'],
    license: 'MIT',
    scripts,
    devDependencies,
    peerDependencies: {
      '@xopcai/xopc': `>=${PACKAGE_VERSION} <1.0.0`,
    },
    peerDependenciesMeta: {
      '@xopcai/xopc': { optional: true },
    },
  };
}

function manifestFor(id: string, template: TemplateType): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id,
    name: id.split('-').map((s) => s[0]?.toUpperCase() + s.slice(1)).join(' '),
    description: `xopc ${template} extension`,
    version: '0.1.0',
    kind: template === 'provider' ? 'provider' : template === 'channel' ? 'channel' : template === 'tool' ? 'tool' : 'utility',
    main: 'dist/index.js',
    engines: { xopc: `>=${PACKAGE_VERSION} <1.0.0` },
  };
  if (template === 'tool') {
    base.contracts = { tools: [`${id.replace(/-/g, '_')}_echo`] };
  } else if (template === 'provider') {
    base.providers = [id];
    base.contracts = { providers: [id] };
  } else if (template === 'channel') {
    base.channels = [id];
    base.contracts = { channels: [id] };
    base.activation = { onChannels: [id] };
    base.channelContributions = {
      [id]: {
        label: base.name,
        description: `Channel integration for ${base.name}`,
        configPath: `channels.${id}`,
        capabilities: { multiAccount: false, streaming: false, media: false },
        configSchema: { type: 'object', additionalProperties: true },
      },
    };
  } else {
    base.contracts = {};
    base.ui = {
      main: 'ui/panel.html',
      permissions: ['theme'],
      contributions: {
        pages: [{ id: `${id}.page`, title: base.name, path: id, entrypoint: 'ui/panel.html', showInNav: true }],
      },
    };
  }
  return base;
}

function buildUiScriptSource(): string {
  return `import { build } from 'esbuild';\n\nawait build({\n  entryPoints: ['ui/panel-entry.ts'],\n  outfile: 'ui/panel.bundle.js',\n  bundle: true,\n  format: 'esm',\n  platform: 'browser',\n  target: ['es2022'],\n  sourcemap: false,\n});\n`;
}

function uiPanelEntrySource(id: string): string {
  return `import { createExtensionClient } from '@xopcai/extension-ui-sdk';\n\nconst root = document.getElementById('root');\nconst client = createExtensionClient();\n\nasync function main() {\n  await client.whenReady();\n  const theme = await client.theme.getTheme();\n  if (root) {\n    root.innerHTML = \`<main style="font-family: system-ui; padding: 16px">\n      <h1>${id}</h1>\n      <p>Theme mode: \${theme.mode}</p>\n      <button id="notify">Show notification</button>\n    </main>\`;\n    document.getElementById('notify')?.addEventListener('click', () => {\n      void client.ui.showNotification({ type: 'info', message: '${id} is ready' });\n    });\n  }\n}\n\nvoid main();\n`;
}

function sourceFor(id: string, template: TemplateType): string {
  const toolName = `${id.replace(/-/g, '_')}_echo`;
  if (template === 'provider') {
    return `import type { ExtensionApi } from '@xopcai/xopc/extension-sdk';\n\nexport default function register(api: ExtensionApi) {\n  api.registerProvider({\n    id: '${id}',\n    name: '${id}',\n    models: [],\n    createStream: async function* () {\n      yield { type: 'text', text: 'Provider template: implement createStream().' };\n    },\n  } as any);\n}\n`;
  }
  if (template === 'ui') {
    return `import type { ExtensionApi } from '@xopcai/xopc/extension-sdk';\n\nexport default function register(api: ExtensionApi) {\n  api.logger.info('${id} UI extension loaded');\n}\n`;
  }
  if (template === 'channel') {
    return `import type { ChannelPlugin, ExtensionApi } from '@xopcai/xopc/extension-sdk';\n\nconst plugin: ChannelPlugin = {\n  id: '${id}' as any,\n  meta: { id: '${id}' as any, name: '${id}', description: '${id} channel' } as any,\n  capabilities: { inbound: true, outbound: true } as any,\n  async init() {},\n  async start() {},\n  async stop() {},\n  config: {\n    resolveAccounts() { return []; },\n  } as any,\n};\n\nexport default function register(api: ExtensionApi) {\n  api.registerChannel({ plugin });\n}\n`;
  }
  return `import type { ExtensionApi } from '@xopcai/xopc/extension-sdk';\n\nexport default function register(api: ExtensionApi) {\n  api.registerTool({\n    name: '${toolName}',\n    label: 'Echo text',\n    description: 'Echo input text',\n    parameters: {\n      type: 'object',\n      properties: { text: { type: 'string' } },\n      required: ['text'],\n    },\n    async execute(_toolCallId, params) {\n      return {\n        content: [{ type: 'text', text: String((params as any).text) }],\n        details: {},\n      };\n    },\n  });\n}\n`;
}

export function createExtensionCreateCommand(): Command {
  return new Command('create')
    .description('Create a new independent extension package')
    .argument('<name>', 'Extension id / package suffix')
    .option('--template <type>', `Template: ${TEMPLATE_TYPES.join(', ')}`, 'tool')
    .option('--dir <path>', 'Output directory (default: ./<name>)')
    .action((name: string, opts: { template: string; dir?: string }) => {
      const id = toPackageName(name);
      if (!id) {
        console.error(colors.red('error:'), 'Invalid extension name');
        process.exit(1);
      }
      const template = opts.template as TemplateType;
      if (!TEMPLATE_TYPES.includes(template)) {
        console.error(colors.red('error:'), `Unknown template: ${opts.template}`);
        process.exit(1);
      }
      const root = resolve(opts.dir?.trim() || id);
      if (existsSync(root)) {
        console.error(colors.red('error:'), `Directory already exists: ${root}`);
        process.exit(1);
      }
      mkdirSync(join(root, 'src'), { recursive: true });
      writeJson(join(root, 'package.json'), basePackageJson(id, template));
      writeJson(join(root, 'xopc.extension.json'), manifestFor(id, template));
      writeJson(join(root, 'tsconfig.json'), {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          declaration: true,
          outDir: 'dist',
          rootDir: 'src',
          strict: true,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      });
      writeFileSync(join(root, 'src', 'index.ts'), sourceFor(id, template));
      if (template === 'ui') {
        mkdirSync(join(root, 'ui'), { recursive: true });
        mkdirSync(join(root, 'scripts'), { recursive: true });
        writeFileSync(join(root, 'ui', 'panel.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="./panel.bundle.js"></script></body></html>\n');
        writeFileSync(join(root, 'ui', 'panel-entry.ts'), uiPanelEntrySource(id));
        writeFileSync(join(root, 'scripts', 'build-ui.mjs'), buildUiScriptSource());
      }
      writeFileSync(join(root, 'README.md'), `# ${id}\n\nGenerated xopc extension.\n`);
      writeFileSync(join(root, 'LICENSE'), 'MIT\n');
      console.log(colors.green('✓'), `Created extension package at ${root}`);
      console.log(colors.cyan('Next:'), `cd ${root} && npm install && npm run build && xopc extensions pack . --dry-run`);
    });
}
