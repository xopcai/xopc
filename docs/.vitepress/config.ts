import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'xopcbot',
  description: 'Ultra-Lightweight Personal AI Assistant',
  cleanUrls: true,
  ignoreDeadLinks: true,
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }]
  ],
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
    socialLinks: [
      { icon: 'github', link: 'https://github.com/xopcai/xopcbot' }
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present xopcbot'
    },
    search: {
      provider: 'local'
    }
  },
  markdown: {
    lineNumbers: true
  }
})
