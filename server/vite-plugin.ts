import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import { createMarketApi } from './api.ts'
/** The same-origin API works in development AND `vite preview`. */
export function coinbasePlugin(): Plugin {
  const install = (server: ViteDevServer | PreviewServer) => {
    const api = createMarketApi()
    server.middlewares.use((req, res, next) => {
      if (!api.handle(req, res)) next()
    })
    server.httpServer?.once('close', () => api.close())
  }
  return { name: 'atlas-coinbase-api', configureServer: install, configurePreviewServer: install }
}
