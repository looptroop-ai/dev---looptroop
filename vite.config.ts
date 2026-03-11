import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getBackendOrigin, getFrontendPort } from './shared/appConfig'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@server': resolve(__dirname, './server'),
      '@shared': resolve(__dirname, './shared'),
    },
    dedupe: [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/commands',
    ],
  },
  appType: 'spa',
  server: {
    port: getFrontendPort(),
    strictPort: true,
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': {
        target: getBackendOrigin(),
        changeOrigin: true,
      },
    },
  },
})
