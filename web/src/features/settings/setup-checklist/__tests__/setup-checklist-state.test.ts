import { describe, expect, it } from 'vitest';

import {
  buildSetupStatusSnapshot,
  readOverviewBrowserDiagnosticsInput,
} from '@/features/settings/setup-checklist/setup-checklist-state';

const labels = {
  gatewayOnline: 'online',
  gatewayOffline: 'offline',
  providersConfigured: (count: number) => `${count} providers`,
  providersMetaReady: (configured: number, total: number) => `${configured}/${total} ready`,
  providersMissing: 'no providers',
  modelConfigured: (model: string) => model,
  modelMissing: 'no model',
  channelConfigured: 'channel ok',
  channelMissing: 'no channel',
  skillsConfigured: (count: number) => `${count} skills`,
  skillsMissing: 'no skills',
  readyToChat: 'ready',
};

const localizedLabels = {
  ...labels,
  diagnostics: {
    labels: {
      'tool-runtimes': '智能体工具运行时',
      'gateway-service': '网关系统服务',
    },
    runtimeMissing: (runtimes: string) => `尚未安装 ${runtimes} 运行时。`,
    runtimeInvalid: (runtimes: string) => `${runtimes} 运行时安装无效。`,
    gatewayNotInstalled: '网关尚未安装为系统服务。',
    gatewayUnavailable: (detail: string) => `系统服务后端不可用：${detail}`,
    gatewayNotRunning: (status: string) => `网关系统服务已安装但未运行（状态：${status}）。`,
    providerAuthMissing: '未检测到已配置服务商的 API 密钥。',
    runCommand: (command: string) => `运行：${command}`,
    installCommand: (command: string) => `安装：${command}`,
    startCommand: (command: string) => `启动：${command}`,
    logsHealthy: '日志系统运行正常。',
    logsShuttingDown: '日志系统正在关闭。',
    logsErrors: (count: number) => `过去 24 小时内有 ${count} 个错误。`,
    chromiumInstalled: '已安装本地 Chromium。',
    chromiumNotInstalled: '尚未安装本地 Chromium。',
    extensionConnected: 'Chrome 扩展桥接已连接。',
    extensionNeedsRefresh: 'Chrome 扩展需要刷新。',
    extensionNotConnected: 'Chrome 扩展已安装但尚未连接。',
    extensionNotInstalled: '尚未安装 Chrome 扩展。',
    browserDriverConfigured: (driver: string) => `已配置浏览器驱动“${driver}”。`,
  },
};

function configWithGlobalModel(model: string) {
  return {
    agents: {
      defaults: {
        models: { chat: model ? { primary: model } : undefined },
      },
    },
  };
}

describe('buildSetupStatusSnapshot', () => {
  it('marks required steps incomplete when provider and model are missing', () => {
    const snapshot = buildSetupStatusSnapshot({
      hasToken: true,
      realtimeConnected: true,
      config: { ...configWithGlobalModel(''), providers: {} },
      skillCount: 0,
      labels,
    });

    expect(snapshot.requiredComplete).toBe(false);
    expect(snapshot.checklist.find((i) => i.id === 'provider')?.done).toBe(false);
    expect(snapshot.checklist.find((i) => i.id === 'defaultModel')?.done).toBe(false);
  });

  it('marks required steps complete when gateway, provider, and model are set', () => {
    const snapshot = buildSetupStatusSnapshot({
      hasToken: true,
      realtimeConnected: true,
      config: {
        ...configWithGlobalModel('openai/gpt-4o'),
        providers: { openai: '***' },
      },
      skillCount: 0,
      labels,
    });

    expect(snapshot.requiredComplete).toBe(true);
    expect(snapshot.defaultModel).toBe('openai/gpt-4o');
    expect(snapshot.providerCount).toBe(1);
  });

  it('uses provider meta ratio in detail when available', () => {
    const snapshot = buildSetupStatusSnapshot({
      hasToken: true,
      realtimeConnected: true,
      config: {
        ...configWithGlobalModel('openai/gpt-4o'),
        providers: { openai: '***' },
      },
      skillCount: 0,
      providerMeta: { configured: 3, total: 23 },
      labels,
    });

    expect(snapshot.providerMetaConfigured).toBe(3);
    expect(snapshot.providerMetaTotal).toBe(23);
    expect(snapshot.checklist.find((i) => i.id === 'provider')?.detail).toBe('3/23 ready');
  });

  it('does not count channel catalog metadata as configured', () => {
    const snapshot = buildSetupStatusSnapshot({
      hasToken: true,
      realtimeConnected: true,
      config: {
        channels: {
          telegram: {
            configured: false,
            config: {},
            schema: { type: 'object' },
            uiHints: {},
          },
        },
      },
      skillCount: 0,
      labels,
    });

    expect(snapshot.channelConfigured).toBe(false);
    expect(snapshot.checklist.find((i) => i.id === 'channel')?.done).toBe(false);
  });

  it('counts actual channel config from catalog payload', () => {
    const snapshot = buildSetupStatusSnapshot({
      hasToken: true,
      realtimeConnected: true,
      config: {
        channels: {
          telegram: {
            configured: true,
            config: { enabled: true },
            schema: { type: 'object' },
          },
        },
      },
      skillCount: 0,
      labels,
    });

    expect(snapshot.channelConfigured).toBe(true);
  });

  it('promotes doctor failures into blocking issues', () => {
    const snapshot = buildSetupStatusSnapshot({
      hasToken: true,
      realtimeConnected: true,
      config: {
        ...configWithGlobalModel('openai/gpt-4o'),
        providers: { openai: '***' },
      },
      skillCount: 0,
      doctorChecks: [
        {
          id: 'provider-auth',
          label: 'Provider auth',
          status: 'fail',
          message: 'No provider auth.',
          hints: ['Configure a provider'],
          fixed: false,
        },
      ],
      labels,
    });

    expect(snapshot.healthTier).toBe('blocked');
    expect(snapshot.issues.map((issue) => issue.id)).toEqual(['provider-auth']);
    expect(snapshot.issues[0]?.path).toBe('/settings/capabilities/models');
  });

  it('localizes doctor issue labels, messages, and command hints', () => {
    const snapshot = buildSetupStatusSnapshot({
      hasToken: true,
      realtimeConnected: true,
      config: configWithGlobalModel(''),
      skillCount: 0,
      doctorChecks: [
        {
          id: 'tool-runtimes',
          label: 'Agent tool runtimes',
          status: 'warn',
          message: 'node, uv, python runtime is not installed.',
          hints: ['Run xopc runtime install node'],
          fixed: false,
        },
        {
          id: 'gateway-service',
          label: 'Gateway service',
          status: 'warn',
          message: 'Gateway is not installed as a system service.',
          hints: ['Install: xopc gateway service install'],
          fixed: false,
        },
      ],
      labels: localizedLabels,
    });

    expect(snapshot.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tool-runtimes',
        label: '智能体工具运行时',
        message: '尚未安装 node, uv, python 运行时。',
        hints: ['运行：xopc runtime install node'],
      }),
      expect.objectContaining({
        id: 'gateway-service',
        label: '网关系统服务',
        message: '网关尚未安装为系统服务。',
        hints: ['安装：xopc gateway service install'],
      }),
    ]));
  });
});

describe('readOverviewBrowserDiagnosticsInput', () => {
  it('reads top-level browser runtime config', () => {
    expect(
      readOverviewBrowserDiagnosticsInput({
        browser: { enabled: true, driver: { kind: 'cdp', endpoint: 'ws://127.0.0.1:9222' } },
      }),
    ).toEqual({ enabled: true, driverKind: 'cdp' });
  });
});
