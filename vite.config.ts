import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getBackendOrigin, getFrontendPort } from './shared/appConfig'

const __dirname = dirname(fileURLToPath(import.meta.url))
const backendOrigin = getBackendOrigin()

export default defineConfig({
  define: {
    __LOOPTROOP_DEV_BACKEND_ORIGIN__: JSON.stringify(backendOrigin),
  },
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
  build: {
    chunkSizeWarningLimit: 2100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom/') || id.includes('node_modules/react/')) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/@radix-ui/')) {
            return 'vendor-radix'
          }
          if (id.includes('node_modules/@codemirror/')) {
            return 'vendor-codemirror'
          }
          if (id.includes('node_modules/@tanstack/react-query')) {
            return 'vendor-query'
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons'
          }
          if (id.includes('node_modules/gpt-tokenizer')) {
            return 'vendor-tokenizer'
          }
        },
      },
    },
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
        target: backendOrigin,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if ('code' in err && err.code === 'ECONNREFUSED') {
              // Backend not ready yet — return 503 silently so the
              // client-side health poller can retry without noisy logs.
              if (res && 'writeHead' in res) {
                (res as import('http').ServerResponse).writeHead(503, { 'Content-Type': 'application/json' })
                ;(res as import('http').ServerResponse).end(JSON.stringify({ error: 'Backend not ready' }))
              }
              return
            }
          })
        },
      },
    },
  },
})
