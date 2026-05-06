<script setup lang="ts">
import { ref, onMounted } from 'vue'

const isCollapsed = ref(false)

const toggleSidebar = () => {
  isCollapsed.value = !isCollapsed.value
  updateHtmlClass()
  localStorage.setItem('sidebar-collapsed', isCollapsed.value ? 'true' : 'false')
}

const updateHtmlClass = () => {
  if (typeof document !== 'undefined') {
    if (isCollapsed.value) {
      document.documentElement.classList.add('sidebar-collapsed')
    } else {
      document.documentElement.classList.remove('sidebar-collapsed')
    }
  }
}

onMounted(() => {
  const storedState = localStorage.getItem('sidebar-collapsed')
  if (storedState === 'true') {
    isCollapsed.value = true
    updateHtmlClass()
  }
})
</script>

<template>
  <button
    class="sidebar-toggle"
    :title="isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
    @click="toggleSidebar"
  >
    {{ isCollapsed ? '»' : '«' }}
  </button>
</template>

<style scoped>
.sidebar-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-right: 8px;
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 20px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.sidebar-toggle:hover {
  background: var(--vp-c-bg-mute);
}

@media (min-width: 960px) {
  .sidebar-toggle {
    display: flex;
  }
}
</style>
