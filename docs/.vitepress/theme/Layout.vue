<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import GoToTop from './GoToTop.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #layout-bottom>
      <GoToTop />
    </template>
  </Layout>
</template>
