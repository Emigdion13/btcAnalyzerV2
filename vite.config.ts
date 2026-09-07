import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { coinbasePlugin } from './server/vite-plugin'

export default defineConfig({
  plugins: [react(), coinbasePlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('lightweight-charts') || id.includes('fancy-canvas'))
            return 'chart-engine'
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor'
        },
      },
    },
  },
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost'] },
})
