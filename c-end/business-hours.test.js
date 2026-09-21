import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, test, vi } from 'vitest'

/**
 * 营业时间（KTV 预约准入）契约守卫：
 *
 * 服务端只读接口 GET /api/v1/business/reservations/business-hours 给出门店营业时段，
 * 客户端这一层只负责「别让客人选到必然被拒的时段」——真正的准入仍是服务端 422
 * RESERVATION_OUT_OF_BUSINESS_HOURS。因此：
 *  1) 时段判定只有一份实现（c-end/business-hours.js），页面 / saas.js 都不得内联重写；
 *  2) 左闭右开：18:00–05:00 含 18:00 与 04:59，不含 05:00；
 *  3) 读路径绝不抛异常：接口抖动 / 字段缺失一律回退默认 18:00–次日 05:00。
 */

/** 独立加载纯函数模块（与 datetime.test.js 同一方式）。 */
async function loadBusinessHours() {
  const source = await readFile(new URL('./business-hours.js', import.meta.url), 'utf8')
  const window = {}
  vm.runInNewContext(source, { window })
  return window.A380BusinessHours
}

/** 营业时段字面量（不依赖模块自身，避免循环自证）。 */
const sameDay = { openTime: '09:00', closeTime: '22:00', crossesMidnight: false, allDay: false }
const crossMidnight = { openTime: '18:00', closeTime: '05:00', crossesMidnight: true, allDay: false }
const allDay = { openTime: '00:00', closeTime: '00:00', crossesMidnight: false, allDay: true }

/**
 * 在 live 模式加载 money.js + business-hours.js + saas.js（index.html 同一顺序），fetch 可控。
 * saas.js 的营业时间兜底读的是 window.A380BusinessHours，所以模块必须真的先加载。
 */
async function loadSaas(fetch) {
  const moneySource = await readFile(new URL('./money.js', import.meta.url), 'utf8')
  const hoursSource = await readFile(new URL('./business-hours.js', import.meta.url), 'utf8')
  const source = await readFile(new URL('./saas.js', import.meta.url), 'utf8')
  const window = {
    location: { origin: 'https://admin.dev.example.com', hostname: 'admin.dev.example.com' },
    A380OAuth: { refreshContext: vi.fn() },
  }
  const context = { window, fetch, console, crypto: { randomUUID: () => 'request-id' } }
  vm.runInNewContext(moneySource, context)
  vm.runInNewContext(hoursSource, context)
  vm.runInNewContext(source, context)
  window.SAAS.activate()
  return window.SAAS
}

// —— 1. 同一天区间（09:00–22:00）——

test('同一天营业时段左闭右开：09:00 与 21:59 在时段内，22:00 与 08:59 不在', async () => {
  const { isWithinBusinessHours } = await loadBusinessHours()

  expect(isWithinBusinessHours('09:00', sameDay)).toBe(true)
  expect(isWithinBusinessHours('21:59', sameDay)).toBe(true)
  expect(isWithinBusinessHours('22:00', sameDay)).toBe(false)
  expect(isWithinBusinessHours('08:59', sameDay)).toBe(false)
  // 'HH:mm:ss' 与 'HH:mm' 同一口径
  expect(isWithinBusinessHours('09:00:00', sameDay)).toBe(true)
  expect(isWithinBusinessHours('21:59:59', sameDay)).toBe(true)
  expect(isWithinBusinessHours('22:00:00', sameDay)).toBe(false)
})

// —— 2. 跨自然日（18:00–05:00，默认营业时间）——

test('跨自然日营业时段：18:00 到次日 04:59 在时段内，05:00 与 17:59 不在', async () => {
  const { isWithinBusinessHours, DEFAULT_BUSINESS_HOURS } = await loadBusinessHours()

  expect(DEFAULT_BUSINESS_HOURS).toEqual({
    openTime: '18:00',
    closeTime: '05:00',
    crossesMidnight: true,
    allDay: false,
    displayText: '18:00 – 次日 05:00',
    source: 'DEFAULT',
  })

  expect(isWithinBusinessHours('18:00', DEFAULT_BUSINESS_HOURS)).toBe(true)
  expect(isWithinBusinessHours('23:59', DEFAULT_BUSINESS_HOURS)).toBe(true)
  expect(isWithinBusinessHours('00:00', DEFAULT_BUSINESS_HOURS)).toBe(true)
  expect(isWithinBusinessHours('04:59', DEFAULT_BUSINESS_HOURS)).toBe(true)
  // 左闭右开：打烊时刻（05:00）与开门前的 17:59 都不在时段内
  expect(isWithinBusinessHours('05:00', DEFAULT_BUSINESS_HOURS)).toBe(false)
  expect(isWithinBusinessHours('17:59', DEFAULT_BUSINESS_HOURS)).toBe(false)
  // 第二个参数也接受接口原始形状
  expect(isWithinBusinessHours('18:00', { openTime: '18:00', closeTime: '05:00' })).toBe(true)
  expect(isWithinBusinessHours('12:00', { openTime: '18:00', closeTime: '05:00' })).toBe(false)
})

// —— 3. 全天营业（open == close）——

test('全天营业（open == close）恒为 true，且展示为「全天营业」', async () => {
  const { isWithinBusinessHours, businessHoursText, parseBusinessHours } = await loadBusinessHours()

  for (const time of ['00:00', '03:30', '12:00', '18:00', '23:59']) {
    expect(isWithinBusinessHours(time, allDay)).toBe(true)
  }
  // 接口显式声明 allDay 时同样恒 true（即使给了区间）
  expect(isWithinBusinessHours('12:00', { openTime: '18:00', closeTime: '05:00', allDay: true })).toBe(true)
  expect(businessHoursText(parseBusinessHours({ openTime: '09:00', closeTime: '09:00', allDay: true }))).toBe('全天营业')
  expect(businessHoursText({ openTime: '00:00', closeTime: '00:00' })).toBe('全天营业')
})

// —— 4. 读路径绝不抛异常 ——

test('parseBusinessHours 对空值/非法格式回退默认营业时间，不抛异常', async () => {
  const { parseBusinessHours, DEFAULT_BUSINESS_HOURS, isWithinBusinessHours } = await loadBusinessHours()

  const inputs = [
    undefined, null, '', 0, 42, [], {}, 'not-json',
    { openTime: '', closeTime: '' },                            // 字段缺失
    { openTime: '25:00', closeTime: '05:00' },                   // 小时越界
    { openTime: '18:60', closeTime: '05:00' },                   // 分钟越界
    { openTime: '9:00', closeTime: '22:00' },                    // 未补零
    { openTime: '晚上六点', closeTime: '05:00' },                 // 非时间串
    { openTime: '18:00:00:00', closeTime: '05:00' },             // 多段
    { openTime: 1800, closeTime: '05:00' },                      // 非字符串
    { openTime: '18:00' },                                       // closeTime 缺失
  ]
  for (const input of inputs) {
    expect(() => parseBusinessHours(input), String(input)).not.toThrow()
    expect(parseBusinessHours(input), String(input)).toEqual({
      openTime: DEFAULT_BUSINESS_HOURS.openTime,
      closeTime: DEFAULT_BUSINESS_HOURS.closeTime,
      crossesMidnight: DEFAULT_BUSINESS_HOURS.crossesMidnight,
      allDay: DEFAULT_BUSINESS_HOURS.allDay,
      displayText: DEFAULT_BUSINESS_HOURS.displayText,
      source: DEFAULT_BUSINESS_HOURS.source,
    })
  }

  // 非法到店时刻不猜「在时段内」：宁可提交前拦下，也不放行必然被服务端 422 的请求
  for (const time of ['', null, undefined, '25:00', 'abc', '18:60']) {
    expect(isWithinBusinessHours(time, DEFAULT_BUSINESS_HOURS), String(time)).toBe(false)
  }

  // 合法响应按原样归一（结构化字段为准，displayText 现算）
  expect(parseBusinessHours({
    storeId: 100, openTime: '18:00', closeTime: '05:00', source: 'STORE',
    crossesMidnight: true, allDay: false, displayText: '服务端文案',
  })).toEqual({
    openTime: '18:00',
    closeTime: '05:00',
    crossesMidnight: true,
    allDay: false,
    displayText: '18:00 – 次日 05:00',
    source: 'STORE',
  })
  // 返回的是新对象：调用方改写不污染常量
  const first = parseBusinessHours({ openTime: '09:00', closeTime: '22:00' })
  first.openTime = '00:00'
  expect(parseBusinessHours({ openTime: '09:00', closeTime: '22:00' }).openTime).toBe('09:00')
  expect(DEFAULT_BUSINESS_HOURS.openTime).toBe('18:00')
})

test('businessHoursText：跨自然日带「次日」，同一天不带', async () => {
  const { businessHoursText, parseBusinessHours } = await loadBusinessHours()

  expect(businessHoursText(parseBusinessHours({
    storeId: 100, openTime: '18:00', closeTime: '05:00', source: 'DEFAULT',
    crossesMidnight: true, allDay: false, displayText: '18:00 – 次日 05:00',
  }))).toBe('18:00 – 次日 05:00')
  expect(businessHoursText({ openTime: '09:00', closeTime: '22:00' })).toBe('09:00 – 22:00')
  // 非法输入也回退默认文案而不是抛异常
  expect(businessHoursText(null)).toBe('18:00 – 次日 05:00')
})

// —— 5. 接口层：请求失败回退默认营业时间 ——

test('saas.getBusinessHours 走只读接口，失败时回退默认营业时间而不是抛错', async () => {
  const payload = {
    storeId: 100, openTime: '18:00', closeTime: '05:00', source: 'DEFAULT',
    crossesMidnight: true, allDay: false, displayText: '18:00 – 次日 05:00',
  }

  const okFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload })
  const live = await loadSaas(okFetch)
  expect(await live.getBusinessHours()).toEqual(payload)
  expect(okFetch.mock.calls[0][0]).toBe('https://admin.dev.example.com/api/v1/business/reservations/business-hours')
  // storeId 可选：传了才带上查询串，让门店级配置覆盖默认
  await live.getBusinessHours(100)
  expect(okFetch.mock.calls[1][0]).toBe('https://admin.dev.example.com/api/v1/business/reservations/business-hours?storeId=100')

  const defaultHours = {
    openTime: '18:00',
    closeTime: '05:00',
    crossesMidnight: true,
    allDay: false,
    displayText: '18:00 – 次日 05:00',
    source: 'DEFAULT',
  }
  // 后端 500：返回默认营业时间（不抛错），预约页仍可填单、最终准入由服务端 422 把关
  const failingFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '{"code":"INTERNAL_ERROR"}' })
  const failing = await loadSaas(failingFetch)
  await expect(failing.getBusinessHours()).resolves.toEqual(defaultHours)

  // 断网 / fetch 直接 reject 同样回退默认
  const offlineFetch = vi.fn().mockRejectedValue(new Error('offline'))
  const offline = await loadSaas(offlineFetch)
  await expect(offline.getBusinessHours()).resolves.toEqual(defaultHours)
})

test('demo（preview=1）降级同样返回默认营业时间，且不发请求', async () => {
  const moneySource = await readFile(new URL('./money.js', import.meta.url), 'utf8')
  const hoursSource = await readFile(new URL('./business-hours.js', import.meta.url), 'utf8')
  const source = await readFile(new URL('./saas.js', import.meta.url), 'utf8')
  const window = {
    location: { origin: 'http://localhost:5175', hostname: 'localhost', port: '5175', search: '?preview=1' },
    A380OAuth: { refreshContext: vi.fn() },
    SAAS_DEMO_MODE: true,
  }
  const fetch = vi.fn().mockRejectedValue(new Error('demo 模式不应发请求'))
  const context = { window, fetch, console, URLSearchParams, crypto: { randomUUID: () => 'request-id' } }
  vm.runInNewContext(moneySource, context)
  vm.runInNewContext(hoursSource, context)
  vm.runInNewContext(source, context)

  await expect(window.SAAS.getBusinessHours()).resolves.toEqual(expect.objectContaining({
    openTime: '18:00', closeTime: '05:00', crossesMidnight: true, allDay: false,
  }))
  expect(fetch).not.toHaveBeenCalled()
})

// —— 6. 源码守卫：判定只有一份实现，页面只调用不重写 ——

test('源码守卫：app.js 走 isWithinBusinessHours，index.html 在 app 之前加载 business-hours', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  // 注释里允许解释「跨自然日 / 次日」，所以先剥注释再守卫，避免把说明文字当实现
  const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // 提交前的准入校验必须走纯函数模块
  expect(code).toContain('isWithinBusinessHours(')
  // 页面不内联重写跨天 / 左闭右开判断，也不自行拼「次日」文案
  expect(code).not.toContain('crossesMidnight')
  expect(code).not.toMatch(/\|\|\s*\w+\s*<\s*close/)
  expect(code).not.toContain('次日 ')
  // 同一个 IIFE 模块也只暴露这几个入口（判定实现只有一份）
  expect(code).toContain('A380BusinessHours.isWithinBusinessHours(')
  expect(code).toContain('A380BusinessHours.parseBusinessHours(')

  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  const order = [...html.matchAll(/src="\.\/([\w.-]+)\.js(?:\?[^"]*)?"/g)].map((match) => match[1])
  expect(order).toContain('business-hours')
  expect(order.indexOf('business-hours')).toBeLessThan(order.indexOf('app'))
  expect(order.indexOf('datetime')).toBeLessThan(order.indexOf('business-hours'))
  expect(order.indexOf('business-hours')).toBeLessThan(order.indexOf('saas'))
})
