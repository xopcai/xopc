import { defineConfig } from 'vitepress'

/** GitHub Pages project site: static assets must include this prefix in raw `head` tags. */
const base = '/xopc/'

export default defineConfig({
  title: 'xopc',
  description: 'XOPC is a local-first AI system that remembers context, coordinates AI, and sustains long-term progress.',
  base,
  // esbuild 0.28+ errors when downleveling destructuring for Vite's legacy
  // default dev target. Apply the feature override to both Vite transforms and
  // dependency pre-bundling, because docs:dev fails during optimizeDeps.
  vite: {
    esbuild: {
      supported: {
        destructuring: true,
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        supported: {
          destructuring: true,
        },
      },
    },
  },
  cleanUrls: true,
  ignoreDeadLinks: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['link', { rel: 'apple-touch-icon', href: `${base}favicon.svg` }],
    ['meta', { property: 'og:title', content: 'xopc - Turn goals into loops' }],
    ['meta', { property: 'og:description', content: 'Keep what matters moving. A local-first AI system that remembers context, coordinates AI, and sustains long-term progress.' }],
    ['meta', { property: 'og:image', content: `https://xopcai.github.io${base}social-preview.svg` }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'xopc - Turn goals into loops' }],
    ['meta', { name: 'twitter:description', content: 'Keep what matters moving. A local-first AI system that remembers context, coordinates AI, and sustains long-term progress.' }],
    ['meta', { name: 'twitter:image', content: `https://xopcai.github.io${base}social-preview.svg` }],
  ],
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        siteTitle: 'xopc',
        logo: {
          light: '/logo.svg',
          dark: '/logo-dark.svg',
          alt: 'xopc'
        },
        nav: [
          { text: 'Home', link: '/' },
          { text: 'Guide', link: '/first-5-minutes' },
          { text: 'Reference', link: '/reference/templates' }
        ],
        sidebar: [
          {
            text: 'Getting Started',
            items: [
              { text: 'Introduction', link: '/' },
              { text: 'First 5 Minutes', link: '/first-5-minutes' },
              { text: 'Quick Start', link: '/getting-started' }
            ]
          },
          {
            text: 'Core Concepts',
            items: [
              { text: 'Architecture', link: '/architecture' },
              { text: 'On-disk layout', link: '/disk-layout' },
              { text: 'State & workspace layout', link: '/workspace' },
              { text: 'Configuration', link: '/configuration' },
              { text: 'Routing System', link: '/routing-system' },
              { text: 'CLI', link: '/cli' },
              { text: 'Updates', link: '/update' },
              { text: 'Tools', link: '/tools' },
              { text: 'Extensions', link: '/extensions' },
              { text: 'Models', link: '/models' }
            ]
          },
          {
            text: 'Features',
            items: [
              {
                text: 'Channels',
                collapsed: true,
                items: [
                  { text: 'Overview', link: '/channels' },
                  { text: 'Telegram', link: '/channels/telegram' },
                  { text: 'Weixin (WeChat)', link: '/channels/weixin' },
                  { text: 'Feishu (Lark)', link: '/channels/feishu' },
                  { text: 'Web UI', link: '/channels/webui' },
                ],
              },
              { text: 'Voice (STT/TTS)', link: '/voice' },
              { text: 'Image & vision', link: '/image-multimodal' },
              { text: 'Progress Feedback', link: '/progress' },
              { text: 'Terminal UI (tui)', link: '/tui' },
              { text: 'Gateway', link: '/gateway' },
              { text: 'Mobile app', link: '/mobile-app' },
              { text: 'Remote access', link: '/remote-access' },
              { text: 'Session', link: '/session' },
              { text: 'Skills', link: '/skills' },
              { text: 'Skills Testing', link: '/skills-testing' },
              { text: 'MCP', link: '/mcp' },
              { text: 'Cron', link: '/cron' },
              { text: 'Dynamic Workflows', link: '/workflows' },
              { text: 'Heartbeat', link: '/heartbeat' }
            ]
          },
          {
            text: 'Reference',
            items: [
              { text: 'Templates', link: '/reference/templates' },
              { text: 'UI Design System', link: '/design/ui-design-system' }
            ]
          }
        ],
        footer: {
          message: 'Released under the MIT License.',
          copyright: 'Copyright © 2026-present xopc'
        }
      }
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh/',
      themeConfig: {
        siteTitle: 'xopc',
        logo: {
          light: '/logo.svg',
          dark: '/logo-dark.svg',
          alt: 'xopc'
        },
        nav: [
          { text: '首页', link: '/zh/' },
          { text: '指南', link: '/zh/first-5-minutes' },
          { text: '参考', link: '/zh/reference/templates' }
        ],
        sidebar: [
          {
            text: '快速开始',
            items: [
              { text: '简介', link: '/zh/' },
              { text: '5分钟快速入门', link: '/zh/first-5-minutes' },
              { text: '快速上手', link: '/zh/getting-started' }
            ]
          },
          {
            text: '核心概念',
            items: [
              { text: '架构设计', link: '/zh/architecture' },
              { text: '磁盘与目录布局', link: '/zh/disk-layout' },
              { text: '状态目录与工作空间', link: '/zh/workspace' },
              { text: '配置参考', link: '/zh/configuration' },
              { text: 'Session 路由', link: '/zh/routing-system' },
              { text: 'CLI 命令', link: '/zh/cli' },
              { text: '更新', link: '/zh/update' },
              { text: '内置工具', link: '/zh/tools' },
              { text: '扩展系统', link: '/zh/extensions' },
              { text: '模型支持', link: '/zh/models' }
            ]
          },
          {
            text: '功能特性',
            items: [
              {
                text: '消息通道',
                collapsed: true,
                items: [
                  { text: '概览', link: '/zh/channels' },
                  { text: 'Telegram', link: '/zh/channels/telegram' },
                  { text: '微信（Weixin）', link: '/zh/channels/weixin' },
                  { text: '飞书（Feishu / Lark）', link: '/zh/channels/feishu' },
                  { text: '网页（Web UI）', link: '/zh/channels/webui' },
                ],
              },
              { text: '语音（STT/TTS）', link: '/zh/voice' },
              { text: '图像与视觉', link: '/zh/image-multimodal' },
              { text: '进度反馈', link: '/zh/progress' },
              { text: '终端界面 (tui)', link: '/zh/tui' },
              { text: '网关服务', link: '/zh/gateway' },
              { text: '手机端 App', link: '/zh/mobile-app' },
              { text: '远程访问', link: '/zh/remote-access' },
              { text: '会话管理', link: '/zh/session' },
              { text: '技能系统', link: '/zh/skills' },
              { text: '技能测试', link: '/zh/skills-testing' },
              { text: 'MCP', link: '/zh/mcp' },
              { text: '定时任务', link: '/zh/cron' },
              { text: '动态工作流', link: '/zh/workflows' },
              { text: '心跳监控', link: '/zh/heartbeat' }
            ]
          },
          {
            text: '参考',
            items: [
              { text: '模板文件', link: '/zh/reference/templates' },
              { text: '控制台 UI 设计规范', link: '/design/ui-design-system' }
            ]
          }
        ],
        footer: {
          message: '基于 MIT 许可证发布',
          copyright: '版权所有 © 2026-present xopc'
        }
      }
    }
  },
  themeConfig: {
    socialLinks: [
      { icon: 'github', link: 'https://github.com/xopcai/xopc' }
    ],
    search: {
      provider: 'local'
    }
  },
  markdown: {
    lineNumbers: true
  }
})
