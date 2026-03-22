/** @type {import('tailwindcss').Config} */
const colors = require('tailwindcss/colors');

module.exports = {
  // 必须开启 class 模式，以便通过切换 <html> 或 <body> 的 dark class 精确控制深色映射
  darkMode: 'class', 
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // 1. 颜色体系 (Color Palette)
      // 保留默认 utilities 的同时，抽离出语义化的 brand 和 surface 变量
      colors: {
        brand: {
          50: colors.blue[50],    // 浅色柔和态背景
          400: colors.blue[400],  // 暗色模式主色/文字
          500: colors.blue[500],  // 暗色悬浮态
          600: colors.blue[600],  // 浅色模式主色 (Primary Base)
          700: colors.blue[700],  // 浅色悬浮态
          900: colors.blue[900],  // 暗色柔和态背景
        },
        surface: {
          50: colors.slate[50],   // 浅色全局基底 (App Background)
          100: colors.slate[100], // 浅色悬浮/激活背景
          800: colors.slate[800], // 暗色悬浮/激活背景
          900: colors.slate[900], // 暗色卡片/容器背景 (发光描边底色)
          950: colors.slate[950], // 暗色全局基底 (深邃无穷远)
        }
      },

      // 2. 排版系统 (Typography)
      fontFamily: {
        sans: [
          'Inter',                  // 现代感无衬线
          '"San Francisco"',        // 苹果系统原生
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          '"ui-monospace"',
          '"SFMono-Regular"',       // 等宽数字/代码最优解
          'Menlo',
          'Monaco',
          'monospace',
        ],
      },

      // 3. 苹果风圆角语义化 (Border Radius)
      // Tailwind 默认 xl=12px, 2xl=16px, 3xl=24px 已贴合规范，这里提供语义别名
      borderRadius: {
        'button': '0.75rem', // 12px (同 rounded-xl)
        'card': '1rem',      // 16px (同 rounded-2xl)
        'modal': '1.5rem',   // 24px (同 rounded-3xl)
      },

      // 4. 高级弥散阴影 (Shadows)
      // 覆盖生硬的黑阴影，改为带特定色相和透明度的弥散投影
      boxShadow: {
        'popover': '0 20px 25px -5px rgb(226 232 240 / 0.5), 0 8px 10px -6px rgb(226 232 240 / 0.5)', // 亮色柔和浮层
        'modal': '0 25px 50px -12px rgb(15 23 42 / 0.1)', // 亮色模态框焦点投影
      },

      // 5. 动效曲线 (Motion)
      transitionTimingFunction: {
        'apple-ease': 'cubic-bezier(0.2, 0.8, 0.2, 1)', // 模拟苹果物理的弹性平滑缓出
      }
    },
  },
  plugins: [
    // 6. 核心交互状态提取 (Design System Helpers)
    // 将极长的 Tailwind class 组合提取为基础 Utility，保持组件代码干净
    function ({ addUtilities }) {
      addUtilities({
        // 优雅无障碍焦点 (A11y Focus) —— 自动适配 Light/Dark 模式
        '.focus-ring': {
          '@apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-brand-400 dark:focus-visible:ring-offset-surface-950': {},
        },
        // 亲切感点击微缩放 (Active Scale)
        '.active-scale': {
          '@apply active:scale-95 transition-all duration-200 ease-apple-ease': {},
        },
        // 悬浮微上浮 (Hover Float)
        '.hover-float': {
          '@apply hover:-translate-y-0.5 transition-all duration-200 ease-apple-ease': {},
        }
      });
    },
  ],
};