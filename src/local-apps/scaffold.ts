import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { LOCAL_APP_RUNTIME_ENTRY, LOCAL_APP_RUNTIME_SOURCE } from './runtime-entry.js';

const LOCAL_APP_PERMISSIONS = ['theme', 'storage'] as const;

function writeText(root: string, relativePath: string, content: string): void {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
}

export function scaffoldLocalApp(input: {
  workspaceRoot: string;
  extensionId: string;
  name: string;
  idea: string;
  description?: string;
}): void {
  const { workspaceRoot, extensionId, name, idea, description } = input;
  const manifest = {
    id: extensionId,
    name,
    description: description || idea,
    version: '0.1.0',
    kind: 'utility',
    main: LOCAL_APP_RUNTIME_ENTRY,
    ui: {
      main: 'ui/index.html',
      permissions: [...LOCAL_APP_PERMISSIONS],
      contributions: {
        pages: [{
          id: 'app',
          title: name,
          path: `/extensions/${extensionId}`,
          entrypoint: 'ui/index.html',
          showInNav: true,
          navIcon: 'layout-dashboard',
        }],
      },
    },
    engines: { xopc: '>=0.0.106 <1.0.0' },
  };

  writeText(workspaceRoot, 'xopc.extension.json', `${JSON.stringify(manifest, null, 2)}\n`);
  writeText(workspaceRoot, 'package.json', `${JSON.stringify({
    name: extensionId,
    private: true,
    version: '0.1.0',
    type: 'module',
  }, null, 2)}\n`);
  writeText(workspaceRoot, LOCAL_APP_RUNTIME_ENTRY, LOCAL_APP_RUNTIME_SOURCE);
  writeText(workspaceRoot, 'APP_BRIEF.md', `# ${name}\n\n${idea}\n\n## Product constraints\n\n- Keep the app local to this XOPC installation.\n- Preserve the extension id: \`${extensionId}\`.\n- Phase 1 is UI-only. Use only the declared theme and storage permissions.\n- Do not edit the manifest \`main\` field or \`${LOCAL_APP_RUNTIME_ENTRY}\`; xopc owns the trusted runtime entry.\n- Keep critical user journeys in \`.xopc/acceptance.json\`. Target only elements marked with \`data-xopc-test-id\`.\n- Run the local-app validation script before asking the user to install an update.\n`);
  writeText(workspaceRoot, '.xopc/app.json', `${JSON.stringify({
    schemaVersion: 1,
    extensionId,
    capabilityLevel: 'ui',
    entrypoint: 'ui/index.html',
  }, null, 2)}\n`);
  writeText(workspaceRoot, '.xopc/acceptance.json', `${JSON.stringify({
    schemaVersion: 1,
    scenarios: [{
      id: 'start-app',
      name: 'Start the app',
      steps: [
        { action: 'click', target: 'primary-action' },
        { assert: 'text_visible', text: '应用已就绪' },
      ],
    }],
  }, null, 2)}\n`);
  writeText(workspaceRoot, 'ui/index.html', `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${htmlEscape(name)}</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <main class="app-shell">
    <section class="hero">
      <h1>${htmlEscape(name)}</h1>
      <p>${htmlEscape(description || idea)}</p>
      <button id="primary-action" data-xopc-test-id="primary-action" type="button">开始使用</button>
      <p id="feedback" data-xopc-test-id="feedback" class="feedback" aria-live="polite"></p>
    </section>
  </main>
  <script type="module" src="./app.js"></script>
</body>
</html>
`);
  writeText(workspaceRoot, 'ui/styles.css', `:root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: #f8fafc; color: #0f172a; }
.app-shell { min-height: 100vh; display: grid; place-items: center; padding: 32px; }
.hero { width: min(680px, 100%); padding: 40px; border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; }
h1 { margin: 0 0 12px; font-size: clamp(32px, 6vw, 56px); line-height: 1.05; letter-spacing: -.03em; text-wrap: balance; }
p { color: #475569; line-height: 1.7; }
button { margin-top: 18px; border: 0; border-radius: 10px; padding: 11px 18px; background: #2563eb; color: #fff; font: inherit; font-weight: 650; cursor: pointer; }
.feedback { min-height: 24px; font-size: 14px; }
@media (prefers-color-scheme: dark) { body { background: #0f172a; color: #f8fafc; } .hero { background: #111827; border-color: #334155; } p { color: #cbd5e1; } }
`);
  writeText(workspaceRoot, 'ui/app.js', `const button = document.querySelector('#primary-action');
const feedback = document.querySelector('#feedback');
button?.addEventListener('click', () => {
  feedback.textContent = '应用已就绪。接下来可以在 Project 中继续告诉 Coder 你的想法。';
});
`);
}

export function readLocalAppPermissions(workspaceRoot: string): string[] {
  try {
    const raw = JSON.parse(readFileSync(join(workspaceRoot, 'xopc.extension.json'), 'utf8')) as {
      ui?: { permissions?: unknown };
    };
    return Array.isArray(raw.ui?.permissions)
      ? raw.ui.permissions.filter((permission): permission is string => typeof permission === 'string')
      : [];
  } catch {
    return [];
  }
}
