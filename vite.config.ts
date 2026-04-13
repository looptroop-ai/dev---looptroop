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
