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
  'src/workflows/**/*.{test,spec}.{ts,tsx}',
];

export default defineConfig({
  resolve: {
    alias: {
      '@xopcai/xopc': path.resolve(__dirname, 'src'),
      '@': path.resolve(__dirname, 'web/src'),
    },
  },
  test: {
    // Mobile tests use their own Expo-aware Vitest config.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'apps/mobile-expo/**',
      'apps/mobile-harmony/**/build/**',
    ],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: coreTests,
          exclude: [...componentTests, ...integrationTests],
          setupFiles: [setupFile],
          maxWorkers: 6,
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
          maxWorkers: 4,
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
          maxWorkers: 4,
          sequence: { groupOrder: 3 },
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          include: ['web/src/**/*.{test,spec}.{ts,tsx}'],
          setupFiles: [setupFile],
          maxWorkers: 4,
          sequence: { groupOrder: 3 },
        },
      },
      {
        extends: true,
        test: {
          name: 'packages',
          include: ['packages/**/*.{test,spec}.{ts,tsx}'],
          setupFiles: [setupFile],
          maxWorkers: 4,
          sequence: { groupOrder: 3 },
        },
      },
    ],
  },
});
