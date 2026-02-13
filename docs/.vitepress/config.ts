import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'xopcbot',
  description: 'Ultra-Lightweight Personal AI Assistant',
  base: '/xopcbot/',
  cleanUrls: true,
  ignoreDeadLinks: true,
  head: [
    ['link', { rel: 'icon', href: '/xopcbot/favicon.ico' }]
  ],
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        siteTitle: 'xopcbot',
        logo: '/xopcbot/logo.svg',
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
              { text: 'CLI', link: '/cli' },
              { text: 'Tools', link: '/tools' },
              { text: 'Plugins', link: '/plugins' },
              { text: 'Models', link: '/models' }
            ]
          },
          {
            text: 'Features',
            items: [
              { text: 'Channels', link: '/channels' },
              { text: 'Gateway', link: '/gateway' },
              { text: 'Session', link: '/session' },
              { text: 'Skills', link: '/skills' },
              { text: 'Cron', link: '/cron' },
              { text: 'Heartbeat', link: '/heartbeat' }
            ]
          },
          {
            text: 'Reference',
            items: [
              { text: 'Templates', link: '/reference/templates' }
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
        logo: '/xopcbot/logo.svg',
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
              { text: 'CLI 命令', link: '/zh/cli' },
              { text: '内置工具', link: '/zh/tools' },
              { text: '插件系统', link: '/zh/plugins' },
              { text: '模型支持', link: '/zh/models' }
            ]
          },
          {
            text: '功能特性',
            items: [
              { text: '消息通道', link: '/zh/channels' },
              { text: '网关服务', link: '/zh/gateway' },
              { text: '会话管理', link: '/zh/session' },
              { text: '技能系统', link: '/zh/skills' },
              { text: '定时任务', link: '/zh/cron' },
              { text: '心跳监控', link: '/zh/heartbeat' }
            ]
          },
          {
            text: '参考',
            items: [
              { text: '模板文件', link: '/zh/reference/templates' }
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
