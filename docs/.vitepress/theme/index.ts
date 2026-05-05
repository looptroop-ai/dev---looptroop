import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Layout from './Layout.vue'
import MermaidBlock from './MermaidBlock.vue'
import { useStableHashScroll } from './hashScroll'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout,
  setup() {
    useStableHashScroll()
  },
  enhanceApp({ app }) {
    app.component('MermaidBlock', MermaidBlock)
  },
} satisfies Theme
