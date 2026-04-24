import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import MermaidBlock from './MermaidBlock.vue'
import { useStableHashScroll } from './hashScroll'
import './custom.css'

export default {
  extends: DefaultTheme,
  setup() {
    useStableHashScroll()
  },
  enhanceApp({ app }) {
    app.component('MermaidBlock', MermaidBlock)
  },
} satisfies Theme
