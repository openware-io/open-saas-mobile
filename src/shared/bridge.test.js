import { beforeEach, describe, expect, it } from 'vitest'
import { clearLegacyCredentials, readConfig } from './bridge'

const values = new Map()

beforeEach(() => {
  values.clear()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
})

describe('mobile runtime bridge', () => {
  it('uses the same-origin API contract instead of URL configuration', () => {
    expect(readConfig()).toEqual({ apiBase: '/', contract: 'business-v1' })
  })

  it('removes legacy browser credential storage during upgrade', () => {
    values.set('saas_b_token', 'secret')
    values.set('saas_c_im_token', 'secret')
    values.set('unrelated', 'keep')

    clearLegacyCredentials()

    expect(values.has('saas_b_token')).toBe(false)
    expect(values.has('saas_c_im_token')).toBe(false)
    expect(values.get('unrelated')).toBe('keep')
  })
})
