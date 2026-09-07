import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMarketApi } from './api.ts'

const root = fileURLToPath(new URL('../dist/', import.meta.url)),
  api = createMarketApi()
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
}
const server = createServer((req, res) => {
  if (api.handle(req, res)) return
  void (async () => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://atlas.internal').pathname)
    let file = resolve(root, `.${path}`)
    if (file !== resolve(root) && !file.startsWith(resolve(root) + sep)) {
      res.writeHead(403)
      res.end()
      return
    }
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html')
    } catch {
      if (extname(path)) {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      file = resolve(root, 'index.html')
    }
    const content = await readFile(file)
    res.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': path.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(req.method === 'HEAD' ? undefined : content)
  })().catch(() => {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('Run npm run build before starting Atlas.')
  })
})
const port = Number(process.env.PORT ?? 5173)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be a valid TCP port.')
server.listen(port, '0.0.0.0', () =>
  console.log(`Atlas + Coinbase API listening on 0.0.0.0:${port}`),
)
const shutdown = () => {
  api.close()
  server.close()
  setTimeout(() => process.exit(0), 1500).unref()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
