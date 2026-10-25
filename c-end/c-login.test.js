import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('C 端无 IM Bridge 时显示独立登录页而不是裸跳 OAuth', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  const oauth = await readFile(new URL('./oauth.js', import.meta.url), 'utf8')
  expect(app).toContain('function renderLogin()')
  expect(app).toContain('id="c-login-form"')
  expect(app).toContain("error.code === 'LOGIN_REQUIRED'")
  expect(oauth).toContain('loginWithPassword')
  expect(oauth).toContain("oauthError('LOGIN_REQUIRED'")
  expect(oauth).not.toContain('await startOAuth();\n  }')
})

test('C 端登录页使用 SaaS 会话和 CUSTOMER 上下文', async () => {
  const oauth = await readFile(new URL('./oauth.js', import.meta.url), 'utf8')
  expect(oauth).toContain("'/api/v1/identity/login'")
  expect(oauth).toContain("'/api/v1/auth/session?appId=' + APP_ID")
  expect(oauth).toContain('await selectContext()')
  expect(oauth).toContain('loginWithPassword: loginWithPassword')
})
