import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, test, vi } from 'vitest'

/**
 * C 端币种契约（16_CURRENCY_CONVENTIONS §3/§4）：
 *  - 金额展示唯一入口 = c-end/money.js 的 formatMoney（saas.js 只转发）；
 *  - 币种唯一来源 = context select 响应 currencyCode（缺省 USD），X-Currency 只在字段缺失时兜底；
 *  - 切换币种后所有金额展示同步变化（数字不变、只改符号），已结算单据以记录快照为准。
 */

/** 只加载 money.js（唯一币种字典所在），返回模块与可控的 window。 */
async function loadMoney() {
  const source = await readFile(new URL('./money.js', import.meta.url), 'utf8')
  const events = []
  const warnings = []
  const fakeConsole = { warn: (message) => warnings.push(String(message)), log: () => {}, error: () => {} }
  const window = {
    console: fakeConsole,
    sessionStorage: null,
    dispatchEvent: (event) => events.push(event.type),
    Event: function FakeEvent(type) { this.type = type },
  }
  const context = { window, console: fakeConsole }
  vm.runInNewContext(source, context)
  return { money: window.A380Money, window, events, warnings }
}

/** 去掉注释后再断言（注释里允许说明「历史上是 ¥，现已由 money.js 统一」）。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 加载 money.js + saas.js（demo 模式），供「接口层转发」与「切币种后报价/预估」断言。 */
async function loadSaas() {
  const moneySource = await readFile(new URL('./money.js', import.meta.url), 'utf8')
  const saasSource = await readFile(new URL('./saas.js', import.meta.url), 'utf8')
  const window = {
    location: { origin: 'http://localhost:5175', hostname: 'localhost', port: '5175', search: '?preview=1' },
    A380OAuth: { refreshContext: vi.fn() },
    SAAS_DEMO_MODE: true,
  }
  const context = {
    window,
    fetch: vi.fn().mockRejectedValue(new Error('demo 模式不应发请求')),
    console,
    URLSearchParams,
    crypto: { randomUUID: () => 'request-id' },
  }
  vm.runInNewContext(moneySource, context)
  vm.runInNewContext(saasSource, context)
  return { saas: window.SAAS, money: window.A380Money }
}

test('formatMoney：CNY/USD、0、负数、大额千分位与无效值', async () => {
  const { money } = await loadMoney()

  expect(money.formatMoney(12345, 'CNY')).toBe('¥123.45')
  expect(money.formatMoney(12345, 'USD')).toBe('$123.45')
  expect(money.formatMoney(0, 'CNY')).toBe('¥0.00')
  expect(money.formatMoney(0, 'USD')).toBe('$0.00')
  expect(money.formatMoney(-500, 'CNY')).toBe('-¥5.00')
  expect(money.formatMoney(-500, 'USD')).toBe('-$5.00')
  expect(money.formatMoney(123456789, 'CNY')).toBe('¥1,234,567.89')
  expect(money.formatMoney('888000', 'USD')).toBe('$8,880.00')
  // 三端展示格式一致（后台 / App / 本仓库）：符号紧跟数字，金额内不得出现空格
  expect(money.formatMoney(123456, 'CNY')).toBe('¥1,234.56')
  expect(money.formatMoney(123456, 'CNY')).not.toMatch(/\s/)
  expect(money.formatMoney(123456, 'USD')).not.toMatch(/\s/)
  // 无效/缺失金额：展示占位符，不得拼出 '¥NaN'
  expect(money.formatMoney(null, 'CNY')).toBe('—')
  expect(money.formatMoney(undefined, 'CNY')).toBe('—')
  expect(money.formatMoney('abc', 'CNY')).toBe('—')
  // 币种名称来自 label（不展示裸币种码）
  expect(money.currencyLabel('CNY')).toBe('人民币')
  expect(money.currencyLabel('USD')).toBe('美元')
})

test('未知币种回退当前币种并 warn（不得整页报错）', async () => {
  const { money, warnings } = await loadMoney()
  money.setCurrency('CNY')

  expect(money.formatMoney(12345, 'HKD')).toBe('¥123.45')
  expect(money.formatMoney(12345, 'RMB')).toBe('¥123.45')
  expect(money.currencyLabel('EUR')).toBe('人民币')
  expect(warnings.length).toBeGreaterThanOrEqual(3)
  expect(warnings.join('\n')).toContain('HKD')

  // 非法 setCurrency 不得改币种
  money.setCurrency('JPY')
  expect(money.getCurrency()).toBe('CNY')
})

test('默认币种 USD；setCurrency 切换后通知页面重渲染，未知值不改币种', async () => {
  const { money, events } = await loadMoney()

  expect(money.DEFAULT_CURRENCY).toBe('USD')
  expect(money.SUPPORTED_CURRENCIES).toEqual(['CNY', 'USD'])
  expect(money.getCurrency()).toBe('USD')
  expect(money.formatMoney(12345)).toBe('$123.45')

  expect(money.setCurrency('CNY')).toBe('CNY')
  expect(events).toEqual(['currency-changed'])
  expect(money.formatMoney(12345)).toBe('¥123.45')

  // 同值不重复派发（避免无意义的整页重渲染）
  money.setCurrency('CNY')
  expect(events).toEqual(['currency-changed'])

  // 未知值：保持 CNY 且不再派发
  money.setCurrency('XYZ')
  expect(money.getCurrency()).toBe('CNY')
  expect(events).toEqual(['currency-changed'])
})

test('币种来源：响应体 currencyCode 优先，X-Currency 只在缺失时兜底，都没有则保持当前', async () => {
  const { money } = await loadMoney()
  const header = (value) => ({ headers: { get: (name) => (name.toLowerCase() === 'x-currency' ? value : null) } })

  expect(money.applyResponseCurrency({ currencyCode: 'CNY' }, header('USD'))).toBe('CNY')
  expect(money.getCurrency()).toBe('CNY')

  // 响应体缺字段（老接口）→ 用网关头兜底
  expect(money.applyResponseCurrency({ contextId: 7 }, header('USD'))).toBe('USD')
  // 包装体 { data: { currencyCode } } 同样识别
  expect(money.applyResponseCurrency({ data: { currencyCode: 'CNY' } }, null)).toBe('CNY')
  // 都没有 → 不覆盖已选币种（不能被老接口打回默认）
  expect(money.applyResponseCurrency({ contextId: 7 }, null)).toBe('CNY')
  // 响应头是普通对象（大小写不敏感）也能读
  expect(money.applyResponseCurrency({}, { headers: { 'x-currency': 'USD' } })).toBe('USD')
})

test('saas.js 只转发 money.js：不重复实现换算与符号表', async () => {
  const { saas, money } = await loadSaas()

  saas.setCurrency('CNY')
  expect(saas.getCurrency()).toBe('CNY')
  expect(saas.formatMoney(12345)).toBe(money.formatMoney(12345))
  expect(saas.formatFen(12345)).toBe('¥123.45')
  expect(saas.formatYuan(368)).toBe('¥368.00')
  expect(saas.fenToYuan('888000')).toBe(8880)
  expect(saas.yuanToFen('12.34')).toBe(1234)
  expect(saas.currencyLabel()).toBe('人民币')

  const source = await readFile(new URL('./saas.js', import.meta.url), 'utf8')
  expect(source).not.toContain('CURRENCY_SYMBOLS')
})

test('切币种后 C 端报价与预估同步变化（金额数字不变，只改符号）', async () => {
  const { saas } = await loadSaas()
  const pricing = { billingUnit: 'HOUR', roomUnitPrice: 18800, serverUnitPrice: 5000, combinedUnitPrice: 23800 }

  saas.setCurrency('CNY')
  expect(saas.formatKtvRoomPrice(pricing)).toBe('¥238.00/小时')
  expect(saas.formatKtvRoomPriceLabel(pricing)).toBe('¥238.00/小时')
  expect(saas.formatKtvRoomPriceBreakdown(pricing))
    .toBe('房型 ¥188.00/小时 + 服务 ¥50.00/小时 = ¥238.00/小时（含 1 名服务人员）')
  const estimate = saas.estimateKtvRoomFee(pricing, 3)
  expect(estimate).toBe(71400)
  expect(saas.formatFen(estimate)).toBe('¥714.00')

  saas.setCurrency('USD')
  expect(saas.formatKtvRoomPrice(pricing)).toBe('$238.00/小时')
  expect(saas.formatKtvRoomPriceLabel(pricing)).toBe('$238.00/小时')
  expect(saas.formatKtvRoomPriceBreakdown(pricing))
    .toBe('房型 $188.00/小时 + 服务 $50.00/小时 = $238.00/小时（含 1 名服务人员）')
  // 金额数字不因切币种变化（无汇率换算）
  expect(saas.estimateKtvRoomFee(pricing, 3)).toBe(estimate)
  expect(saas.formatFen(estimate)).toBe('$714.00')
})

/** 同一页只允许出现一种符号：后端 displayText 是按当时币种拼好的串，不得直接展示。 */
test('报价文案不使用后端 displayText（避免同页两种符号 / 切币种不跟随）', async () => {
  const { saas } = await loadSaas()
  saas.setCurrency('CNY')

  const pricing = {
    billingUnit: 'HOUR', roomUnitPrice: 23800, combinedUnitPrice: 23800,
    displayText: '$238.00/小时 · 30 分钟递增 · 每 30 分钟 $119.00 · 标准 2.0 小时',
  }
  expect(saas.formatKtvRoomPrice(pricing)).toBe('¥238.00/小时')
  expect(saas.formatKtvRoomPriceLabel(pricing)).toBe('¥238.00/小时')

  // 取价结果里不再保留 displayText（结构化字段才是唯一数据源）
  const normalized = await saas.resolveKtvRoomPricing([{ id: 1, roomTypeCode: 'MID', roomTypeUnitPrice: 23800 }])
  expect(normalized[1].displayText).toBeUndefined()

  const appSource = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  expect(stripComments(appSource)).not.toContain('displayText')
})

/** 储值/积分是「代币」，与币种解耦：品牌名只来自租户配置，金额才带币种符号。 */
test('C 端金币/钱包术语与币种解耦（品牌名不是币种符号）', async () => {
  const { saas } = await loadSaas()

  expect(saas.DEFAULT_WALLET_BRAND).toBe('A380币')
  expect(saas.DEFAULT_WALLET_BRAND).not.toMatch(/[¥$￥]/)

  const wallet = await saas.getWallet()
  saas.setCurrency('USD')
  // availableAmount 是账户快照里的**金额**字段（最小货币单位，对账口径），它本身带币种符号；
  // 页面展示的是代币**数量**（formatTokens）：储值币不带币种、不拼品牌名，数量与币种解耦。
  expect(saas.formatFen(wallet.availableAmount, wallet.currencyCode)).toBe('$8,880.00')
  expect(saas.formatTokens(wallet.tokenAmount)).toBe('888,000')
  expect(saas.formatTokens(wallet.tokenAmount)).not.toMatch(/[¥$￥元]|A380币/)

  // 积分是积分个数，不是钱：不经过 formatMoney，也不带「积分」单位
  const points = await saas.getPoints()
  expect(Number(points.balance).toLocaleString('zh-CN')).toBe('12,680')
  expect(saas.formatPoints(points.balance)).toBe('12,680')
})

/** 已结算单据锁定币种快照：账单自带 currencyCode 时以记录为准，不被全局设置改写。 */
test('已结算单据以记录币种为准（快照优先）', async () => {
  const { saas } = await loadSaas()
  saas.setCurrency('USD')

  const bill = { currencyCode: 'CNY', totalAmount: 23800, paidAmount: 0 }
  expect(saas.formatFen(bill.totalAmount, bill.currencyCode)).toBe('¥238.00')

  const appSource = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  expect(appSource).toContain('bill.currencyCode')
})
