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

    // --- Agent defaults: Chat ---
    {
      id: 'field:agent:model',
      title: isZh ? '默认模型' : 'Default Model',
      subtitle: isZh ? '对话使用的 LLM 模型' : 'LLM model for conversations',
      path: '/settings/agent-defaults',
      keywords: ['model', 'llm', 'gpt', 'claude', 'gemini', '模型'],
    },
    {
      id: 'field:agent:temperature',
      title: isZh ? '温度 (Temperature)' : 'Temperature',
      subtitle: isZh ? '控制回复的随机性' : 'Controls response randomness',
      path: '/settings/agent-defaults?tab=generation',
      keywords: ['temperature', 'sampling', 'randomness', 'creative', '温度', '随机'],
    },
    {
      id: 'field:agent:maxTokens',
      title: isZh ? '最大输出 Tokens' : 'Max Output Tokens',
      subtitle: isZh ? '单次回复的最大 token 数' : 'Maximum tokens per response',
      path: '/settings/agent-defaults?tab=generation',
      keywords: ['max', 'tokens', 'output', 'length', 'limit', '最大'],
    },

    // --- Agent defaults: Workspace ---
    {
      id: 'field:agent:workspace',
      title: isZh ? '工作目录' : 'Workspace Directory',
      subtitle: isZh ? '代理的默认工作目录' : 'Default working directory for the agent',
      path: '/settings/agent-defaults?tab=workspace',
      keywords: ['workspace', 'directory', 'folder', 'path', 'cwd', '工作目录'],
    },

    // --- Agent defaults: Browser ---
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
      path: '/settings/agent-browser?tab=extension',
      keywords: ['extension', 'chrome', 'bridge', 'websocket', '扩展', '桥接'],
    },
    {
      id: 'field:agent:browser-playwright',
      title: isZh ? '安装 Playwright Chromium' : 'Install Playwright Chromium',
      subtitle: isZh ? '本地 Playwright 后端就绪检查' : 'Local Playwright backend setup',
      path: '/settings/agent-browser?tab=local',
      keywords: ['playwright', 'chromium', 'install', 'local', '安装'],
    },
    {
      id: 'field:agent:browser-cloak',
      title: isZh ? 'CloakBrowser 配置' : 'CloakBrowser settings',
      subtitle: isZh ? '反指纹浏览器下载与高级选项' : 'Stealth browser download and fingerprint options',
      path: '/settings/agent-browser?tab=cloakbrowser',
      keywords: ['cloak', 'cloakbrowser', 'fingerprint', 'stealth', '反指纹'],
    },
    {
      id: 'field:agent:browser-headless',
      title: isZh ? '浏览器无头模式' : 'Browser headless mode',
      subtitle: isZh ? '隐藏浏览器窗口' : 'Run without a visible window',
      path: '/settings/agent-browser?focus=runtime',
      keywords: ['headless', 'window', 'visible', '无头'],
    },
    {
      id: 'field:agent:browser-private-urls',
      title: isZh ? '允许内网 URL' : 'Allow private URLs',
      subtitle: isZh ? '浏览器导航安全限制' : 'Browser navigation security policy',
      path: '/settings/agent-browser?focus=security',
      keywords: ['private', 'internal', 'localhost', 'security', '内网', '安全'],
    },

    // --- Agent defaults: Runtime ---
    {
      id: 'field:agent:turnLimit',
      title: isZh ? '轮次限制' : 'Turn Limit',
      subtitle: isZh ? '单次会话最大对话轮次' : 'Maximum turns per session run',
      path: '/settings/agent-defaults?tab=runtime',
      keywords: ['turn', 'limit', 'iterations', 'max', '轮次', '限制'],
    },
    {
      id: 'field:agent:timeout',
      title: isZh ? '超时时间' : 'Timeout',
      subtitle: isZh ? '单次工具调用的超时' : 'Tool execution timeout',
      path: '/settings/agent-defaults?tab=runtime',
      keywords: ['timeout', 'duration', 'seconds', '超时'],
    },

    // --- Agent defaults: Context ---
    {
      id: 'field:agent:compaction',
      title: isZh ? '上下文压缩' : 'Context Compaction',
      subtitle: isZh ? '长对话自动压缩策略' : 'Auto-compact strategy for long conversations',
      path: '/settings/agent-defaults?tab=context',
      keywords: ['compaction', 'context', 'pruning', 'tokens', 'window', '压缩', '上下文'],
    },

    // --- Agent defaults: Memory ---
    {
      id: 'field:agent:memory',
      title: isZh ? '记忆设置' : 'Memory Settings',
      subtitle: isZh ? '会话记忆与回顾配置' : 'Session memory and review configuration',
      path: '/settings/agent-defaults?tab=memory',
      keywords: ['memory', 'review', 'session', 'recall', '记忆'],
    },

    // --- Agent defaults: System Prompt ---
    {
      id: 'field:agent:systemPrompt',
      title: isZh ? '系统提示词' : 'System Prompt',
      subtitle: isZh ? '自定义系统指令' : 'Custom system instructions',
      path: '/settings/agent-defaults?tab=system-prompt',
      keywords: ['system', 'prompt', 'instructions', 'persona', '系统提示词', '指令'],
    },

    // --- Voice (STT/TTS) ---
    {
      id: 'field:voice:sttProvider',
      title: isZh ? 'STT 语音识别提供商' : 'STT Provider',
      subtitle: isZh ? '语音转文字服务商' : 'Speech-to-text service provider',
      path: '/settings/credentials?tab=voice',
      keywords: ['stt', 'speech', 'recognition', 'whisper', 'deepgram', '语音识别'],
    },
    {
      id: 'field:voice:ttsProvider',
      title: isZh ? 'TTS 语音合成提供商' : 'TTS Provider',
      subtitle: isZh ? '文字转语音服务商' : 'Text-to-speech service provider',
      path: '/settings/credentials?tab=voice',
      keywords: ['tts', 'speech', 'synthesis', 'voice', 'elevenlabs', '语音合成'],
    },

    // --- Web Search ---
    {
      id: 'field:search:engine',
      title: isZh ? '搜索引擎' : 'Web Search Engine',
      subtitle: isZh ? '联网搜索使用的引擎' : 'Engine for web search tool',
      path: '/settings/credentials?tab=search',
      keywords: ['search', 'engine', 'tavily', 'serper', 'brave', 'bing', '搜索引擎'],
    },

    // --- Cron ---
    {
      id: 'field:cron:enabled',
      title: isZh ? '定时任务开关' : 'Cron Enabled',
      subtitle: isZh ? '启用/禁用定时调度器' : 'Enable or disable the scheduler',
      path: '/cron?tab=settings',
      keywords: ['cron', 'enabled', 'scheduler', 'timer', '定时', '调度'],
    },
    {
      id: 'field:cron:timezone',
      title: isZh ? '定时任务时区' : 'Cron Timezone',
      subtitle: isZh ? '调度器使用的时区' : 'Timezone for the scheduler',
      path: '/cron?tab=settings',
      keywords: ['timezone', 'tz', 'utc', 'cron', '时区'],
    },

    // --- Channels ---
    {
      id: 'field:channels:telegram',
      title: isZh ? 'Telegram Bot Token' : 'Telegram Bot Token',
      subtitle: isZh ? '配置 Telegram 频道连接' : 'Configure Telegram channel connection',
      path: '/settings/channels',
      keywords: ['telegram', 'bot', 'token', 'channel', '频道'],
    },
    {
      id: 'field:channels:dmPolicy',
      title: isZh ? '私聊接入策略' : 'DM Access Policy',
      subtitle: isZh ? 'Telegram 私聊白名单/配对策略' : 'Telegram DM allowlist/pairing policy',
      path: '/settings/channels',
      keywords: ['dm', 'policy', 'pairing', 'allowlist', 'access', '私聊', '策略'],
    },

    // --- MCP ---
    {
      id: 'field:mcp:servers',
      title: isZh ? 'MCP 服务器配置' : 'MCP Servers',
      subtitle: isZh ? '外部 MCP 工具服务器列表' : 'External MCP tool server registry',
      path: '/settings/connectors',
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
