import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, test, vi } from 'vitest'

/**
 * 「加服务项」一直加载中（线上缺陷）的回归守卫。
 *
 * 现象：我的消费 → 加服务项 → 页面永远停在「加载中…」。
 * 真因（两层）：
 *   1) 接口失败：C 端消费者会话（appId=saas-a380-c）的权限快照来自
 *      iam_consumer_application.permissions_json，只有 reservation.view / reservation.create；
 *      而 `GET /api/v1/business/orders/{id}/items` 要求商户权限码 order.view
 *      （gv_im_server OrderItemController#listItems），于是回 403 PERMISSION_DENIED。
 *   2) 前端无兜底：renderOrderItems 把两个 await 裸放在 async 函数里，既没有 try/catch
 *      也没有请求超时，异常直接冒泡出事件处理器，页面就停在加载态。
 *
 * 本文件用「真实 app.js + 真实 saas.js + 受控 fetch + 最小 DOM 桩」复现并锁死：
 *   ① listOrderItems 403/503/超时 → 渲染可重试的错误态，绝不留在「加载中…」；
 *   ② listCatalog 失败同样如此；
 *   ③ 正常路径渲染服务类目录项（缺 availableQuantity/unit/图片 等实物字段也不崩）；
 *   ④ 提交加服务项的请求体与成功/失败提示。
 */

const repoFile = (name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8')

const json = (data) => ({ ok: true, status: 200, json: async () => data })
const fail = (status, code, message) => ({
  ok: false, status, text: async () => JSON.stringify({ code, message }),
})

/** 最小 DOM 桩：只实现 app/toast/body 上被真实代码用到的成员。 */
function createAppElement() {
  const history = []
  let html = ''
  let chips = []
  return {
    history,
    get innerHTML() { return html },
    set innerHTML(value) {
      html = String(value)
      history.push(html)
      chips = []
      const pattern = /data-catalog-id="(\d+)"/g
      let hit
      while ((hit = pattern.exec(html)) !== null) {
        const handlers = {}
        const id = hit[1]
        chips.push({
          handlers,
          getAttribute: (name) => (name === 'data-catalog-id' ? id : null),
          addEventListener: (type, handler) => { handlers[type] = handler },
        })
      }
    },
    querySelector: () => null,
    querySelectorAll(selector) {
      return String(selector).includes('data-catalog-id') ? chips : []
    },
  }
}

/**
 * 用真实 c-end 脚本装配一个浏览器等价环境（window 即全局，与浏览器一致），
 * 并暴露 render/renderOrderItems 供断言（测试专用出口，不改动产品代码的加载方式）。
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
  const errors = []
  const sandbox = {
    // window 必须与全局同物：脚本里 window.A380X 与裸标识符 A380X 是同一份（浏览器语义）
    location: { origin: 'https://admin.dev.example.com', hostname: 'admin.dev.example.com', hash: '#/home', port: '' },
    fetch: fetchImpl,
    crypto: { randomUUID: () => 'request-id' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    history: { length: 1, back() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
    scrollTo() {},
    A380OAuth: { ready: new Promise(() => {}), refreshContext: async () => {} },
    A380_DATA: { services: [], venues: { ktv: { address: 'A380 KTV', tags: [] } } },
    __A380_TEST__: {},
    document: {
      querySelector(selector) {
        if (selector === '#app') return appEl
        if (selector === '#toast') return toastEl
        return null
      },
      addEventListener(type, handler) { (listeners[type] = listeners[type] || []).push(handler) },
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {} }),
      // contains('embedded-host') = true：让 syncEmbeddedHost 的轮询定时器第一跳就收尾，不留悬挂句柄
      body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => true } },
    },
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
    + '__A380_TEST__.renderOrderItems = renderOrderItems;'
    + '__A380_TEST__.renderMyOrders = renderMyOrders;'
    + '__A380_TEST__.renderMyReservations = renderMyReservations;'
    + '__A380_TEST__.paintOrderBill = paintOrderBill;\n', sandbox, { filename: 'app.js' })
  sandbox.SAAS.activate()
  sandbox.SAAS.setCurrency('CNY')

  return {
    sandbox,
    api: sandbox.__A380_TEST__,
    app: appEl,
    toast: toastEl,
    errors,
    click: (event) => (listeners.click || []).forEach((handler) => handler(event)),
    flush: async (ms = 5) => { await new Promise((resolve) => setTimeout(resolve, ms)) },
  }
}

/** 点击事件桩：只认 [data-retry]，其余选择器一律不命中（与真实 DOM 的语义一致）。 */
function clickTarget({ retry } = {}) {
  return {
    classList: { contains: () => false },
    closest(selector) {
      if (selector === '[data-retry]' && retry) return { dataset: { retry } }
      return null
    },
  }
}

const ORDER_ITEMS_URL = '/api/v1/business/orders/9/items'
const CATALOG_URL = '/api/v1/business/catalog/items'

/** 服务类目录项：item_type=SERVICE，未关联商品，只有目录自身单价（后台「加项能对服务加项」）。 */
const SERVICE_CATALOG = [
  { id: 7, name: '陪唱服务', category: '服务', itemType: 'SERVICE', unitPrice: 3000, unit: null, available: true },
]

// —— ① 加载态 / 错误态是纯函数：可直接断言 ——

test('加载态与错误态是导出函数：错误态带重试按钮、绝不含「加载中」', async () => {
  const window = {}
  vm.runInNewContext(await repoFile('api-errors.js'), { window })
  vm.runInNewContext(await repoFile('page-load.js'), { window })

  const loading = window.A380PageLoad.loadingHtml('加载中…')
  expect(loading).toContain('加载中…')
  expect(loading).toContain('item-list')

  const denied = Object.assign(new Error('HTTP 403 {"code":"PERMISSION_DENIED","message":"缺少权限: order.view"}'),
    { status: 403, code: 'PERMISSION_DENIED' })
  const html = window.A380PageLoad.errorHtml('加项列表加载失败', denied, 'order-items/9')
  expect(html).toContain('加项列表加载失败')
  expect(html).toContain('没有操作权限')          // 403 翻成中文可执行提示（api-errors.js）
  expect(html).not.toContain('PERMISSION_DENIED') // 不把错误码直出页面
  expect(html).toContain('data-retry="order-items/9"')
  expect(html).toContain('重试')
  expect(html).not.toContain('加载中')
  // 超时错误码同样有中文文案
  const timeout = window.A380PageLoad.timeoutError(15000)
  expect(window.A380ApiErrors.describe(timeout)).toContain('请求超时')
  // 没有可重试入口时不出按钮（避免出现点了没反应的控件）
  expect(window.A380PageLoad.errorHtml('加载失败', denied)).not.toContain('data-retry')
})

test('renderPage：load 抛错 / 超时都把已挂载的加载态替换成错误态', async () => {
  const window = { console: { error() {} } }
  vm.runInNewContext(await repoFile('page-load.js'), { window, setTimeout, clearTimeout })
  const { renderPage, loadingHtml } = window.A380PageLoad

  const mounted = []
  const mount = (html) => mounted.push(html)

  // 403：挂载顺序必须是「加载中 → 错误态」，中间不存在停留在加载态的分支
  const denied = Object.assign(new Error('HTTP 403'), { status: 403, code: 'PERMISSION_DENIED' })
  let outcome = await renderPage({
    mount, name: 'order-items', retryRoute: 'order-items/9', errorTitle: '加项列表加载失败',
    load: async () => { throw denied }, render: () => mounted.push('SHOULD-NOT-RENDER'),
  })
  expect(outcome.ok).toBe(false)
  expect(mounted).toHaveLength(2)
  expect(mounted[0]).toBe(loadingHtml())
  expect(mounted[1]).toContain('加项列表加载失败')
  expect(mounted[1]).toContain('data-retry="order-items/9"')
  expect(mounted[1]).not.toContain('加载中')

  // 接口永不返回：页面级超时兜底同样转错误态
  mounted.length = 0
  outcome = await renderPage({
    mount, name: 'order-items', timeoutMs: 10, errorTitle: '加项列表加载失败',
    load: () => new Promise(() => {}), render: () => mounted.push('SHOULD-NOT-RENDER'),
  })
  expect(outcome.ok).toBe(false)
  expect(outcome.error.code).toBe('REQUEST_TIMEOUT')
  expect(mounted).toHaveLength(2)
  expect(mounted[0]).toContain('加载中')                // 先挂加载态
  expect(mounted[1]).toContain('加项列表加载失败')        // 超时后必须被替换成错误态
  expect(mounted[1]).not.toContain('加载中')

  // 成功路径：render 收到数据，且不出现错误态
  mounted.length = 0
  outcome = await renderPage({
    mount, load: async () => [{ id: 1 }], render: (value) => mounted.push('OK:' + value[0].id),
  })
  expect(outcome).toEqual({ ok: true, value: [{ id: 1 }] })
  expect(mounted).toEqual([window.A380PageLoad.loadingHtml(), 'OK:1'])
})

// —— ② renderOrderItems：接口失败一律错误态，绝不「一直加载中」 ——

test('renderOrderItems：listOrderItems 403 时渲染错误态（可重试），不再停在「加载中…」', async () => {
  const harness = await loadCend(async (url) => {
    if (String(url).includes(ORDER_ITEMS_URL)) {
      return fail(403, 'PERMISSION_DENIED', '缺少权限: order.view')
    }
    return json([])
  })

  await harness.api.renderOrderItems(9)

  const html = harness.app.innerHTML
  expect(html).toContain('加项列表加载失败')
  expect(html).toContain('没有操作权限')                    // api-errors.js 的 403 中文文案
  expect(html).toContain('data-retry="order-items/9"')
  expect(html).not.toContain('加载中')
  // 曾经把页面钉死的加载态确实先渲染过：证明是「加载态被错误态替换」而不是压根没渲染
  expect(harness.app.history[0]).toContain('加载中')
  expect(harness.errors.length).toBeGreaterThan(0)
})

test('renderOrderItems：listOrderItems 503 / 请求超时同样渲染错误态', async () => {
  const unavailable = await loadCend(async (url) => {
    if (String(url).includes(ORDER_ITEMS_URL)) return fail(503, 'SERVICE_UNAVAILABLE', '服务暂时不可用')
    return json([])
  })
  await unavailable.api.renderOrderItems(9)
  expect(unavailable.app.innerHTML).toContain('服务暂时不可用')
  expect(unavailable.app.innerHTML).toContain('data-retry="order-items/9"')
  expect(unavailable.app.innerHTML).not.toContain('加载中')

  // 接口挂住不返回：请求超时（可注入）必须把它变成错误态
  const hung = await loadCend(() => new Promise(() => {}), { requestTimeoutMs: 20 })
  await hung.api.renderOrderItems(9)
  expect(hung.app.innerHTML).toContain('请求超时')
  expect(hung.app.innerHTML).toContain('data-retry="order-items/9"')
  expect(hung.app.innerHTML).not.toContain('加载中')
})

test('renderOrderItems：listCatalog 失败同样渲染错误态（第二个 await 也不能裸奔）', async () => {
  const harness = await loadCend(async (url) => {
    if (String(url).includes(CATALOG_URL)) return fail(403, 'PERMISSION_DENIED', '缺少权限: order.view')
    return json([{ id: 1, catalogItemId: 7, nameSnapshot: '陪唱服务', quantity: 1, totalAmount: 3000, status: 'PENDING_APPROVAL' }])
  })

  await harness.api.renderOrderItems(9)

  expect(harness.app.innerHTML).toContain('加项列表加载失败')
  expect(harness.app.innerHTML).toContain('data-retry="order-items/9"')
  expect(harness.app.innerHTML).not.toContain('加载中')
})

test('错误态「重试」按钮能重新渲染当前页（同一路由不依赖 hashchange）', async () => {
  let failFirst = true
  const harness = await loadCend(async (url) => {
    if (String(url).includes(ORDER_ITEMS_URL)) {
      if (failFirst) return fail(503, 'SERVICE_UNAVAILABLE', '服务暂时不可用')
      return json([{ id: 1, catalogItemId: 7, nameSnapshot: '陪唱服务', quantity: 1, totalAmount: 3000, status: 'PENDING_APPROVAL' }])
    }
    return json(SERVICE_CATALOG)
  })

  harness.sandbox.location.hash = '#/order-items/9'
  await harness.api.renderOrderItems(9)
  expect(harness.app.innerHTML).toContain('data-retry="order-items/9"')

  failFirst = false
  harness.click({ target: clickTarget({ retry: 'order-items/9' }) })
  await harness.flush()

  expect(harness.app.innerHTML).toContain('陪唱服务')
  expect(harness.app.innerHTML).not.toContain('加载失败')
})

// —— ③ 正常路径：服务类目录项能展示（缺实物字段不崩） ——

test('renderOrderItems：正常路径渲染服务类目录项与已加项（缺 availableQuantity/unit/图片不崩）', async () => {
  const harness = await loadCend(async (url) => {
    if (String(url).includes(ORDER_ITEMS_URL)) {
      return json([
        { id: 1, catalogItemId: 7, nameSnapshot: '陪唱服务', quantity: 1, totalAmount: 3000, status: 'PENDING_APPROVAL' },
      ])
    }
    return json(SERVICE_CATALOG.concat([
      // 极端情况：目录项连单价都没有（后端脏数据）——只展示「—」，不得整页掉进错误态
      { id: 8, name: '待定价服务', category: '服务', itemType: 'SERVICE' },
      // 售罄项：置灰并给出原因
      { id: 9, name: '清洁服务', category: '服务', itemType: 'SERVICE', unitPrice: 2000, available: false, unavailableReason: '已售罄' },
    ]))
  })

  await harness.api.renderOrderItems(9)

  const html = harness.app.innerHTML
  expect(html).not.toContain('加载失败')
  expect(html).toContain('点服务 / 点商品')
  expect(html).toContain('陪唱服务')                 // 服务类目录项与已加项都在
  expect(html).toContain('¥30.00')                   // 目录单价按最小货币单位展示
  expect(html).toContain('待确认')                    // 已加项状态：PENDING_APPROVAL
  expect(html).toContain('data-catalog-id="7"')
  expect(html).toContain('待定价服务')
  expect(html).toContain('—')                        // 缺 unitPrice 时只展示「—」（money.js 同一入口），不出现 NaN
  expect(html).not.toContain('NaN')
  expect(html).toContain('data-catalog-id="9"')
  expect(html).toContain('已售罄')
  expect(html).not.toContain('暂无加项')   // 有加项时不展示空态
})

test('renderOrderItems：目录为空时给明确空态（不再显示「目录加载中或为空」）', async () => {
  const harness = await loadCend(async (url) => json(String(url).includes(CATALOG_URL) ? [] : []))
  await harness.api.renderOrderItems(9)
  expect(harness.app.innerHTML).toContain('目录暂无可用项目')
  expect(harness.app.innerHTML).not.toContain('加载中')
})

// —— ④ 提交加服务项：请求体与成功/失败提示 ——

test('点目录卡片加服务项：POST 只传 catalogItemId + source=CUSTOMER，成功提示待确认', async () => {
  const calls = []
  const harness = await loadCend(async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).includes('/auth/csrf')) return json({ csrfToken: 'csrf-token' })
    if (init.method === 'POST' && String(url).includes(ORDER_ITEMS_URL)) {
      return json({ id: 501, status: 'PENDING_APPROVAL', source: 'CUSTOMER' })
    }
    if (String(url).includes(ORDER_ITEMS_URL)) return json([])
    return json(SERVICE_CATALOG)
  })

  await harness.api.renderOrderItems(9)
  const chip = harness.app.querySelectorAll('[data-catalog-id]')[0]
  expect(chip, '目录卡片未渲染，无法提交').toBeTruthy()

  await chip.handlers.click()
  await harness.flush()

  const post = calls.find((call) => call.init.method === 'POST' && call.url.includes(ORDER_ITEMS_URL))
  expect(post, '未发出加项请求').toBeTruthy()
  expect(post.url).toBe('https://admin.dev.example.com' + ORDER_ITEMS_URL)
  const body = JSON.parse(post.init.body)
  expect(body).toEqual({ itemType: 'ADD_ON', quantity: 1, source: 'CUSTOMER', catalogItemId: 7 })
  // 价格/名称由服务端按目录快照回填，客户端不得传（防止篡改价格）
  expect(body).not.toHaveProperty('unitPrice')
  expect(body).not.toHaveProperty('name')
  expect(harness.toast.textContent).toBe('已提交，待服务人员确认')
})

test('加服务项失败：弹出后端中文原因（库存不足 409），不是裸错误码', async () => {
  const harness = await loadCend(async (url, init = {}) => {
    if (String(url).includes('/auth/csrf')) return json({ csrfToken: 'csrf-token' })
    if (init.method === 'POST' && String(url).includes(ORDER_ITEMS_URL)) {
      return fail(409, 'INVENTORY_INSUFFICIENT', '可用库存不足')
    }
    if (String(url).includes(ORDER_ITEMS_URL)) return json([])
    return json(SERVICE_CATALOG)
  })

  await harness.api.renderOrderItems(9)
  await harness.app.querySelectorAll('[data-catalog-id]')[0].handlers.click()
  await harness.flush()

  expect(harness.toast.textContent).toContain('可用库存不足')
  expect(harness.toast.textContent).not.toContain('INVENTORY_INSUFFICIENT')
})

// —— 我的消费 / 我的预约：同类渲染函数同样不得停在加载中 ——

test('renderMyOrders / renderMyReservations：接口失败渲染错误态而不是停在「加载中…」', async () => {
  const harness = await loadCend(async () => fail(503, 'SERVICE_UNAVAILABLE', '服务暂时不可用'))

  // 渲染前先站到该路由上：页面渲染带路由守卫（请求回来晚就整批丢弃），错误态只落到发起渲染的那一刻所在的路由。
  harness.sandbox.location.hash = '#/my-orders'
  await harness.api.renderMyOrders()
  expect(harness.app.innerHTML).toContain('消费单加载失败')
  expect(harness.app.innerHTML).toContain('data-retry="my-orders"')
  expect(harness.app.innerHTML).not.toContain('加载中')

  harness.sandbox.location.hash = '#/my-reservations'
  await harness.api.renderMyReservations()
  expect(harness.app.innerHTML).toContain('预约加载失败')
  expect(harness.app.innerHTML).toContain('data-retry="my-reservations"')
  expect(harness.app.innerHTML).not.toContain('加载中')
})

// —— 接口层：超时可注入、错误码与请求路径可断言 ——

test('saas.js：请求超时可注入（REQUEST_TIMEOUT / 504），请求路径与 403 错误码原样透传', async () => {
  const saasSource = await repoFile('saas.js')
  const moneySource = await repoFile('money.js')

  // 超时：注入 20ms + 永不返回的 fetch
  {
    const window = {
      location: { origin: 'https://admin.dev.example.com', hostname: 'admin.dev.example.com' },
      A380OAuth: { refreshContext: vi.fn() },
      SAAS_REQUEST_TIMEOUT_MS: 20,
    }
    const context = { window, fetch: () => new Promise(() => {}), setTimeout, clearTimeout,
      console: { warn() {}, error() {} }, crypto: { randomUUID: () => 'id' } }
    vm.runInNewContext(moneySource, context)
    vm.runInNewContext(saasSource, context)
    window.SAAS.activate()
    expect(window.SAAS.requestTimeoutMs()).toBe(20)
    const error = await window.SAAS.listOrderItems(9).then(() => null, (e) => e)
    expect(error.code).toBe('REQUEST_TIMEOUT')
    expect(error.status).toBe(504)
  }

  // 403：路径与错误码必须原样交给页面（页面据此翻中文）
  {
    const calls = []
    const window = {
      location: { origin: 'https://admin.dev.example.com', hostname: 'admin.dev.example.com' },
      A380OAuth: { refreshContext: vi.fn() },
    }
    const context = {
      window,
      fetch: async (url) => { calls.push(String(url)); return fail(403, 'PERMISSION_DENIED', '缺少权限: order.view') },
      console: { warn() {}, error() {} }, crypto: { randomUUID: () => 'id' },
    }
    vm.runInNewContext(moneySource, context)
    vm.runInNewContext(saasSource, context)
    window.SAAS.activate()
    expect(window.SAAS.requestTimeoutMs()).toBe(window.SAAS.DEFAULT_REQUEST_TIMEOUT_MS)

    const error = await window.SAAS.listOrderItems(9).then(() => null, (e) => e)
    expect(calls[0]).toBe('https://admin.dev.example.com' + ORDER_ITEMS_URL)
    expect(error.status).toBe(403)
    expect(error.code).toBe('PERMISSION_DENIED')

    const catalogError = await window.SAAS.listCatalog({}).then(() => null, (e) => e)
    expect(calls[1]).toBe('https://admin.dev.example.com' + CATALOG_URL)
    expect(catalogError.status).toBe(403)
  }
})

// —— 源码守卫：页面确实接上了加载守卫，且不再手写「加载中…」——

test('源码守卫：我的消费相关渲染函数统一走 A380PageLoad，入口先加载 page-load.js', async () => {
  const source = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  /** 取某个函数声明到「下一个函数声明 / 下一段块注释」之间的正文（不含函数外的说明注释）。 */
  const bodyOf = (marker) => {
    const rest = source.slice(source.indexOf(marker))
    const cuts = [rest.indexOf('\n/**'), rest.indexOf('\nfunction '), rest.indexOf('\nasync function ')]
      .filter((index) => index > 0)
    return cuts.length ? rest.slice(0, Math.min(...cuts)) : rest
  }

  const orderItems = bodyOf('async function renderOrderItems')
  expect(orderItems).toContain('A380PageLoad.renderPage')
  expect(orderItems).toContain('retryRoute')
  expect(orderItems).not.toContain('加载中')      // 加载态只能由 page-load.js 出
  // 两个 await 都收进 load（守卫统一兜底），不再裸放在页面函数里
  expect(orderItems).toContain('load: async function')
  expect(orderItems).toContain('await SAAS.listOrderItems(orderId)')
  expect(orderItems).toContain('await SAAS.listCatalog({})')

  const myOrders = bodyOf('async function renderMyOrders')
  expect(myOrders).toContain('A380PageLoad.renderPage')
  expect(myOrders).not.toContain('加载中')

  const myReservations = bodyOf('async function renderMyReservations')
  expect(myReservations).toContain('A380PageLoad.renderPage')
  expect(myReservations).not.toContain('加载中')

  // 账单失败态也用同一份错误态（带重试），不再依赖 .item-list 一定存在
  const bill = bodyOf('async function renderOrderBill')
  expect(bill).toContain("A380PageLoad.errorHtml('账单加载失败'")
  expect(bill).toContain('A380PageLoad.loadingHtml')

  // 重试按钮的点击委托（同一路由重试不会被 hashchange 触发）
  expect(source).toContain("event.target.closest('[data-retry]')")
  expect(source).toContain('if (location.hash.replace(/^#\\/?/, \'\') === retryRoute) render();')

  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  expect(html).toContain('./page-load.js')
  expect(html.indexOf('page-load.js')).toBeLessThan(html.indexOf('app.js'))
})

// —— 消费账单：包厢费「怎么算出来的」必须看得懂（真实 app.js 运行，不是源码断言）——

/** 一张账单骨架：只放展示需要的字段，金额一律最小货币单位整数。 */
function billFixture(roomFee, extra = {}) {
  return Object.assign({
    status: 'WAITING_PAYMENT',
    currencyCode: 'CNY',
    roomFee,
    items: [],
    servers: [],
    promotions: [],
    subtotalAmount: roomFee ? roomFee.amount : 0,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: roomFee ? roomFee.amount : 0,
    paidAmount: 0,
    payableAmount: roomFee ? roomFee.amount : 0,
    collected: { cash: 0, wallet: 0, points: 0 },
    changeAmount: 0,
  }, extra)
}

test('账单：历史固化房费（没有结台时刻）说「时长未记录」，不用 0 分钟冒充（线上订单 72）', async () => {
  const harness = await loadCend(async () => json({}))
  harness.api.paintOrderBill(72, billFixture({
    name: '包厢费（含 1 名服务人员）', amount: 4000, unitPrice: 4000, quantity: 1,
    durationSeconds: 0, durationKnown: false, source: 'HISTORICAL', live: false,
    pausedSeconds: 0, standardSeconds: 7200, inSeconds: 0, overSeconds: 0, overtimeRate: '1.5',
    incrementMinutes: 30, planName: '门店标准价', roomUnitPrice: 4000, serverUnitPrice: 0,
    roomFeeIncludesServer: true, snapshotAt: '2026-09-20T07:22:15',
  }))

  const html = harness.app.innerHTML
  expect(html).toContain('时长未记录')
  expect(html).toContain('历史固化值')
  expect(html).not.toContain('计费 0 分钟')
  // 金额用「块数 × 每递增粒度单价 + 固化时刻」自证
  expect(html).toContain('1 个计费单位')
  expect(html).toContain('金额固化于')
  expect(html).toContain('40.00')
})

test('账单：结台固化房费展示方案 / 时长（扣暂停）/ 单价 × 块数 / 超时部分 / 已含服务人员', async () => {
  const harness = await loadCend(async () => json({}))
  harness.api.paintOrderBill(73, billFixture({
    name: '包厢费（含 1 名服务人员）', amount: 30000, unitPrice: 5000, quantity: 6,
    durationSeconds: 10800, durationKnown: true, source: 'CLOSED', live: false,
    pausedSeconds: 300, standardSeconds: 7200, inSeconds: 7200, overSeconds: 3600, overtimeRate: '1.5',
    incrementMinutes: 30, planName: '豪华大包', roomUnitPrice: 4000, serverUnitPrice: 1000,
    roomFeeIncludesServer: true, snapshotAt: '2026-09-20T12:00:00',
  }, {
    subtotalAmount: 30000, discountAmount: 2000, taxAmount: 0, totalAmount: 28000, payableAmount: 28000,
    promotions: [{ type: 'DISCOUNT', amount: 2000 }],
    items: [{ name: '果盘', unitPrice: 1800, quantity: 1, amount: 1800 }],
    servers: [{ serverName: '额外服务人员#9', durationSeconds: 3600, unitPrice: 5000, amount: 10000, quantity: 2 }],
  }))

  const html = harness.app.innerHTML
  expect(html).toContain('计费方案 豪华大包')
  expect(html).toContain('计费 3 小时')
  expect(html).toContain('已扣暂停 5 分钟')
  expect(html).toContain('6 个计费单位')
  expect(html).toContain('其中超时 1 小时')
  expect(html).toContain('标准 2 小时')
  expect(html).toContain('1.5 倍')
  expect(html).toContain('已含 1 名标准服务人员')
  // 服务人员与优惠也按服务端字段展示（数量/单价来自后端，前端不做算术）
  expect(html).toContain('额外服务人员#9')
  expect(html).toContain('优惠')
  // 金额一律取后端字段：合计 280.00 / 应收 280.00
  expect(html).toContain('280.00')
  expect(html).toContain('账单合计')
})
