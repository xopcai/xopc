import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const setupFile = path.resolve(__dirname, 'test/vitest.setup.ts');
const coreTests = ['src/**/*.{test,spec}.{ts,tsx}'];
const integrationTests = [
  'src/**/*{integration,e2e,live}*.test.{ts,tsx}',
  'src/channels/attachments/__tests__/voice-stt-webchat.test.ts',
  'src/discussions/__tests__/service.test.ts',
  'src/voice/audio/__tests__/normalize.test.ts',
];
const componentTests = [
  'src/activity/**/*.{test,spec}.{ts,tsx}',
  'src/agent-catalog/**/*.{test,spec}.{ts,tsx}',
  'src/automations/**/*.{test,spec}.{ts,tsx}',
  'src/capabilities/**/*.{test,spec}.{ts,tsx}',
  'src/chat-previews/**/*.{test,spec}.{ts,tsx}',
  'src/connectors/**/*.{test,spec}.{ts,tsx}',
  'src/discussions/**/*.{test,spec}.{ts,tsx}',
  'src/execution-environments/**/*.{test,spec}.{ts,tsx}',
  'src/gateway/**/*.{test,spec}.{ts,tsx}',
  'src/history/**/*.{test,spec}.{ts,tsx}',
  'src/knowledge/**/*.{test,spec}.{ts,tsx}',
  'src/knowledge-memory/**/*.{test,spec}.{ts,tsx}',
  'src/local-apps/**/*.{test,spec}.{ts,tsx}',
  'src/notifications/**/*.{test,spec}.{ts,tsx}',
  'src/projects/**/*.{test,spec}.{ts,tsx}',
  'src/scenes/**/*.{test,spec}.{ts,tsx}',
  'src/session/**/*.{test,spec}.{ts,tsx}',
  'src/storage/**/*.{test,spec}.{ts,tsx}',
  'src/tasks/**/*.{test,spec}.{ts,tsx}',
  'src/work-discovery/**/*.{test,spec}.{ts,tsx}',
];

export default defineConfig({
  resolve: {
    alias: {
      '@xopcai/xopc': path.resolve(__dirname, 'src'),
      '@': path.resolve(__dirname, 'web/src'),
    },
  },
  test: {
    // Let jsdom supply browser storage instead of Node's file-backed globals.
    execArgv: ['--no-experimental-webstorage'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'apps/mobile-harmony/**/build/**',
    ],
    projects: [
      {
        extends: true,
        test: {
          name: 'computer-desktop',
          include: [
            'electron/computer/**/*.{test,spec}.{ts,tsx}',
            'electron/browser/**/*.{test,spec}.{ts,tsx}',
            'electron/__tests__/gateway-process*.test.ts',
            'electron/__tests__/trusted-renderer.test.ts',
            'electron/__tests__/electron-user-paths.test.ts',
            'electron/__tests__/windows-signature.test.ts',
            'electron/__tests__/windows-signature-process.test.ts',
            'electron/__tests__/system-settings-behavior.test.ts',
            'electron/__tests__/temporary-preview-file.test.ts',
            'electron/__tests__/file-resource-path.test.ts',
            'electron/__tests__/uninstall-paths.test.ts',
          ],
          setupFiles: [setupFile],
          maxWorkers: 2,
          sequence: { groupOrder: 4 },
        },
      },
      {
        extends: true,
        test: {
          name: 'unit',
          include: [...coreTests, 'electron/__tests__/auto-updater.test.ts', 'electron/__tests__/startup-failure.test.ts', 'electron/__tests__/loading-page.test.ts'],
          exclude: [...componentTests, ...integrationTests],
          setupFiles: [setupFile],
          maxWorkers: '40%',
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          include: componentTests,
          exclude: integrationTests,
          setupFiles: [setupFile],
          maxWorkers: '30%',
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: integrationTests,
          setupFiles: [setupFile],
          maxWorkers: 2,
          sequence: { groupOrder: 2 },
        },
      },
      {
        extends: true,
        test: {
          name: 'extensions',
          include: ['extensions/{telegram,feishu,weixin}/src/**/*.{test,spec}.{ts,tsx}'],
          setupFiles: [setupFile],
          maxWorkers: '30%',
          sequence: { groupOrder: 3 },
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          include: ['web/src/**/*.{test,spec}.{ts,tsx}'],
          setupFiles: [setupFile],
          maxWorkers: '30%',
          sequence: { groupOrder: 3 },
        },
      },
      {
        extends: true,
        test: {
          name: 'packages',
          include: ['packages/**/*.{test,spec}.{ts,tsx}'],
          setupFiles: [setupFile],
          maxWorkers: '30%',
          sequence: { groupOrder: 3 },
        },
      },
      {
        extends: true,
        test: {
          name: 'scripts',
          include: ['scripts/**/*.{test,spec}.{ts,tsx}'],
          setupFiles: [setupFile],
          maxWorkers: '30%',
          sequence: { groupOrder: 3 },
        },
      },
    ],
  },
});
