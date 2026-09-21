import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_DEV_API_TARGET || 'http://127.0.0.1:30002'
  const proxy = {
    target: apiTarget,
    changeOrigin: true,
    secure: false,
    configure(proxyServer) {
      proxyServer.on('proxyReq', (proxyReq) => {
        proxyReq.removeHeader('origin')
        proxyReq.removeHeader('referer')
      })
      proxyServer.on('proxyRes', (proxyRes) => {
        const cookies = proxyRes.headers['set-cookie']
        if (!cookies) return
        proxyRes.headers['set-cookie'] = cookies.map((cookie) =>
          cookie.replace(/;\s*Secure/gi, ''))
      })
    },
  }

  return {
    root: resolve(__dirname, 'c-end'),
    server: {
      port: 5175,
      host: '0.0.0.0',
      strictPort: true,
      proxy: { '/api': proxy, '/oauth/': proxy },
    },
  }
})
