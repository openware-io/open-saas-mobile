import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect } from 'vitest'

test('B端 OAuth callback is bound to the B端 app and revalidates contexts', async () => {
  const source = await readFile(resolve('src/b-end/oauth.js'), 'utf8')

  expect(source).toContain('app_id: APP_ID')
  // contexts/session/csrf 必须带上 appId：服务端据此只认 B 端会话，
  // 否则页面会拿同浏览器里的 C 端（消费端）会话"以为已登录"，运营动作全部 403。
  expect(source).toContain("/api/v1/auth/contexts?appId=' + APP_ID + '&refresh=' + Date.now()")
  expect(source).toContain("/api/v1/auth/session?appId=' + APP_ID")
  expect(source).toContain('session.appId !== APP_ID')
})

test('B端 multiple contexts expose choices and submit the selected context', async () => {
  const source = await readFile(resolve('src/b-end/oauth.js'), 'utf8')

  expect(source).toContain("error.contexts = operatorContexts")
  expect(source).toContain("selectedContextId = options.contextId")
  expect(source).toContain("contextId: selected.contextId")
})

test('B端 does not fall back to an unauthenticated OAuth redirect after bridge failure', async () => {
  const source = await readFile(resolve('src/b-end/oauth.js'), 'utf8')

  expect(source).toContain('if (hasNativeBridge()) throw nativeBridgeAuthorizationError(e)')
  expect(source).toContain("authError('IM_SESSION_EXPIRED'")
})
