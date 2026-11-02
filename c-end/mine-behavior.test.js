import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, test } from 'vitest'

/**
 * 「我的」相关行为回归（真实 c-end 脚本 + 受控 fetch + 最小 DOM 桩）：
 *   ① 我的订单：/me/orders 同时返回 KTV 与 HOTEL → 只渲染 KTV 一张卡，且不再请求酒店接口；
 *   ② 我的资产：先成功、后 503 → 保留上次成功值 + 可重试提示可见（不退回「—」）；
 *   ③ 储值明细：pages=2 → 点「加载更多」请求 page=2 且行数增加；
 *   ④ 深链 #/orders → 重定向 #/my-orders 并渲染「我的订单」（不再停在加载骨架）；
 *   ⑤ 深链规范化：#/ledger、#/order-bill/abc、#/order-items/abc、#/real-hotel/abc 先跳规范路由。
 *
 * 说明：与 refresh-policy.test.js 用同一套「最小 DOM 桩」思路；本文件只覆盖本轮修复点。
 */

const read = (name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8')

function createAppElement() {
  const history = []
  let html = ''
  let nodes = {}
  const element = {
    history,
    get innerHTML() { return html },
    set innerHTML(value) {
      html = String(value)
      history.push(html)
      nodes = {}
      const pattern = /id="([\w-]+)"/g
      let hit
      while ((hit = pattern.exec(html)) !== null) {
        nodes[hit[1]] = { id: hit[1], textContent: '', innerHTML: '', hidden: true }
      }
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    node: (id) => nodes[id] || null,
  }
  return element
}

const json = (data) => ({ ok: true, status: 200, json: async () => data })
const fail = (status, code, message) => ({
  ok: false, status, text: async () => JSON.stringify({ code, message }),
})

async function loadCend(fetchImpl) {
  const sources = {}
  for (const name of ['money.js', 'datetime.js', 'business-hours.js', 'api-errors.js', 'page-load.js',
    'reservation-room.js', 'saas.js', 'app.js']) {
    sources[name] = await read(name)
  }
  const appEl = createAppElement()
  const toastEl = { textContent: '', classList: { add() {}, remove() {} } }
  const listeners = {}
  const warnings = []
  const sandbox = {
    location: { origin: 'https://admin.dev.example.com', hostname: 'admin.dev.example.com', hash: '#/home', port: '' },
    fetch: fetchImpl,
    crypto: { randomUUID: () => 'request-id' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    history: { length: 1, back() {} },
    setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval() {},
    console: { log() {}, warn: (...args) => warnings.push(args.join(' ')), error() {} },
    scrollTo() {},
    SaasOAuth: { ready: new Promise(() => {}), refreshContext: async () => {} },
    Saas_DATA: { services: [], venues: { ktv: { address: 'SaaS KTV', tags: [] } } },
    __Saas_TEST__: {},
    document: {
      hidden: false,
      visibilityState: 'visible',
      addEventListener(type, handler) { (listeners[type] = listeners[type] || []).push(handler) },
      querySelector(selector) {
        if (selector === '#app') return appEl
        if (selector === '#toast') return toastEl
        if (typeof selector === 'string' && selector.charAt(0) === '#') return appEl.node(selector.slice(1))
        return null
      },
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {} }),
      body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => true } },
    },
    addEventListener(type, handler) { (listeners[type] = listeners[type] || []).push(handler) },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  for (const name of ['money.js', 'datetime.js', 'business-hours.js', 'api-errors.js', 'page-load.js',
    'reservation-room.js', 'saas.js']) {
    vm.runInContext(sources[name], sandbox, { filename: name })
  }
  vm.runInContext(sources['app.js'] + '\n;__Saas_TEST__.render = render;', sandbox, { filename: 'app.js' })
  sandbox.SAAS.activate()

  return {
    sandbox,
    app: appEl,
    warnings,
    api: sandbox.__Saas_TEST__,
    flush: async (ms = 20) => { await new Promise((resolve) => setTimeout(resolve, ms)) },
    dispatch: (type) => (listeners[type] || []).forEach((handler) => handler({ type })),
    click: (event) => (listeners.click || []).forEach((handler) => handler(event)),
  }
}

/** 点击桩：只命中 [data-ledger-more]，其余选择器一律不命中。 */
function ledgerMoreClick() {
  return {
    target: {
      classList: { contains: () => false },
      closest(selector) {
        if (selector === '[data-ledger-more]') return { dataset: { ledgerMore: 'coin' } }
        return null
      },
    },
  }
}

const orderRow = (over = {}) => Object.assign({
  id: 1, orderNo: 'KTV-1', businessType: 'KTV', status: 'SERVING',
  createdAt: '2026-10-30T19:30:00', totalAmount: 6150, liveTotalAmount: 6150, currencyCode: 'CNY',
}, over)

// —— ① 我的订单只渲染 KTV 卡，且不请求酒店接口 ——

test('我的订单：/me/orders 同时返回 KTV+HOTEL 时只渲染 1 张 KTV 卡，且不请求酒店接口', async () => {
  const calls = []
  const harness = await loadCend(async (url) => {
    const target = String(url)
    calls.push(target)
    if (target.includes('/api/v1/me/orders')) {
      return json([
        orderRow(),
        orderRow({ id: 2, orderNo: 'HOTEL-1', businessType: 'HOTEL', status: 'PENDING_CONFIRM' }),
      ])
    }
    if (target.includes('/business/tenant/config')) return json({})
    return json({})
  })
  harness.sandbox.location.hash = '#/my-orders'
  await harness.api.render()

  const html = harness.app.innerHTML
  expect((html.match(/<article>/g) || []).length).toBe(1)
  expect(html).toContain('KTV · 消费')
  expect(html).not.toContain('酒店 · 消费')
  expect(calls.some((url) => url.includes('/business/hotel/bookings'))).toBe(false)
})

test('我的订单：createdAt 缺失时不渲染「下单：—」', async () => {
  const harness = await loadCend(async (url) => {
    if (String(url).includes('/api/v1/me/orders')) {
      return json([orderRow({ createdAt: null })])
    }
    return json({})
  })
  harness.sandbox.location.hash = '#/my-orders'
  await harness.api.render()
  expect(harness.app.innerHTML).not.toContain('下单：')
})

// —— ② 资产先成功后失败：保留上次值 + 重试提示 ——

test('我的资产：成功后接口 503 → 保留上次成功值并显示可重试提示', async () => {
  let healthy = true
  const harness = await loadCend(async (url) => {
    const target = String(url)
    if (target.includes('/business/tenant/config')) return json({ brandName: 'SaaS 币', ratio: 100 })
    if (target.includes('/me/wallet') || target.includes('/me/points')) {
      if (!healthy) return fail(503, 'SERVICE_UNAVAILABLE', '服务暂时不可用')
      if (target.includes('/me/wallet')) return json({ tokenAmount: '1000' })
      return json({ account: { availablePoints: '320' } })
    }
    if (target.includes('/business/members/me')) return json({ memberNo: 'M20260916' })
    return json({})
  })

  harness.sandbox.location.hash = '#/my'
  harness.api.render()
  await harness.flush(40)
  expect(harness.app.node('my-wallet-coin').textContent).toBe('1,000')
  expect(harness.app.node('my-wallet-points').textContent).toBe('320')
  expect(harness.app.node('my-balance-notice').hidden).toBe(true)

  healthy = false
  harness.dispatch('visibilitychange')
  await harness.flush(40)

  // 失败不清空屏上数据（保留上次成功值），并给出可重试提示
  expect(harness.app.node('my-wallet-coin').textContent).toBe('1,000')
  expect(harness.app.node('my-wallet-points').textContent).toBe('320')
  expect(harness.app.node('my-balance-notice').hidden).toBe(false)
  expect(harness.app.node('my-balance-notice-text').textContent).toContain('资产加载失败')
})

// —— ③ 明细：pages=2 时「加载更多」请求 page=2 且行数增加 ——

test('储值明细：pages=2 → 点「加载更多」请求 page=2 且行数增加', async () => {
  const ledgerCalls = []
  const harness = await loadCend(async (url) => {
    const target = String(url)
    if (target.includes('/business/tenant/config')) return json({ brandName: 'SaaS 币', ratio: 100 })
    if (target.includes('/me/wallet/ledger')) {
      ledgerCalls.push(target)
      const page = /page=(\d+)/.exec(target) ? Number(/page=(\d+)/.exec(target)[1]) : 1
      return json({
        records: [{ entryType: 'RECHARGE', amount: page === 1 ? 200000 : 100000, tokenAmount: page === 1 ? 2000 : 1000, occurredAt: '2026-10-28T10:00:00' }],
        total: 2, size: 20, current: page, pages: 2,
      })
    }
    if (target.includes('/me/wallet')) return json({ tokenAmount: '1000' })
    return json({})
  })

  harness.sandbox.location.hash = '#/ledger/coin'
  await harness.api.render()
  const listNode = harness.app.node('ledger-list')
  expect((listNode.innerHTML.match(/<strong>/g) || []).length).toBe(1)

  harness.click(ledgerMoreClick())
  await harness.flush(40)

  expect(ledgerCalls.some((url) => url.includes('page=2'))).toBe(true)
  expect((harness.app.node('ledger-list').innerHTML.match(/<strong>/g) || []).length).toBe(2)
  expect(harness.app.node('ledger-list').innerHTML).toContain('充值')
})

// —— ④ #/orders 深链：重定向到 #/my-orders 并渲染「我的订单」 ——

test('#/orders 深链：重定向到 #/my-orders，渲染我的订单且不停在加载骨架', async () => {
  const harness = await loadCend(async (url) => {
    if (String(url).includes('/api/v1/me/orders')) return json([orderRow()])
    return json({})
  })
  harness.sandbox.location.hash = '#/orders'
  await harness.api.render()
  expect(harness.sandbox.location.hash).toBe('#/my-orders')

  // 模拟 hashchange 后再次渲染：应直接出订单列表，而不是「加载中」
  await harness.api.render()
  const html = harness.app.innerHTML
  expect(html).toContain('我的订单')
  expect(html).toContain('KTV · 消费')
  expect(html).not.toContain('加载中')
})

// —— ⑤ 深链规范化：#/ledger、#/order-bill/abc、#/order-items/abc、#/real-hotel/abc ——

test('深链规范化：缺失/非法的类型段或 id 段先跳规范路由，渲染函数不会因守卫停住', async () => {
  const harness = await loadCend(async (url) => {
    const target = String(url)
    if (target.includes('/business/tenant/config')) return json({ brandName: 'SaaS 币', ratio: 100 })
    if (target.includes('/me/wallet/ledger')) return json({ records: [], total: 0, current: 1, pages: 0 })
    if (target.includes('/me/wallet')) return json({ tokenAmount: '1000' })
    return json({})
  })

  harness.sandbox.location.hash = '#/ledger'
  await harness.api.render()
  expect(harness.sandbox.location.hash).toBe('#/ledger/coin')
  await harness.api.render()
  // 落屏更新的是 #ledger-balance / #ledger-list 两个节点（骨架 HTML 保留在 innerHTML 里是正常现象）
  expect(harness.app.innerHTML).toContain('SaaS 币明细')
  expect(harness.app.node('ledger-balance').textContent).toBe('1,000')
  expect(harness.app.node('ledger-list').innerHTML).not.toContain('明细加载中')

  harness.sandbox.location.hash = '#/order-bill/abc'
  await harness.api.render()
  expect(harness.sandbox.location.hash).toBe('#/my-orders')

  harness.sandbox.location.hash = '#/order-items/abc'
  await harness.api.render()
  expect(harness.sandbox.location.hash).toBe('#/my-orders')

  harness.sandbox.location.hash = '#/real-hotel/abc'
  await harness.api.render()
  expect(harness.sandbox.location.hash).toBe('#/service/hotel')

  // 多出段（#/ledger/points/extra、#/order-bill/5/extra、#/real-hotel/5/extra）同样先规范化
  harness.sandbox.location.hash = '#/ledger/points/extra'
  await harness.api.render()
  expect(harness.sandbox.location.hash).toBe('#/ledger/points')

  harness.sandbox.location.hash = '#/order-bill/5/extra'
  await harness.api.render()
  expect(harness.sandbox.location.hash).toBe('#/my-orders')

  harness.sandbox.location.hash = '#/real-hotel/5/extra'
  await harness.api.render()
  expect(harness.sandbox.location.hash).toBe('#/service/hotel')
})
