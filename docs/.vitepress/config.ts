import { defineConfig } from 'vitepress'

/** GitHub Pages project site: static assets must include this prefix in raw `head` tags. */
const base = '/xopc/'

export default defineConfig({
  title: 'xopc',
  description: 'xopc is a local-first personal AI assistant that gets to know you over time and helps move what truly matters forward.',
  base,
  // Product documentation is published here. Engineering plans and ADRs stay
  // in the repository, but are deliberately excluded from the user site.
  srcExclude: ['design/**', 'adr/**'],
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
  ignoreDeadLinks: false,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['link', { rel: 'apple-touch-icon', sizes: '180x180', href: `${base}apple-touch-icon.png` }],
    ['meta', { property: 'og:title', content: 'xopc - A personal AI that gets to know you' }],
    ['meta', { property: 'og:description', content: 'It lives on your computer, forms a reviewable understanding, and helps you move what truly matters forward.' }],
    ['meta', { property: 'og:image', content: `https://xopcai.github.io${base}social-preview.svg` }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'xopc - A personal AI that gets to know you' }],
    ['meta', { name: 'twitter:description', content: 'It lives on your computer, forms a reviewable understanding, and helps you move what truly matters forward.' }],
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
          { text: 'Get started', link: '/getting-started' },
          { text: 'Product', link: '/product' },
          { text: 'Guides', link: '/session' },
          { text: 'Configuration', link: '/configuration' }
        ],
        sidebar: [
          {
            text: 'Start',
            items: [
              { text: 'Overview', link: '/getting-started' },
              { text: 'Product philosophy', link: '/product' },
              { text: 'Where xopc fits', link: '/comparison' },
              { text: 'Desktop app', link: '/desktop-app' },
              { text: 'Terminal quick start', link: '/first-5-minutes' },
              { text: 'Docker', link: '/docker' },
              { text: 'Configure a model', link: '/how-to/configure-first-model' },
              { text: 'Troubleshooting', link: '/how-to/diagnose-broken-setup' }
            ]
          },
          {
            text: 'Daily use',
            items: [
              { text: 'User understanding', link: '/user-understanding' },
              { text: 'Chat and sessions', link: '/session' },
              { text: 'Agents', link: '/routing-system' },
              { text: 'Projects, Tasks & Notes', link: '/projects-tasks-notes' },
              { text: 'Workflows', link: '/workflows' },
              { text: 'Automations', link: '/automations' },
              { text: 'Browser automations', link: '/browser-workflows' },
              { text: 'Voice (STT/TTS)', link: '/voice' },
              { text: 'Images and vision', link: '/image-multimodal' }
            ]
          },
          {
            text: 'Channels',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/channels' },
              { text: 'Telegram', link: '/channels/telegram' },
              { text: 'Weixin (WeChat)', link: '/channels/weixin' },
              { text: 'Feishu (Lark)', link: '/channels/feishu' },
              { text: 'Web console', link: '/channels/webui' }
            ]
          },
          {
            text: 'Configure and extend',
            items: [
              { text: 'Configuration', link: '/configuration' },
              { text: 'Models and providers', link: '/models' },
              { text: 'Tools', link: '/tools' },
              { text: 'Skills', link: '/skills' },
              { text: 'MCP', link: '/mcp' },
              { text: 'Extensions', link: '/extensions' },
              { text: 'Connectors', link: '/connectors/' }
            ]
          },
          {
            text: 'Access and maintenance',
            items: [
              { text: 'Gateway console', link: '/gateway' },
              { text: 'Terminal UI', link: '/tui' },
              { text: 'Mobile app', link: '/mobile-app' },
              { text: 'Remote access', link: '/remote-access' },
              { text: 'Heartbeat', link: '/heartbeat' },
              { text: 'Updates', link: '/update' }
            ]
          },
          {
            text: 'Reference',
            items: [
              { text: 'CLI commands', link: '/cli' },
              { text: 'Configuration reference', link: '/reference/configuration' },
              { text: 'Data and file locations', link: '/workspace' },
              { text: 'Tool runtimes', link: '/runtime-tools' },
              { text: 'Templates', link: '/reference/templates' },
              { text: 'Release channels', link: '/releases' }
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
          { text: '快速开始', link: '/zh/getting-started' },
          { text: '产品理念', link: '/zh/product' },
          { text: '使用指南', link: '/zh/session' },
          { text: '配置', link: '/zh/configuration' }
        ],
        sidebar: [
          {
            text: '快速开始',
            items: [
              { text: '产品与入口', link: '/zh/getting-started' },
              { text: '产品理念', link: '/zh/product' },
              { text: '产品边界', link: '/zh/comparison' },
              { text: '桌面应用', link: '/zh/desktop-app' },
              { text: '终端快速开始', link: '/zh/first-5-minutes' },
              { text: 'Docker', link: '/zh/docker' },
              { text: '配置模型', link: '/zh/how-to/configure-first-model' },
              { text: '故障排查', link: '/zh/how-to/diagnose-broken-setup' }
            ]
          },
          {
            text: '日常使用',
            items: [
              { text: '用户理解', link: '/zh/user-understanding' },
              { text: '聊天与会话', link: '/zh/session' },
              { text: 'Agent', link: '/zh/routing-system' },
              { text: 'Project、Task 与笔记', link: '/zh/projects-tasks-notes' },
              { text: '工作流', link: '/zh/workflows' },
              { text: '自动化', link: '/zh/automations' },
              { text: '浏览器自动化', link: '/zh/browser-workflows' },
              { text: '语音（STT/TTS）', link: '/zh/voice' },
              { text: '图像与视觉', link: '/zh/image-multimodal' }
            ]
          },
          {
            text: '消息通道',
            collapsed: true,
            items: [
              { text: '概览', link: '/zh/channels' },
              { text: 'Telegram', link: '/zh/channels/telegram' },
              { text: '微信（Weixin）', link: '/zh/channels/weixin' },
              { text: '飞书（Feishu / Lark）', link: '/zh/channels/feishu' },
              { text: '网页控制台', link: '/zh/channels/webui' }
            ]
          },
          {
            text: '配置与扩展',
            items: [
              { text: '配置', link: '/zh/configuration' },
              { text: '模型与服务商', link: '/zh/models' },
              { text: '内置工具', link: '/zh/tools' },
              { text: '技能', link: '/zh/skills' },
              { text: 'MCP', link: '/zh/mcp' },
              { text: '扩展', link: '/zh/extensions' },
              { text: '连接器', link: '/zh/connectors/' }
            ]
          },
          {
            text: '访问与维护',
            items: [
              { text: '网关控制台', link: '/zh/gateway' },
              { text: '终端界面', link: '/zh/tui' },
              { text: '手机端', link: '/zh/mobile-app' },
              { text: '远程访问', link: '/zh/remote-access' },
              { text: '心跳检查', link: '/zh/heartbeat' },
              { text: '更新', link: '/zh/update' }
            ]
          },
          {
            text: '参考',
            items: [
              { text: 'CLI 命令', link: '/zh/cli' },
              { text: '配置参考', link: '/zh/reference/configuration' },
              { text: '数据与文件位置', link: '/zh/workspace' },
              { text: '工具运行环境', link: '/zh/runtime-tools' },
              { text: '模板文件', link: '/zh/reference/templates' },
              { text: '发布通道', link: '/zh/releases' }
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
