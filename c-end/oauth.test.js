import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, test, vi } from 'vitest'

function sessionStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('refreshes CSRF token once when context selection rejects a stale token', async () => {
  const source = await readFile(new URL('./oauth.js', import.meta.url), 'utf8')
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true, appId: 'saas-a380-c' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ contextId: 'consumer:saas-a380-c:100:100:100' }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'stale-token' }) })
    .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ code: 'CSRF_TOKEN_INVALID', message: 'missing or invalid CSRF token' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'fresh-token' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ selected: true }) })
  const window = {
    location: { origin: 'https://miniservice.dev.example.com', pathname: '/a380/' },
    sessionStorage: sessionStorage(),
    A380Context: { chooseSingle: (items) => items[0] },
    dispatchEvent: vi.fn(),
  }
  const context = {
    window,
    fetch,
    console,
    URLSearchParams,
    Event,
    crypto: { getRandomValues: vi.fn(), subtle: { digest: vi.fn() } },
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    TextEncoder,
  }
  vm.runInNewContext(source, context)

  await expect(window.A380OAuth.ready).resolves.toBeUndefined()
  const selectCalls = fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/auth/context/select'))
  expect(selectCalls).toHaveLength(2)
  expect(selectCalls[0][1].headers['X-CSRF-Token']).toBe('stale-token')
  expect(selectCalls[1][1].headers['X-CSRF-Token']).toBe('fresh-token')
  const csrfCalls = fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/auth/csrf'))
  expect(csrfCalls).toHaveLength(2)
  // csrf/contexts/session 都必须带 appId：服务端据此只认 C 端（消费端）会话，
  // 避免同浏览器内的 B 端（运营后台）会话串号。
  expect(csrfCalls[0][0]).toMatch(/[?&]appId=/)
  expect(csrfCalls[0][0]).toMatch(/[?&]refresh=/)
  expect(csrfCalls[0][1].cache).toBe('no-store')
})

test('does not redirect to bare OAuth when an IM bridge authorization fails', async () => {
  const source = await readFile(new URL('./oauth.js', import.meta.url), 'utf8')
  const window = {
    location: { origin: 'http://192.168.31.91:30082', pathname: '/a380/' },
    sessionStorage: sessionStorage(),
    dispatchEvent: vi.fn(),
    GVBridge: { login: vi.fn().mockRejectedValue(new Error('bridge unavailable')) },
  }
  const context = {
    window,
    fetch: vi.fn().mockResolvedValue({ ok: true, json: async () => null }),
    console,
    URLSearchParams,
    Event,
    crypto: { getRandomValues: vi.fn() },
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    TextEncoder,
  }
  vm.runInNewContext(source, context)

  await expect(window.A380OAuth.ready).rejects.toMatchObject({ code: 'IM_BRIDGE_AUTH_FAILED' })
})
