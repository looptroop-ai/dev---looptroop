<script setup lang="ts">
import mermaid from 'mermaid'
import { computed, onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'

const props = defineProps<{
  encoded: string
}>()

const { isDark } = useData()
const container = ref<HTMLElement | null>(null)
const error = ref('')
const source = computed(() => decodeURIComponent(props.encoded))

let renderCount = 0

async function renderDiagram() {
  if (!container.value) return

  try {
    error.value = ''
    container.value.innerHTML = ''

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: isDark.value ? 'dark' : 'neutral',
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    })

    const { svg, bindFunctions } = await mermaid.render(
      `looptroop-mermaid-${renderCount++}`,
      source.value,
    )

    container.value.innerHTML = svg
    bindFunctions?.(container.value)
  } catch (err) {
    container.value.innerHTML = ''
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(() => {
  void renderDiagram()
})

watch(isDark, () => {
  void renderDiagram()
})
</script>

<template>
  <figure class="mermaid-block">
    <div
      ref="container"
      class="mermaid-diagram"
      :class="{ 'is-hidden': Boolean(error) }"
    />
    <div v-if="error" class="mermaid-fallback">
      <p class="mermaid-error">Mermaid render error: {{ error }}</p>
      <pre><code>{{ source }}</code></pre>
    </div>
  </figure>
</template>
