import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import DocsHome from './DocsHome.vue'
import './home.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('DocsHome', DocsHome)
  },
} satisfies Theme
