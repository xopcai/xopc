/**
 * Field-level settings index for the global command palette.
 *
 * Each entry represents a specific settings field (e.g. "temperature",
 * "gateway port", "TTS provider") so users can cmd-K → type a field name
 * → jump directly to the relevant settings page.
 *
 * This is a static definition — no API calls needed. The palette merges
 * these seeds with other hit sources (routes, quick settings, etc.).
 */

import type { GlobalHit } from '@/features/search/global-command-palette/types';
import type { StoredLanguage } from '@/lib/storage';
import type { NavigateFunction } from 'react-router-dom';

interface FieldSeed {
  id: string;
  title: string;
  subtitle: string;
  path: string;
  keywords: string[];
}

function buildFieldSeeds(language: StoredLanguage): FieldSeed[] {
  const isZh = language === 'zh';

  return [
    // --- Gateway ---
    {
      id: 'field:gateway:port',
      title: isZh ? '网关端口' : 'Gateway Port',
      subtitle: isZh ? '设置 HTTP 网关监听端口' : 'HTTP gateway listen port',
      path: '/settings/gateway',
      keywords: ['port', 'listen', 'http', 'server', '端口'],
    },
    {
      id: 'field:gateway:host',
      title: isZh ? '网关绑定地址' : 'Gateway Host',
      subtitle: isZh ? '设置绑定的网络接口' : 'Network interface to bind',
      path: '/settings/gateway',
      keywords: ['host', 'bind', 'interface', 'localhost', '地址'],
    },
    {
      id: 'field:gateway:auth',
      title: isZh ? '网关认证令牌' : 'Gateway Auth Token',
      subtitle: isZh ? '访问网关所需的 Bearer token' : 'Bearer token for gateway access',
      path: '/settings/gateway',
      keywords: ['auth', 'token', 'bearer', 'password', 'security', '认证', '令牌'],
    },

    // --- Global agent defaults ---
    {
      id: 'field:agent-defaults:models',
      title: isZh ? 'Agent 全局模型' : 'Global agent models',
      subtitle: isZh ? '设置所有 Agent 继承的模型与回退' : 'Set inherited models and fallbacks',
      path: '/settings/agent-defaults',
      keywords: ['agent defaults', 'model intents', 'fallbacks', 'llm', '全局默认', '模型意图'],
    },
    {
      id: 'field:agent-defaults:skills',
      title: isZh ? 'Agent 全局技能' : 'Global agent skills',
      subtitle: isZh ? '设置所有 Agent 默认可用或排除的技能' : 'Set skills enabled or excluded for every agent',
      path: '/settings/agent-defaults',
      keywords: ['agent defaults', 'skills', 'inherit', '全局默认', '技能', '继承'],
    },
    {
      id: 'field:agent-defaults:tools',
      title: isZh ? 'Agent 全局工具权限' : 'Global agent tool permissions',
      subtitle: isZh ? '设置所有 Agent 继承的 allow、ask 或 deny 策略' : 'Set inherited allow, ask, or deny policies',
      path: '/settings/agent-defaults',
      keywords: ['agent defaults', 'tools', 'permissions', 'allow', 'ask', 'deny', '工具权限'],
    },
    {
      id: 'field:agent-defaults:runtime',
      title: isZh ? 'Agent 全局运行限制' : 'Global agent runtime limits',
      subtitle: isZh ? '设置继承的轮次、超时和默认工作流' : 'Set inherited turn, timeout, and workflow limits',
      path: '/settings/agent-defaults',
      keywords: ['agent defaults', 'runtime', 'turns', 'timeout', 'workflow', '运行限制'],
    },

    // --- Agent-specific profile ---
    {
      id: 'field:agent:profile',
      title: isZh ? 'Agent 个性' : 'Agent personality',
      subtitle: isZh ? '设置名称、个性指令和可选覆盖' : 'Set the name, personality, and optional overrides',
      path: '/agents',
      keywords: ['agent', 'profile', 'personality', 'instructions', 'agent 个性', '指令'],
    },
    {
      id: 'field:agent:workspace',
      title: isZh ? 'Agent 工作目录' : 'Agent workspace',
      subtitle: isZh ? '按需覆盖该 Agent 的自动工作目录' : 'Optionally override the automatic workspace',
      path: '/agents',
      keywords: ['workspace', 'directory', 'folder', 'path', 'cwd', '工作目录'],
    },

    // --- Browser settings ---
    {
      id: 'field:agent:browser',
      title: isZh ? '浏览器自动化' : 'Browser automation',
      subtitle: isZh ? '启用 browser_use 工具' : 'Enable browser_use tools',
      path: '/settings/agent-browser',
      keywords: ['browser', 'browser_use', 'automation', '浏览器'],
    },
    {
      id: 'field:agent:browser-extension',
      title: isZh ? 'Chrome 扩展连接' : 'Chrome extension bridge',
      subtitle: isZh ? '安装扩展并启动 WebSocket 桥接' : 'Install extension and start the bridge',
      path: '/settings/agent-browser',
      keywords: ['extension', 'chrome', 'bridge', 'websocket', '扩展', '桥接'],
    },
    {
      id: 'field:agent:browser-playwright',
      title: isZh ? '安装 Playwright Chromium' : 'Install Playwright Chromium',
      subtitle: isZh ? '本地 Playwright 后端就绪检查' : 'Local Playwright backend setup',
      path: '/settings/agent-browser',
      keywords: ['playwright', 'chromium', 'install', 'local', '安装'],
    },
    {
      id: 'field:agent:browser-cloak',
      title: isZh ? 'CloakBrowser 配置' : 'CloakBrowser settings',
      subtitle: isZh ? '反指纹浏览器下载与高级选项' : 'Stealth browser download and fingerprint options',
      path: '/settings/agent-browser',
      keywords: ['cloak', 'cloakbrowser', 'fingerprint', 'stealth', '反指纹'],
    },
    {
      id: 'field:agent:browser-headless',
      title: isZh ? '浏览器无头模式' : 'Browser headless mode',
      subtitle: isZh ? '隐藏浏览器窗口' : 'Run without a visible window',
      path: '/settings/agent-browser',
      keywords: ['headless', 'window', 'visible', '无头'],
    },
    {
      id: 'field:agent:browser-private-urls',
      title: isZh ? '允许内网 URL' : 'Allow private URLs',
      subtitle: isZh ? '浏览器导航安全限制' : 'Browser navigation security policy',
      path: '/settings/agent-browser',
      keywords: ['private', 'internal', 'localhost', 'security', '内网', '安全'],
    },

    // --- Voice (STT/TTS) ---
    {
      id: 'field:voice:sttProvider',
      title: isZh ? 'STT 语音识别提供商' : 'STT Provider',
      subtitle: isZh ? '语音转文字服务商' : 'Speech-to-text service provider',
      path: '/settings/capabilities/voice',
      keywords: ['stt', 'speech', 'recognition', 'whisper', 'deepgram', '语音识别'],
    },
    {
      id: 'field:voice:ttsProvider',
      title: isZh ? 'TTS 语音合成提供商' : 'TTS Provider',
      subtitle: isZh ? '文字转语音服务商' : 'Text-to-speech service provider',
      path: '/settings/capabilities/voice',
      keywords: ['tts', 'speech', 'synthesis', 'voice', 'elevenlabs', '语音合成'],
    },

    // --- Web Search ---
    {
      id: 'field:search:engine',
      title: isZh ? '搜索引擎' : 'Web Search Engine',
      subtitle: isZh ? '联网搜索使用的引擎' : 'Engine for web search tool',
      path: '/settings/capabilities/search',
      keywords: ['search', 'engine', 'tavily', 'serper', 'brave', 'bing', '搜索引擎'],
    },

    // --- Automations ---
    {
      id: 'field:automations:enabled',
      title: isZh ? '自动化' : 'Automations',
      subtitle: isZh ? '创建和管理自动化' : 'Create and manage automations',
      path: '/automations',
      keywords: ['automation', 'automations', 'scheduler', 'timer', '自动化', '调度'],
    },
    {
      id: 'field:automations:runs',
      title: isZh ? '自动化运行记录' : 'Automation Runs',
      subtitle: isZh ? '查看自动化执行历史' : 'Review automation run history',
      path: '/automations',
      keywords: ['automation', 'runs', 'history', '自动化', '历史'],
    },

    // --- Channels ---
    {
      id: 'field:channels:telegram',
      title: isZh ? 'Telegram Bot Token' : 'Telegram Bot Token',
      subtitle: isZh ? '配置 Telegram 频道连接' : 'Configure Telegram channel connection',
      path: '/channels',
      keywords: ['telegram', 'bot', 'token', 'channel', '频道'],
    },
    {
      id: 'field:channels:dmPolicy',
      title: isZh ? '私聊接入策略' : 'DM Access Policy',
      subtitle: isZh ? 'Telegram 私聊白名单/配对策略' : 'Telegram DM allowlist/pairing policy',
      path: '/channels',
      keywords: ['dm', 'policy', 'pairing', 'allowlist', 'access', '私聊', '策略'],
    },

    // --- MCP ---
    {
      id: 'field:mcp:servers',
      title: isZh ? 'MCP 服务器配置' : 'MCP Servers',
      subtitle: isZh ? '外部 MCP 工具服务器列表' : 'External MCP tool server registry',
      path: '/connectors',
      keywords: ['mcp', 'server', 'tools', 'external', 'stdio', '服务器', 'connector'],
    },

    // --- Heartbeat ---
    {
      id: 'field:heartbeat:interval',
      title: isZh ? '心跳间隔' : 'Heartbeat Interval',
      subtitle: isZh ? '网关存活检测频率' : 'Gateway keep-alive check frequency',
      path: '/settings/heartbeat',
      keywords: ['heartbeat', 'interval', 'keepalive', 'alive', '心跳'],
    },

    // --- Remote Access ---
    {
      id: 'field:tunnel:enabled',
      title: isZh ? '公网隧道' : 'Public Tunnel',
      subtitle: isZh ? 'FRP 远程访问隧道开关' : 'FRP remote access tunnel toggle',
      path: '/settings/remote-access',
      keywords: ['tunnel', 'frp', 'remote', 'public', 'ngrok', '隧道', '远程'],
    },
  ];
}

export function buildSettingsFieldHits(
  language: StoredLanguage,
  navigate: NavigateFunction,
  closePalette: () => void,
  groupLabel: string,
): Array<Omit<GlobalHit, 'rank'>> {
  return buildFieldSeeds(language).map((seed) => ({
    kind: 'setting' as const,
    id: seed.id,
    title: seed.title,
    subtitle: seed.subtitle,
    groupLabel,
    keywords: seed.keywords,
    run: () => {
      closePalette();
      navigate(seed.path);
    },
  }));
}
