import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { test, expect } from 'vitest'

test('describes missing consumer access without saying generic no permission', async () => {
  const source = await readFile(resolve('c-end/auth-errors.js'), 'utf8')
  const window = {}
  vm.runInNewContext(source, { window })

  const result = window.A380AuthErrors.describe({ code: 'NO_CONSUMER_ACCESS' })

  expect(result.title).toBe('服务尚未开通')
  expect(result.description).toContain('联系管理员')
  expect(result.description).not.toContain('没有权限')
})

test('describes transient authorization outage as retryable', async () => {
  const source = await readFile(resolve('c-end/auth-errors.js'), 'utf8')
  const window = {}
  vm.runInNewContext(source, { window })

  const result = window.A380AuthErrors.describe({ code: 'IAM_CONTEXT_UNAVAILABLE' })

  expect(result.retryable).toBe(true)
  expect(result.title).toBe('服务暂时不可用')
})

test('explains missing PKCE support instead of showing a blank authorization failure', async () => {
  const source = await readFile(resolve('c-end/auth-errors.js'), 'utf8')
  const window = {}
  vm.runInNewContext(source, { window })

  const result = window.A380AuthErrors.describe({ code: 'PKCE_UNAVAILABLE' })

  expect(result.title).toBe('当前环境不支持授权')
  expect(result.description).toContain('IM App')
})

test('explains an expired IM session without redirecting to an unauthenticated OAuth URL', async () => {
  const source = await readFile(resolve('c-end/auth-errors.js'), 'utf8')
  const window = {}
  vm.runInNewContext(source, { window })

  const result = window.A380AuthErrors.describe({ code: 'IM_SESSION_EXPIRED' })

  expect(result.title).toBe('IM 登录已失效')
  expect(result.description).toContain('重新登录')
})

test('C端 does not reuse a session issued for another app', async () => {
  const source = await readFile(resolve('c-end/oauth.js'), 'utf8')

  expect(source).toContain('session.appId === APP_ID')
})

test('C端 recovery actions provide a visible retry and host exit fallback', async () => {
  const source = await readFile(resolve('c-end/app.js'), 'utf8')

  expect(source).toContain("button.textContent = '检查中…'")
  expect(source).toContain('window.GV_SDK.exitApp')
  expect(source).toContain('history.length > 1')
})
