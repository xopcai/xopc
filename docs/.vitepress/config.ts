import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'xopcbot',
  description: 'Ultra-Lightweight Personal AI Assistant',
  base: '/xopcbot/',
  cleanUrls: true,
  ignoreDeadLinks: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/logo.svg' }],
  ],
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        siteTitle: 'xopcbot',
        logo: '/logo.svg',
        nav: [
          { text: 'Home', link: '/' },
          { text: 'Guide', link: '/getting-started' },
          { text: 'Reference', link: '/reference/templates' }
        ],
        sidebar: [
          {
            text: 'Getting Started',
            items: [
              { text: 'Introduction', link: '/' },
              { text: 'Quick Start', link: '/getting-started' }
            ]
          },
          {
            text: 'Core Concepts',
            items: [
              { text: 'Architecture', link: '/architecture' },
              { text: 'Configuration', link: '/configuration' },
              { text: 'Routing System', link: '/routing-system' },
              { text: 'Agent Control Protocol (ACP)', link: '/acp' },
              { text: 'CLI', link: '/cli' },
              { text: 'Tools', link: '/tools' },
              { text: 'Extensions', link: '/extensions' },
              { text: 'Models', link: '/models' }
            ]
          },
          {
            text: 'Features',
            items: [
              { text: 'Channels', link: '/channels' },
              { text: 'Voice (STT/TTS)', link: '/voice' },
              { text: 'Progress Feedback', link: '/progress' },
              { text: 'Gateway', link: '/gateway' },
              { text: 'Session', link: '/session' },
              { text: 'Skills', link: '/skills' },
              { text: 'Skills Testing', link: '/skills-testing' },
              { text: 'Cron', link: '/cron' },
              { text: 'Heartbeat', link: '/heartbeat' }
            ]
          },
          {
            text: 'Reference',
            items: [
              { text: 'Templates', link: '/reference/templates' },
              { text: 'UI Design System', link: '/design/ui-design-system' },
              { text: 'Web Console Notes', link: '/web-migration-plan' }
            ]
          }
        ],
        footer: {
          message: 'Released under the MIT License.',
          copyright: 'Copyright © 2026-present xopcbot'
        }
      }
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh/',
      themeConfig: {
        siteTitle: 'xopcbot',
        logo: '/logo.svg',
        nav: [
          { text: '首页', link: '/zh/' },
          { text: '指南', link: '/zh/getting-started' },
          { text: '参考', link: '/zh/reference/templates' }
        ],
        sidebar: [
          {
            text: '快速开始',
            items: [
              { text: '简介', link: '/zh/' },
              { text: '快速上手', link: '/zh/getting-started' }
            ]
          },
          {
            text: '核心概念',
            items: [
              { text: '架构设计', link: '/zh/architecture' },
              { text: '配置参考', link: '/zh/configuration' },
              { text: 'Session 路由', link: '/zh/routing-system' },
              { text: 'ACP 协议', link: '/zh/acp' },
              { text: 'CLI 命令', link: '/zh/cli' },
              { text: '内置工具', link: '/zh/tools' },
              { text: '扩展系统', link: '/zh/extensions' },
              { text: '模型支持', link: '/zh/models' }
            ]
          },
          {
            text: '功能特性',
            items: [
              { text: '消息通道', link: '/zh/channels' },
              { text: '语音（STT/TTS）', link: '/zh/voice' },
              { text: '进度反馈', link: '/zh/progress' },
              { text: '网关服务', link: '/zh/gateway' },
              { text: '会话管理', link: '/zh/session' },
              { text: '技能系统', link: '/zh/skills' },
              { text: '技能测试', link: '/zh/skills-testing' },
              { text: '定时任务', link: '/zh/cron' },
              { text: '心跳监控', link: '/zh/heartbeat' }
            ]
          },
          {
            text: '参考',
            items: [
              { text: '模板文件', link: '/zh/reference/templates' },
              { text: '控制台 UI 设计规范', link: '/design/ui-design-system' },
              { text: '网关控制台说明', link: '/web-migration-plan' }
            ]
          }
        ],
        footer: {
          message: '基于 MIT 许可证发布',
          copyright: '版权所有 © 2026-present xopcbot'
        }
      }
    }
  },
  themeConfig: {
    socialLinks: [
      { icon: 'github', link: 'https://github.com/xopcai/xopcbot' }
    ],
    search: {
      provider: 'local'
    }
  },
  markdown: {
    lineNumbers: true
  }
})
