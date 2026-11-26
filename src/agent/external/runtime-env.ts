import type { ExternalAgentExecution } from '../../agent-config/schema.js';

const HOST_ENV = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LANGUAGE', 'TZ', 'TERM',
  'TMPDIR', 'TEMP', 'TMP', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'COMSPEC',
  'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR',
  'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
];

const PROVIDER_ENV: Record<ExternalAgentExecution['kind'], readonly string[]> = {
  codex: ['CODEX_HOME', 'CODEX_API_KEY', 'OPENAI_API_KEY'],
  claude: ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'],
  agy: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION'],
};

/** Keep Gateway credentials and other providers' settings out of runtime subprocesses. */
export function buildExternalRuntimeEnv(
  kind: ExternalAgentExecution['kind'],
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowed = new Set([...HOST_ENV, ...PROVIDER_ENV[kind]]);
  return Object.fromEntries(Object.entries(source).filter(([key]) => {
    const upper = key.toUpperCase();
    return allowed.has(upper) || upper.startsWith('LC_');
  }));
}
