import { expect, test } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * 公共图片地址契约守卫（2026-09 规范方案，无过渡兼容）。
 *
 * 统一前缀：/api/v1/media-public/{bucket}/{key}
 *  - 走网关 /api 命名空间：dev 走 vite proxy `/api`，容器走 nginx `location /api/`，
 *    任何环境同一份路由，入口不再单独反代 MinIO；
 *  - 后端返回同源相对路径，C 端 / B 端原样透传，绝不拼域名（CSP img-src 'self' data: 依然满足）。
 *
 * 一旦有人重新写死旧前缀 /media-public/、或给入口加回 media 专用反代，这里就红。
 */

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

const NEW_PREFIX = '/api/v1/media-public/'

/** 注释里允许说明「历史上是 /media-public/，现已改为网关前缀」，因此先剥注释再断言。 */
function stripComments(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 去掉合法新前缀后仍出现 /media-public/，即视为回退到旧前缀。 */
function hasLegacyPrefix(source) {
  return stripComments(source).split(NEW_PREFIX).join('').includes('/media-public/')
}

async function collectFiles(dir, extensions) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(full, extensions))
    else if (extensions.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith('.test.js')) files.push(full)
  }
  return files
}

/** 源码扫描范围：C 端静态站点、B 端 Vue 工程、共享层、入口与本地代理配置。 */
const SCAN_DIRS = ['c-end', 'src']
const SCAN_ROOT_FILES = ['nginx.conf', 'vite.config.c.js', 'vite.config.b.js', 'index.b.html']

// 全仓文件扫描守卫：并行跑 17 个测试文件时 Windows 文件系统偶发超过默认 5s（与断言无关），显式放宽超时。
test('c-end / src 里只允许出现 /api/v1/media-public/，不再有旧的 /media-public/ 生成或拼接点', async () => {
  const offenders = []
  for (const dir of SCAN_DIRS) {
    for (const file of await collectFiles(path.join(repoRoot, dir), ['.js', '.vue', '.html'])) {
      const relative = path.relative(repoRoot, file).split(path.sep).join('/')
      if (hasLegacyPrefix(await readFile(file, 'utf8'))) offenders.push(relative)
    }
  }
  for (const name of SCAN_ROOT_FILES) {
    if (hasLegacyPrefix(await readFile(path.join(repoRoot, name), 'utf8'))) offenders.push(name)
  }
  expect(offenders).toEqual([])
}, 30000)

test('图片地址原样透传后端返回值（取 mainImageUrl / imageUrls 后 trim），不拼域名', async () => {
  const app = stripComments(await readFile(path.join(repoRoot, 'c-end/app.js'), 'utf8'))
  // C 端：主图优先、缺失退回第一张，返回值只做 trim
  expect(app).toContain('item.mainImageUrl || (Array.isArray(item.imageUrls) && item.imageUrls.length ? item.imageUrls[0] : \'\')')
  expect(app).toContain('room.mainImageUrl || (Array.isArray(room.imageUrls) && room.imageUrls.length ? room.imageUrls[0] : \'\')')
  expect(app).not.toMatch(/main[^;]*location\.origin/)

  const orders = stripComments(await readFile(path.join(repoRoot, 'src/b-end/views/Orders.vue'), 'utf8'))
  expect(orders).toContain('item.mainImageUrl || (Array.isArray(item.imageUrls) && item.imageUrls.length ? item.imageUrls[0] : \'\')')
  expect(orders).not.toMatch(/main[^;]*location\.origin/)
})

test('入口 nginx 用 /api 承接图片路由，没有 media 专用反代', async () => {
  const nginx = await readFile(path.join(repoRoot, 'nginx.conf'), 'utf8')
  expect(nginx).not.toMatch(/location\s+\/media-public\//)
  expect(nginx).not.toContain('minio')
  // ^~ 不可或缺：正则 location（\.png|jpg|...）优先于前缀 location，而公共图片路径正好以图片后缀结尾；
  // 不加 ^~ 会被静态资源 location 抢走并按本地文件 404。
  expect(nginx).toMatch(/location \^~ \/api\/ \{[\s\S]*?proxy_pass http:\/\/gateway:3002;/)
  // CSP 不因新前缀放宽
  for (const line of nginx.split('\n').filter((line) => line.includes('Content-Security-Policy'))) {
    expect(line).toContain("img-src 'self' data:")
    expect(line).not.toMatch(/img-src[^;]*\*/)
    expect(line).not.toMatch(/img-src[^;]*blob:/)
  }
})

test('本地 dev proxy 只用 /api（含 /api/v1/media-public/**），不做路径 rewrite', async () => {
  for (const name of ['vite.config.c.js', 'vite.config.b.js']) {
    const config = await readFile(path.join(repoRoot, name), 'utf8')
    expect(config).toContain("proxy: { '/api': proxy, '/oauth/': proxy }")
    // 没有为旧前缀单独开代理
    expect(config).not.toContain('media-public')
    // 没有 rewrite：/api/v1/media-public/** 原样转发给网关
    expect(config).not.toMatch(/rewrite\s*:/)
  }
})
