import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, test } from 'vitest'

/**
 * 多端数据一致性 —— C 端刷新策略的守卫。
 *
 * 背景（产品反馈）：后台「确认客户自助加项 / 结台 / 收款」之后，如果顾客的页面一直停在同一屏
 * （没切页面），屏上的消费金额与订单状态会一直是旧的。金额口径本身已经改成服务端口径
 * （orderLiveAmount ← liveTotalAmount，见 order-amount-source.test.js），缺的是「什么时候再取一次」。
 *
 * 本文件锁死刷新策略的四条约束：
 *   ① 触发点只有两个自然时机：visibilitychange → visible，以及原有的 hashchange → render 导航；
 *      另加一个 ≥30s 的前台兜底定时器，且文档隐藏时一跳都不发（绝不后台轮询）；
 *   ② 静默：屏上已有数据时不挂加载态、失败保留屏上数据（不整页替换成错误页）；
 *   ③ 幂等 + 路由守卫：同一路由在途刷新不叠加；请求回来晚（用户已换页）整批丢弃，不画到别的页面上；
 *   ④ 不引入第二条数据路径 / 不重新引入金额算术：静默刷新复用首屏同一份 load + render（orderCard → orderLiveAmount）。
 */

const repoFile = (name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8')

const json = (data) => ({ ok: true, status: 200, json: async () => data })
const fail = (status, code, message) => ({
  ok: false, status, text: async () => JSON.stringify({ code, message }),
})

const ORDERS_URL = '/api/v1/me/orders'
const billUrl = (id) => `/api/v1/business/orders/${id}/bill`

/** 订单行：金额与状态都由服务端给（客户端不得再算）。 */
const order = (over = {}) => Object.assign({
  id: 9, orderNo: 'A380-9', businessType: 'KTV', status: 'SERVING',
  createdAt: '2024-05-01T10:00:00', totalAmount: 6150, liveTotalAmount: 6150, currencyCode: 'CNY',
}, over)

/**
 * 最小 DOM 桩：app 元素按 id 记录自己渲染出的子节点（真实 DOM 的等价最小实现，
 * 账本页这类「先渲染骨架、再填节点」的页面需要 #ledger-balance / #ledger-list 能被查到）。
 */
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
      // 整块替换等于子节点全部重建：内容清空（与真实 DOM 一致）
      nodes = {}
      const pattern = /id="([\w-]+)"/g
      let hit
      while ((hit = pattern.exec(html)) !== null) {
        nodes[hit[1]] = { id: hit[1], textContent: '', innerHTML: '' }
      }
    },
    node: (id) => nodes[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  return element
}

/**
 * 用真实 c-end 脚本装配一个浏览器等价环境（window 即全局，与浏览器一致）。
 * setInterval 只记录不执行：既能把「刷新定时器」的真实注册参数拿出来断言，
 * 也避免测试进程里留下 45s 的悬挂句柄（回调可以手动调，等价于定时器到点）。
 */
async function loadCend(fetchImpl, options = {}) {
  const sources = {}
  for (const name of ['money.js', 'datetime.js', 'business-hours.js', 'api-errors.js', 'page-load.js',
    'reservation-room.js', 'saas.js', 'app.js']) {
    sources[name] = await repoFile(name)
  }

  const appEl = createAppElement()
  const toastEl = { textContent: '', classList: { add() {}, remove() {} } }
  const listeners = {}
  const intervals = []
  const errors = []
  const documentStub = {
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
    // contains('embedded-host') = true：让 syncEmbeddedHost 的轮询定时器第一跳就收尾，不留悬挂句柄
    body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => true } },
  }
  const sandbox = {
    location: { origin: 'https://admin.dev.example.com', hostname: 'admin.dev.example.com', hash: '#/home', port: '' },
    fetch: fetchImpl,
    crypto: { randomUUID: () => 'request-id' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    history: { length: 1, back() {} },
    setTimeout, clearTimeout,
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length },
    clearInterval() {},
    console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
    scrollTo() {},
    A380OAuth: { ready: new Promise(() => {}), refreshContext: async () => {} },
    A380_DATA: { services: [], venues: { ktv: { address: 'A380 KTV', tags: [] } } },
    __A380_TEST__: {},
    document: documentStub,
    addEventListener(type, handler) { (listeners[type] = listeners[type] || []).push(handler) },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  if (options.requestTimeoutMs !== undefined) sandbox.SAAS_REQUEST_TIMEOUT_MS = options.requestTimeoutMs

  vm.createContext(sandbox)
  for (const name of ['money.js', 'datetime.js', 'business-hours.js', 'api-errors.js', 'page-load.js',
    'reservation-room.js', 'saas.js']) {
    vm.runInContext(sources[name], sandbox, { filename: name })
  }
  // 测试专用出口：产品代码本身不导出，这里只把函数声明挂到桩上，行为与浏览器完全一致。
  vm.runInContext(sources['app.js'] + '\n;__A380_TEST__.render = render;'
    + '__A380_TEST__.refreshVisibleView = refreshVisibleView;\n', sandbox, { filename: 'app.js' })
  sandbox.SAAS.activate()
  sandbox.SAAS.setCurrency('CNY')

  return {
    sandbox,
    api: sandbox.__A380_TEST__,
    app: appEl,
    errors,
    intervals,
    /** 派发事件：document 与 window 的监听器同表（与浏览器里同名事件等价）。 */
    dispatch: (type) => (listeners[type] || []).forEach((handler) => handler({ type })),
    flush: async (ms = 5) => { await new Promise((resolve) => setTimeout(resolve, ms)) },
    node: (id) => sandbox.document.querySelector('#' + id),
  }
}

/** 刷新定时器：注册在 app.js 里的那条 ≥30s 的定时器（首屏那次 embeddedHost 轮询是 250ms）。 */
const refreshTimer = (harness) => harness.intervals.find((entry) => entry.ms >= 30000)

/** 计数：真正打到某个接口的请求数。 */
const countCalls = (calls, part) => calls.filter((url) => url.includes(part)).length

// —— ① 源码守卫：触发点、定时器下限、路由守卫 ——

test('源码守卫：visibilitychange → visible 触发静默刷新（唯一入口 refreshVisibleView）', async () => {
  const source = await repoFile('app.js')

  expect(source).toContain("document.addEventListener('visibilitychange'")
  const handlerAt = source.indexOf("document.addEventListener('visibilitychange'")
  const handler = source.slice(handlerAt, source.indexOf('});', handlerAt))
  expect(handler).toContain('refreshVisibleView()')
  // 隐藏的那一刻不刷（只有「回到可见」才刷）：浏览器里 visibilitychange 两个方向都会触发
  expect(handler).toContain("document.visibilityState === 'hidden'")

  // 回到前台刷的是「当前路由」，不是写死的某一页
  const at = source.indexOf('function refreshVisibleView()')
  const fn = source.slice(at, source.indexOf('\ndocument.addEventListener', at))
  expect(fn).toContain('var route = currentRoute();')
  expect(fn).toContain('silentRefreshFor(route)')
  // 幂等：同一路由已有刷新在途不再叠一次
  expect(fn).toContain('if (refreshInFlight[route]) return false;')
  // 未激活（本地演示 / OAuth 未完成）不发请求
  expect(fn).toContain('if (!SAAS.live) return false;')
})

test('源码守卫：定时器 ≥30s，且文档隐藏时一跳都不发（不做轮询式刷新）', async () => {
  const source = await repoFile('app.js')

  const hit = source.match(/var REFRESH_INTERVAL_MS = (\d+);/)
  expect(hit, '未找到刷新间隔常量').toBeTruthy()
  expect(Number(hit[1])).toBeGreaterThanOrEqual(30000)

  expect(source).toContain('setInterval(function () { refreshVisibleView(); }, REFRESH_INTERVAL_MS);')

  // 唯一的刷新入口自己挡掉隐藏态：定时器在后台空转也不发请求
  const at = source.indexOf('function refreshVisibleView()')
  const fn = source.slice(at, source.indexOf('\ndocument.addEventListener', at))
  expect(fn).toContain('if (document.hidden === true || document.visibilityState === \'hidden\') return false;')
})

test('源码守卫：静默刷新带路由守卫，钱 / 状态视图走同一份 load + render', async () => {
  const source = await repoFile('app.js')

  // 路由解析唯一入口 + 守卫口径
  expect(source).toContain('function currentRoute() { return location.hash.replace(/^#\\/?/, \'\') || \'home\'; }')
  expect(source).toContain('function routeIsCurrent(route) { return currentRoute() === route; }')
  expect(source).toContain('const route = currentRoute();')   // render() 与守卫同一口径

  // 登记的视图：订单列表 / 订单账单 / 我的预约 / 钱包积分 / 我的 / 首页余额
  const table = source.slice(source.indexOf('function silentRefreshFor(route)'))
  for (const route of ["'home'", "'my'", "'my-orders'", "'my-reservations'", "'ledger'", "'order-bill'"]) {
    expect(table).toContain(route)
  }
  // 刻意不登记：加项页（提交后自渲染）、支付页（用户正在填分腿金额）、购物车等本地态
  const tableBody = table.slice(0, table.indexOf('\n}'))
  for (const notWired of ['order-items', 'pay', 'cart']) {
    expect(tableBody).not.toContain(notWired)
  }

  // 每个刷新入口都带守卫；静默刷新复用首屏的 load / render（不存在第二条数据路径）
  for (const marker of ['function refreshMyOrders()', 'function refreshMyReservations()',
    'function refreshOrderBill(orderId)', 'function refreshLedger(type)']) {
    const at = source.indexOf(marker)
    expect(at, marker + ' 未找到').toBeGreaterThan(0)
    const body = source.slice(at, source.indexOf('\n}', at))
    expect(body).toContain('A380PageLoad.refreshPage')
    expect(body).toContain('routeIsCurrent(route)')
  }
  expect(source).toContain('load: loadMyOrders,')
  expect(source).toContain('render: paintMyOrders,')
  expect(source).toContain('load: loadMyReservations,')
  expect(source).toContain('render: paintMyReservations,')
  expect(source).toContain('load: function () { return loadOrderBill(orderId); },')
  expect(source).toContain('load: function () { return loadLedgerData(type); },')
})

test('源码守卫：静默刷新不挂加载态 / 失败不替换屏上数据；首屏渲染带守卫', async () => {
  const pageLoad = await repoFile('page-load.js')

  const at = pageLoad.indexOf('async function refreshPage(options)')
  expect(at).toBeGreaterThan(0)
  const body = pageLoad.slice(at, pageLoad.indexOf('root.A380PageLoad = {'))
  expect(body).not.toContain('loadingHtml')   // 屏上已有数据：不闪加载态
  expect(body).not.toContain('errorHtml')     // 失败保留屏上数据：不整页替换成错误页
  expect(body).toContain('if (!isCurrent()) return { ok: false, skipped: true };')  // 换页后连请求都不发
  expect(body).toContain('if (!isCurrent()) return { ok: false, stale: true, value: value };')
  expect(body).toContain('options.render(value)')

  // 首屏 renderPage 也带同一把守卫：请求回来晚，成功结果与错误态都不落到别的页面上
  const renderAt = pageLoad.indexOf('async function renderPage(options)')
  const renderBody = pageLoad.slice(renderAt, at)
  expect(renderBody).toContain('if (!isCurrent()) return { ok: false, stale: true, value: value };')
  expect(renderBody.indexOf('if (!isCurrent()) return')).toBeLessThan(renderBody.indexOf('options.render(value)'))
  expect(renderBody).toContain('if (!isCurrent()) return { ok: false, stale: true, error: error };')
  // 导出给页面用
  expect(pageLoad).toContain('refreshPage: refreshPage,')
})

test('源码守卫：刷新不重新引入金额算术，订单卡片仍只读服务端实时合计', async () => {
  const source = await repoFile('app.js')
  /** 取某个函数声明到下一段块注释 / 下一个函数声明之间的正文。 */
  const bodyOf = (marker) => {
    const rest = source.slice(source.indexOf(marker))
    const cuts = [rest.indexOf('\n/**'), rest.indexOf('\nfunction '), rest.indexOf('\nasync function ')]
      .filter((index) => index > 0)
    return cuts.length ? rest.slice(0, Math.min(...cuts)) : rest
  }

  // 金额唯一口径：orderCard → orderLiveAmount（服务端 liveTotalAmount，缺失才退 totalAmount）
  expect(source).toContain('function orderLiveAmount(o)')
  expect(source).toContain('minorMoney(orderLiveAmount(o), o.currencyCode)')
  expect(source).not.toContain('minorMoney(o.totalAmount || 0, o.currencyCode)')
  expect(source).not.toContain('totalAmount + roomEstimatedFee')
  // 刷新路径不得对金额做加减（房费重复计算的坑）
  expect(source).not.toMatch(/liveTotalAmount[^\n;]*[+-]\s*[A-Za-z_$]/)

  // 列表绘制只有一处：静默刷新复用 orderCard，不另起一套金额渲染
  const paintOrders = bodyOf('function paintMyOrders')
  expect(paintOrders).toContain('list.map(orderCard)')
  expect(paintOrders).not.toContain('minorMoney')
  // 账单绘制同样唯一：首屏与静默刷新共用 paintOrderBill
  expect(source).toContain('paintOrderBill(orderId, bill);')
  expect(source).toContain('render: function (bill) { paintOrderBill(orderId, bill); },')
})

// —— ② 集成：真实 app.js + 受控 fetch + 最小 DOM 桩 ——

test('回到前台（visibilitychange）：订单列表静默重取，金额与状态跟上后台改动，不闪加载态', async () => {
  let current = order()
  const calls = []
  const harness = await loadCend(async (url) => {
    const target = String(url)
    calls.push(target)
    if (target.includes(ORDERS_URL)) return json([current])
    if (target.includes('/api/v1/admin/tenant/config')) return json({})
    return json({})
  })

  harness.sandbox.location.hash = '#/my-orders'
  await harness.api.render()
  expect(harness.app.innerHTML).toContain('¥61.50')
  expect(harness.app.innerHTML).toContain('服务中')

  // 后台确认加项 / 结台：服务端重新给出 liveTotalAmount 与状态
  current = order({ status: 'COMPLETED', liveTotalAmount: 10150, totalAmount: 10150 })
  const before = countCalls(calls, ORDERS_URL)

  harness.sandbox.document.hidden = false
  harness.sandbox.document.visibilityState = 'visible'
  harness.dispatch('visibilitychange')
  await harness.flush(20)

  expect(countCalls(calls, ORDERS_URL), '回到前台没有重新取数').toBe(before + 1)
  expect(harness.app.innerHTML).toContain('¥101.50')
  expect(harness.app.innerHTML).toContain('已完成')
  expect(harness.app.innerHTML).not.toContain('加载中')            // 静默：屏上不再出现加载态
  expect(harness.app.history.filter((html) => html.includes('加载中'))).toHaveLength(1)  // 只有首屏那一次
})

test('回到前台（visibilitychange）：账单页静默重取，收款后已收 / 应收跟上', async () => {
  let bill = {
    status: 'WAITING_PAYMENT', totalAmount: 10150, paidAmount: 0, payableAmount: 10150, currencyCode: 'CNY',
    roomFee: { name: '包厢费（含 1 名服务人员）', amount: 6150 }, items: [], servers: [], promotions: [],
  }
  const calls = []
  const harness = await loadCend(async (url) => {
    const target = String(url)
    calls.push(target)
    if (target.includes(billUrl(9))) return json(bill)
    return json({})
  })

  harness.sandbox.location.hash = '#/order-bill/9'
  await harness.api.render()
  expect(harness.app.innerHTML).toContain('¥101.50')
  expect(harness.app.innerHTML).toContain('应收')

  // 后台收款：已收 = 应收
  bill = Object.assign({}, bill, { status: 'COMPLETED', paidAmount: 10150, payableAmount: 0 })
  const before = countCalls(calls, billUrl(9))

  harness.dispatch('visibilitychange')
  await harness.flush(20)

  expect(countCalls(calls, billUrl(9))).toBe(before + 1)
  expect(harness.app.innerHTML).toContain('已收')
  expect(harness.app.innerHTML).toContain('¥101.50')
  expect(harness.app.innerHTML).not.toContain('加载中')
  expect(harness.app.history.filter((html) => html.includes('加载中'))).toHaveLength(1)
})

test('回到前台（visibilitychange）：钱包明细页静默重取余额与明细', async () => {
  let wallet = { tokenAmount: '1000', availableAmount: '100000', currencyCode: 'CNY' }
  let ledger = [{ entryType: 'RECHARGE', amount: '100000', tokenAmount: '1000' }]
  const calls = []
  const harness = await loadCend(async (url) => {
    const target = String(url)
    calls.push(target)
    if (target.includes('/api/v1/me/wallet/ledger')) return json(ledger)
    if (target.includes('/api/v1/me/wallet')) return json(wallet)
    if (target.includes('/api/v1/admin/tenant/config')) return json({})
    return json({})
  })

  harness.sandbox.location.hash = '#/ledger/coin'
  await harness.api.render()
  expect(harness.node('ledger-balance').textContent).toBe('1,000')
  expect(harness.node('ledger-list').innerHTML).toContain('充值')

  // 后台充值：余额与明细都变
  wallet = { tokenAmount: '2500', availableAmount: '250000', currencyCode: 'CNY' }
  ledger = [{ entryType: 'RECHARGE', amount: '250000', tokenAmount: '2500' }]
  const before = countCalls(calls, '/api/v1/me/wallet')
  const renders = harness.app.history.length

  harness.dispatch('visibilitychange')
  await harness.flush(20)

  expect(countCalls(calls, '/api/v1/me/wallet')).toBeGreaterThan(before)
  expect(harness.node('ledger-balance').textContent).toBe('2,500')
  // 静默：整页骨架没有被重绘（不挂加载态），只更新了余额与明细两个节点
  expect(harness.app.history.length).toBe(renders)
  expect(harness.node('ledger-list').innerHTML).toContain('充值')
  expect(harness.node('ledger-list').innerHTML).not.toContain('加载中')
})

test('定时器 ≥30s 且文档隐藏时一跳都不发；回到可见才发', async () => {
  const calls = []
  const harness = await loadCend(async (url) => {
    calls.push(String(url))
    return json([order()])
  })

  harness.sandbox.location.hash = '#/my-orders'
  await harness.api.render()

  const timer = refreshTimer(harness)
  expect(timer, '没有注册 ≥30s 的刷新定时器').toBeTruthy()
  expect(timer.ms).toBeGreaterThanOrEqual(30000)

  // 文档隐藏：定时器到点也不发请求
  harness.sandbox.document.hidden = true
  harness.sandbox.document.visibilityState = 'hidden'
  const before = countCalls(calls, ORDERS_URL)
  timer.fn()
  harness.dispatch('visibilitychange')          // hidden 方向的 visibilitychange 同样不刷
  await harness.flush(20)
  expect(countCalls(calls, ORDERS_URL)).toBe(before)

  // 回到可见：定时器到点发一次
  harness.sandbox.document.hidden = false
  harness.sandbox.document.visibilityState = 'visible'
  timer.fn()
  await harness.flush(20)
  expect(countCalls(calls, ORDERS_URL)).toBe(before + 1)
})

test('幂等：同一路由的刷新还在途时，再触发不会叠第二次请求', async () => {
  let release = () => {}
  let ordersCalls = 0
  const harness = await loadCend(async (url) => {
    if (String(url).includes(ORDERS_URL)) {
      ordersCalls += 1
      if (ordersCalls > 1) await new Promise((resolve) => { release = resolve })
      return json([order()])
    }
    return json({})
  })

  harness.sandbox.location.hash = '#/my-orders'
  await harness.api.render()
  expect(ordersCalls).toBe(1)

  harness.dispatch('visibilitychange')
  await harness.flush(5)
  expect(ordersCalls).toBe(2)                   // 第一次静默刷新已经发出

  harness.dispatch('visibilitychange')          // 还在途：不叠
  refreshTimer(harness).fn()                    // 定时器到点：同样不叠
  await harness.flush(5)
  expect(ordersCalls).toBe(2)

  release()                                     // 在途那次落地后才允许下一次
  await harness.flush(20)
  harness.dispatch('visibilitychange')
  await harness.flush(20)
  expect(ordersCalls).toBe(3)
})

test('路由守卫：换页后落地的刷新结果整批丢弃，不画到当前页上', async () => {
  let release = () => {}
  let ordersCalls = 0
  const harness = await loadCend(async (url) => {
    const target = String(url)
    if (target.includes(ORDERS_URL)) {
      ordersCalls += 1
      if (ordersCalls > 1) await new Promise((resolve) => { release = resolve })
      return json([order({ liveTotalAmount: 10150 })])
    }
    return json({})
  })

  harness.sandbox.location.hash = '#/my-orders'
  await harness.api.render()

  // 静默刷新发出后挂住，用户这时点了「我的」
  harness.dispatch('visibilitychange')
  await harness.flush(5)
  expect(ordersCalls).toBe(2)
  harness.sandbox.location.hash = '#/my'
  await harness.api.render()
  const myHtml = harness.app.innerHTML
  expect(myHtml).toContain('me-hero')

  // 旧请求这时才回来：屏上必须还是「我的」，没有被订单列表盖掉
  release()
  await harness.flush(20)
  expect(harness.app.innerHTML).toBe(myHtml)
  expect(harness.app.innerHTML).not.toContain('¥101.50')
})

test('刷新失败保留屏上数据：不出错误页、不退回加载态', async () => {
  let healthy = true
  const harness = await loadCend(async (url) => {
    if (String(url).includes(ORDERS_URL)) {
      return healthy ? json([order()]) : fail(503, 'SERVICE_UNAVAILABLE', '服务暂时不可用')
    }
    return json({})
  })

  harness.sandbox.location.hash = '#/my-orders'
  await harness.api.render()
  const onScreen = harness.app.innerHTML
  expect(onScreen).toContain('¥61.50')

  healthy = false
  harness.dispatch('visibilitychange')
  await harness.flush(20)

  expect(harness.app.innerHTML).toBe(onScreen)              // 屏上数据原样保留
  expect(harness.app.innerHTML).not.toContain('加载失败')
  expect(harness.app.innerHTML).not.toContain('加载中')
  expect(harness.errors.length, '刷新失败应至少在控制台留痕').toBeGreaterThan(0)
})

test('导航回到这些页面：仍走原有 hashchange → render 路径重新取数（不是第二条数据路径）', async () => {
  let current = order()
  const calls = []
  const harness = await loadCend(async (url) => {
    calls.push(String(url))
    if (String(url).includes(ORDERS_URL)) return json([current])
    return json({})
  })

  harness.sandbox.location.hash = '#/my'
  await harness.api.render()
  expect(countCalls(calls, ORDERS_URL)).toBe(0)

  // 后台改价后，用户从「我的」点进「我的消费」：hashchange 触发 render → 同一套 renderPage 重新取数
  current = order({ liveTotalAmount: 10150, status: 'COMPLETED' })
  harness.sandbox.location.hash = '#/my-orders'
  harness.dispatch('hashchange')
  await harness.flush(20)

  expect(countCalls(calls, ORDERS_URL)).toBe(1)
  expect(harness.app.innerHTML).toContain('¥101.50')
  expect(harness.app.innerHTML).toContain('已完成')
})

test('未激活（SAAS.live 未建立）时不发刷新请求：演示态不把 mock 数据盖到页面上', async () => {
  const calls = []
  const harness = await loadCend(async (url) => {
    calls.push(String(url))
    return json([order()])
  })
  harness.sandbox.location.hash = '#/my-orders'
  await harness.api.render()
  const before = countCalls(calls, ORDERS_URL)

  harness.sandbox.SAAS.live = false
  harness.dispatch('visibilitychange')
  refreshTimer(harness).fn()
  await harness.flush(20)
  expect(countCalls(calls, ORDERS_URL)).toBe(before)   // 一次都没有多取
  expect(harness.api.refreshVisibleView()).toBe(false)
})
