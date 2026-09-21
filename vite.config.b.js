import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

function bEndDevEntry() {
  return {
    name: 'b-end-dev-entry',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [pathname, query] = (req.url || '').split('?', 2)
        if (pathname === '/b' || pathname === '/b/' || pathname === '/b/index.html') {
          req.url = '/index.b.html' + (query ? '?' + query : '')
        }
        next()
      })
    },
  }
}

// B 端「A380 商户端」构建目标 → dist-b（部署 /b/）
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const previewAliases = mode === 'preview' ? [
    { find: '@/shared/api/saas', replacement: resolve(__dirname, 'src/b-end/preview/saas.js') },
    { find: '@/b-end/oauth', replacement: resolve(__dirname, 'src/b-end/preview/oauth.js') },
  ] : []
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
    base: './',
    plugins: [vue(), bEndDevEntry()],
    optimizeDeps: { exclude: ['vue'] },
    resolve: {
      alias: [
        ...previewAliases,
        { find: '@', replacement: resolve(__dirname, 'src') },
      ],
    },
    build: {
      outDir: 'dist-b',
      emptyOutDir: true,
      rollupOptions: { input: resolve(__dirname, 'index.b.html') },
    },
    server: {
      port: 5176,
      host: '0.0.0.0',
      strictPort: true,
      proxy: { '/api': proxy, '/oauth/': proxy },
    },
  }
})
