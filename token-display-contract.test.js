import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'
import { expect, test, vi } from 'vitest'
import {
  DEFAULT_TOKEN_BRAND,
  DEFAULT_TOKEN_RATIO,
  formatMoney,
  formatPoints,
  formatTokens,
  isTokenMethod,
  legInputExceedsAvailable,
  legInputPrecision,
  legInputStep,
  legInputToMinor,
  legMinorToInput,
  paymentTotals,
  tokenCountFromMinor,
  tokenRatio,
  tokensToMinor,
} from './src/shared/utils/money'

/**
 * 储值币（A380币）/ 积分展示契约：
 *
 * **储值币与积分不是货币**——它们只是组合支付里的一种支付工具（储值币 / 营销币）：
 *  1) 界面只显示**数量**，**不得出现货币符号或币种**（只有现金与价格才带货币单位，现金默认 USD）；
 *  2) 数量是**裸数字**：既不拼品牌名，也不拼「积分」「个」这类单位——名字由支付方式、列头、
 *     卡片标题与字段标签承担；
 *  3) 唯一展示入口 = `formatTokens` / `formatPoints`，**禁止**对代币/积分调用 formatMoney；
 *  4) 数量 = 余额（最小货币单位）÷ 100 × 租户比例 `wallet_ratio`（默认 100，语义「1 主单位 = N 代币」）；
 *     积分就是个数（1:1，不换算）。换算只允许在 money.js 的 `tokenCountFromMinor` 内部。
 *  5) 服务端 `tokenAmount` 存在时**以服务端值为准**；未发布时用租户配置比例在前端按同一公式换算，
 *     比例缺失回退默认 100 且不报错。
 */

const repoRoot = fileURLToPath(new URL('.', import.meta.url))
const readRepo = (relative) => readFile(path.join(repoRoot, relative), 'utf8')

/** 去掉注释后再做源码守卫（注释里允许解释「历史上把储值币当钱渲染」）。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 只加载 c-end/money.js（window.A380Money），断言 C 端口径。 */
async function loadCEndMoney() {
  const source = await readRepo('c-end/money.js')
  const window = { console: { warn: () => {}, log: () => {}, error: () => {} }, sessionStorage: null }
  vm.runInNewContext(source, { window, console: window.console })
  return window.A380Money
}

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data }
}

/** 加载 money.js + saas.js（live 模式，fetch 可控），断言接口层的字段透传与降级。 */
async function loadCEndSaas(fetch) {
  const [moneySource, source] = await Promise.all([readRepo('c-end/money.js'), readRepo('c-end/saas.js')])
  const warnings = []
  const fakeConsole = { warn: (message) => warnings.push(String(message)), log: () => {}, error: () => {} }
  const window = {
    location: { origin: 'https://admin.dev.example.com', hostname: 'admin.dev.example.com' },
    A380OAuth: { refreshContext: vi.fn() },
  }
  const context = { window, fetch, console: fakeConsole, crypto: { randomUUID: () => 'request-id' } }
  vm.runInNewContext(moneySource, context)
  vm.runInNewContext(source, context)
  window.SAAS.activate()
  return { saas: window.SAAS, warnings }
}

/** demo 模式（本地预览）加载，走 mock 数据分支。 */
async function loadCEndSaasDemo() {
  const [moneySource, source] = await Promise.all([readRepo('c-end/money.js'), readRepo('c-end/saas.js')])
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
  vm.runInNewContext(source, context)
  return window.SAAS
}

/** 代币/积分展示文本里**绝不允许**出现的货币痕迹。 */
const CURRENCY_TRACE = /[¥￥$€]|\bCNY\b|\bUSD\b|\bRMB\b|元/
/** 代币/积分展示文本里**绝不允许**出现的单位（品牌名 / 「积分」/「个」）。 */
const UNIT_TRACE = /欢乐币|A380币|储值币|积分|个/

// —— 1. formatTokens / formatPoints：数量口径、千分位、无货币符号、无单位 ——

test('formatTokens：只出数量（千分位、0、大额、负数、无效值），不带品牌名', () => {
  expect(formatTokens(1000)).toBe('1,000')
  expect(formatTokens('1000')).toBe('1,000')
  expect(formatTokens(0)).toBe('0')
  expect(formatTokens(300)).toBe('300')
  expect(formatTokens(1234567)).toBe('1,234,567')
  expect(formatTokens(999999999)).toBe('999,999,999')
  // 负数（账本冲正）：符号在最前
  expect(formatTokens(-1000)).toBe('-1,000')
  // 无效/缺失数量：占位符，不得拼出「NaN 欢乐币」
  expect(formatTokens(null)).toBe('—')
  expect(formatTokens(undefined)).toBe('—')
  expect(formatTokens('abc')).toBe('—')
})

test('品牌名不再是 formatTokens 的参数：值里不出现它，品牌名只留给标签', () => {
  expect(formatTokens).toHaveLength(1)
  expect(formatPoints).toHaveLength(1)
  // 默认品牌名仍存在（页面把它当**标签**用），但它不是币种、也不会出现在值里
  expect(DEFAULT_TOKEN_BRAND).toBe('储值币')
  expect(DEFAULT_TOKEN_BRAND).not.toMatch(CURRENCY_TRACE)
  expect(formatTokens(1000)).not.toContain(DEFAULT_TOKEN_BRAND)
})

test('formatPoints：积分就是个数（1:1，不换算），只出数量、不带「积分」单位', () => {
  expect(formatPoints(300)).toBe('300')
  expect(formatPoints(0)).toBe('0')
  expect(formatPoints('12680')).toBe('12,680')
  expect(formatPoints(1234567)).toBe('1,234,567')
  expect(formatPoints(-500)).toBe('-500')
  expect(formatPoints(null)).toBe('—')
  expect(formatPoints('abc')).toBe('—')
})

test('代币/积分展示文本绝不出现货币符号、币种码、「元」与任何单位', () => {
  const tokenTexts = [
    formatTokens(0), formatTokens(1000), formatTokens(1234567),
    formatTokens(-888000), formatTokens(1000), formatTokens(null),
  ]
  const pointTexts = [formatPoints(0), formatPoints(300), formatPoints(12680), formatPoints(null)]

  for (const text of [...tokenTexts, ...pointTexts]) {
    expect(text, text).not.toMatch(CURRENCY_TRACE)
    expect(text, text).not.toMatch(UNIT_TRACE)
    // 也不允许出现小数（数量是个数，不是金额）
    expect(text, text).not.toMatch(/[，,]?\d+\.\d+/)
  }
  // 对照：同一个数字走 formatMoney 才带货币符号；代币 / 积分口径只给数量
  expect(formatMoney(100000, 'USD')).toBe('$1,000.00')
  expect(formatTokens(100000)).toBe('100,000')
  expect(formatPoints(100000)).toBe('100,000')
})

// —— 2. 数量换算：余额 ÷ 100 × 比例（默认 100，缺失/非法不报错） ——

test('tokenCountFromMinor：余额 ÷ 100 × 租户比例，取整；比例缺失/非法回退默认 100', () => {
  expect(DEFAULT_TOKEN_RATIO).toBe(100)
  // 比例 100（默认）：数量 = 余额 ÷ 100 × 100 = 余额
  expect(tokenCountFromMinor(888000, 100)).toBe(888000)
  expect(tokenCountFromMinor('10000', 100)).toBe(10000)
  // 比例 10（1 主单位 = 10 代币）：10000 分 = 100 主单位 => 1000 代币
  expect(tokenCountFromMinor(10000, 10)).toBe(1000)
  expect(tokenCountFromMinor(10000, '10')).toBe(1000)
  // 比例缺失 / 非法 / 非正数：一律按默认 100 处理，不抛错
  expect(tokenCountFromMinor(10000)).toBe(10000)
  expect(tokenCountFromMinor(10000, null)).toBe(10000)
  expect(tokenCountFromMinor(10000, '')).toBe(10000)
  expect(tokenCountFromMinor(10000, 'abc')).toBe(10000)
  expect(tokenCountFromMinor(10000, 0)).toBe(10000)
  expect(tokenCountFromMinor(10000, -5)).toBe(10000)
  expect(tokenCountFromMinor(10000, NaN)).toBe(10000)
  // 取整：不足一个代币的部分四舍五入（999 分 = 9.99 主单位，比例 1 => 10）
  expect(tokenCountFromMinor(999, 1)).toBe(10)
  expect(tokenCountFromMinor(50, 10)).toBe(5)
  // 无效余额：0，不抛错
  expect(tokenCountFromMinor(null)).toBe(0)
  expect(tokenCountFromMinor('abc', 100)).toBe(0)

  expect(tokenRatio(undefined)).toBe(DEFAULT_TOKEN_RATIO)
  expect(tokenRatio('20')).toBe(20)
  expect(tokenRatio(0)).toBe(DEFAULT_TOKEN_RATIO)
})

// —— 3. 组合支付：金额合计 == 现金类分腿之和，代币/积分数量不计入 ——

test('paymentTotals：金额合计只由现金类分腿构成，代币/积分数量不计入', () => {
  const legs = [
    { method: 'CASH', amount: 5000 },
    { method: 'ALIPAY', amount: 2000 },
    { method: 'WALLET', amount: 3000 },
    { method: 'POINT', amount: 100 },
  ]
  const totals = paymentTotals(legs)

  expect(totals.moneyMinor).toBe(7000)
  // 代币 / 积分数量单独返回，绝不并进金额合计（否则会算成 10100）
  expect(totals.moneyMinor).not.toBe(10100)
  expect(totals.tokenCount).toBe(3000)
  expect(totals.pointCount).toBe(100)
  expect(totals.tokenCount + totals.pointCount).toBe(3100)

  // 服务端给了代币数量（tokenAmount）时以它为准，金额分腿不受影响
  const withServerTokenAmount = paymentTotals([
    { method: 'CASH', amount: 5000 },
    { method: 'WALLET', amount: 3000, tokenAmount: 300 },
    { method: 'POINT', amount: 100, tokenAmount: 100 },
  ])
  expect(withServerTokenAmount.moneyMinor).toBe(5000)
  expect(withServerTokenAmount.tokenCount).toBe(300)
  expect(withServerTokenAmount.pointCount).toBe(100)

  // 只有现金类分腿时合计就是它们的和；支付方式缺失（老接口）按现金类处理，不漏算
  expect(paymentTotals([{ method: 'CASH', amount: 1200 }, { amount: 800 }]).moneyMinor).toBe(2000)
  expect(paymentTotals([]).moneyMinor).toBe(0)
  expect(paymentTotals(null).moneyMinor).toBe(0)
  expect(paymentTotals([]).tokenCount).toBe(0)

  expect(isTokenMethod('WALLET')).toBe(true)
  expect(isTokenMethod('point')).toBe(true)
  expect(isTokenMethod('CASH')).toBe(false)
  expect(isTokenMethod('ALIPAY')).toBe(false)
})

// —— 4. C 端与 B 端同一份口径（逐字一致） ——

test('C 端 money.js 与 B 端 money.js 代币/积分口径逐字一致', async () => {
  const cEnd = await loadCEndMoney()
  const counts = [0, 1000, 1234567, -888000, null]

  for (const count of counts) {
    expect(cEnd.formatTokens(count), String(count)).toBe(formatTokens(count))
  }
  for (const count of [0, 300, 12680, 1234567, -500, null]) {
    expect(cEnd.formatPoints(count), String(count)).toBe(formatPoints(count))
  }
  for (const [minor, ratio] of [[888000, 100], [10000, 10], [999, 1], [10000, undefined], [10000, 'abc']]) {
    expect(cEnd.tokenCountFromMinor(minor, ratio), `${minor}/${ratio}`).toBe(tokenCountFromMinor(minor, ratio))
  }
  const legs = [{ method: 'CASH', amount: 5000 }, { method: 'WALLET', amount: 3000 }, { method: 'POINT', amount: 100 }]
  expect(cEnd.paymentTotals(legs)).toEqual(paymentTotals(legs))
  expect(cEnd.isTokenMethod('WALLET')).toBe(isTokenMethod('WALLET'))
  expect(cEnd.DEFAULT_TOKEN_BRAND).toBe(DEFAULT_TOKEN_BRAND)
  expect(cEnd.DEFAULT_TOKEN_RATIO).toBe(DEFAULT_TOKEN_RATIO)
  // 组合支付分腿输入口径（数量腿 <-> 金额）两侧也必须逐字一致
  for (const [method, value, ratio] of [['WALLET', 1000, 100], ['WALLET', 1000, 50], ['POINT', 300, 50], ['CASH', '12.34', 50]]) {
    expect(cEnd.legInputToMinor(method, value, ratio), `${method}/${value}/${ratio}`)
      .toBe(legInputToMinor(method, value, ratio))
  }
  expect(cEnd.legMinorToInput('WALLET', 2000, 50)).toBe(legMinorToInput('WALLET', 2000, 50))
  expect(cEnd.legInputExceedsAvailable('WALLET', 1000, 1500, 50)).toBe(legInputExceedsAvailable('WALLET', 1000, 1500, 50))
  expect(cEnd.legInputPrecision('WALLET')).toBe(legInputPrecision('WALLET'))
  expect(cEnd.legInputStep('WALLET')).toBe(legInputStep('WALLET'))
})

// —— 5. 降级：服务端未发布 tokenAmount 时按租户比例换算，比例缺失用默认 100 ——

test('服务端未发布 tokenAmount：按租户比例在前端换算（字段存在时以服务端值为准）', async () => {
  const fetch = vi.fn().mockImplementation(async (url) => {
    const target = String(url)
    if (target.includes('/admin/tenant/config')) return jsonResponse({ brandName: '欢乐币', ratio: 10 })
    if (target.includes('/me/wallet/ledger')) {
      return jsonResponse([{ entryType: 'RECHARGE', amount: '200000', occurredAt: '2026-09-01T10:00:00' }])
    }
    if (target.includes('/me/wallet')) return jsonResponse({ availableAmount: '10000', frozenAmount: '0', currencyCode: 'USD' })
    if (target.includes('/me/points')) return jsonResponse({ account: { availablePoints: '12680' } })
    return jsonResponse({})
  })
  const { saas } = await loadCEndSaas(fetch)

  const wallet = await saas.getWallet()
  // 10000 分 = 100 主单位 × 比例 10 = 1000 欢乐币
  expect(wallet.tokenAmount).toBe('1000')
  expect(wallet.tokenBrandName).toBe('欢乐币')
  expect(saas.formatTokens(wallet.tokenAmount)).toBe('1,000')
  // 用于对账的金额口径原样保留，不被数量换算覆盖
  expect(wallet.availableAmount).toBe('10000')
  expect(wallet.currencyCode).toBe('USD')

  // 账本行同样按数量口径补齐
  const ledger = await saas.getWalletLedger()
  expect(ledger[0].tokenAmount).toBe('20000')
  expect(ledger[0].amount).toBe('200000')

  // 积分 1:1，不换算、不带货币符号
  const points = await saas.getPoints()
  expect(points.balance).toBe('12680')
  expect(saas.formatPoints(points.balance)).toBe('12,680')

  // 租户配置全站只读一次（钱包 + 账本 + 显式读取共用同一份缓存）
  const configCalls = fetch.mock.calls.filter(([url]) => String(url).includes('/admin/tenant/config'))
  expect(configCalls).toHaveLength(1)
  const config = await saas.getWalletTokenConfig()
  expect(config).toEqual({ brandName: '欢乐币', ratio: 10 })
})

test('服务端已发布 tokenAmount：以服务端值为准（前端不再自行换算）', async () => {
  const fetch = vi.fn().mockImplementation(async (url) => {
    const target = String(url)
    if (target.includes('/admin/tenant/config')) return jsonResponse({ brandName: '欢乐币', ratio: 100 })
    // 故意让前端换算结果（10000）与服务端值不同：必须取服务端值
    return jsonResponse({ availableAmount: '10000', frozenAmount: '0', tokenAmount: '777', tokenBrandName: 'A380币' })
  })
  const { saas } = await loadCEndSaas(fetch)

  const wallet = await saas.getWallet()
  expect(wallet.tokenAmount).toBe('777')
  expect(wallet.tokenAmount).not.toBe('10000')
  expect(wallet.tokenBrandName).toBe('A380币')
  expect(saas.formatTokens(wallet.tokenAmount)).toBe('777')
})

test('租户比例缺失/配置读不到：回退默认 100 且不报错（页照常显示数量）', async () => {
  // 配置里没有 ratio（老租户配置）
  const missingRatio = vi.fn().mockImplementation(async (url) => {
    const target = String(url)
    if (target.includes('/admin/tenant/config')) return jsonResponse({ brandName: '欢乐币' })
    return jsonResponse({ availableAmount: '10000', frozenAmount: '0' })
  })
  const first = await loadCEndSaas(missingRatio)
  const walletA = await first.saas.getWallet()
  expect(walletA.tokenAmount).toBe('10000')
  expect(walletA.tokenBrandName).toBe('欢乐币')

  // 配置接口直接失败（服务端还没上线该接口）
  const failing = vi.fn().mockImplementation(async (url) => {
    const target = String(url)
    if (target.includes('/admin/tenant/config')) return { ok: false, status: 500, text: async () => '{"code":"BOOM"}' }
    return jsonResponse({ availableAmount: '10000', frozenAmount: '0' })
  })
  const second = await loadCEndSaas(failing)
  const walletB = await second.saas.getWallet()
  expect(walletB.tokenAmount).toBe('10000')
  expect(walletB.tokenBrandName).toBe('A380币')
  expect(second.warnings.join('\n')).toContain('租户储值配置不可读')
  await expect(second.saas.getWalletTokenConfig()).resolves.toEqual({ brandName: 'A380币', ratio: 100 })
})

test('demo 模式钱包 mock 也走数量口径（金额字段保留 + 数量由比例算出）', async () => {
  const saas = await loadCEndSaasDemo()

  const wallet = await saas.getWallet()
  expect(wallet.availableAmount).toBe('888000')
  expect(wallet.tokenAmount).toBe('888000')
  expect(wallet.tokenBrandName).toBe('A380币')
  expect(saas.formatTokens(wallet.tokenAmount)).toBe('888,000')
  expect(saas.formatTokens(wallet.tokenAmount)).not.toMatch(CURRENCY_TRACE)

  const points = await saas.getPoints()
  expect(saas.formatPoints(points.balance)).toBe('12,680')
})

// —— 6. 源码守卫：钱包/积分展示不得套货币格式 ——

test('源码守卫：C 端钱包余额/账本/我的资产不得对代币/积分调用 formatMoney', async () => {
  const app = stripComments(await readRepo('c-end/app.js'))

  // 曾经的缺陷：formatFen(w.availableAmount, w.currencyCode) → 渲染成「$8,880.00」
  expect(app).not.toContain('formatFen(w.availableAmount')
  expect(app).not.toContain('formatMoney(w.availableAmount')
  expect(app).not.toMatch(/format(Fen|Money)\(\s*[a-zA-Z]+\.(availableAmount|frozenAmount|balance)/)
  expect(app).not.toMatch(/minorMoney\(\s*[a-zA-Z]+\.(availableAmount|frozenAmount|balance)/)
  // 积分余额也不得再套货币格式 / 裸 toLocaleString
  expect(app).not.toMatch(/format(Fen|Money)\([^)]*points/)
  expect(app).not.toMatch(/toLocaleString\([^)]*\)[\s\S]{0,40}format(Fen|Money)/)

  // 代币 / 积分一律走数量入口
  expect(app).toContain('SAAS.formatTokens(')
  expect(app).toContain('SAAS.formatPoints(')
  expect(app).toContain('walletTokenText(')
  expect(app).toContain('SAAS.tokenCountFromMinor(')
  expect(app).toContain('#wallet-coin')
  expect(app).toContain('#wallet-points')
  expect(app).toContain('#my-wallet-coin')
  expect(app).toContain('#my-wallet-points')
})

test('源码守卫：B 端会员钱包/已收储值/抵扣提示不得对代币/积分调用 formatMoney', async () => {
  const orders = stripComments(await readRepo('src/b-end/views/Orders.vue'))

  expect(orders).not.toContain('formatMoney(memberWalletMinor)')
  expect(orders).not.toContain('formatMoney(orderBill(order).collected.wallet)')
  expect(orders).not.toMatch(/formatMoney\([^)]*memberPoints/)
  expect(orders).not.toMatch(/formatMoney\([^)]*walletTokens/)
  // 代币 / 积分走数量入口，且金额合计只算现金类分腿
  expect(orders).toContain('formatTokens(memberWalletTokens)')
  expect(orders).toContain('formatPoints(memberPoints)')
  expect(orders).toContain('formatTokens(orderBill(order).collected.walletTokens)')
  expect(orders).toContain('paymentTotals(')
  expect(orders).toContain('cashLegsMinor')
  expect(orders).toContain('tokenCountFromMinor(')
})

test('源码守卫：C 端接口层透传 tokenAmount / tokenBrandName 并只用一处换算函数', async () => {
  const saas = stripComments(await readRepo('c-end/saas.js'))

  expect(saas).toContain('tokenAmount')
  expect(saas).toContain('tokenBrandName')
  // 换算只允许调用 money.js 的纯函数，接口层不得自己写 ÷100 × 比例
  expect(saas).toContain('money().tokenCountFromMinor(')
  expect(saas).not.toMatch(/\/\s*100/)
  // 展示统一转发 money.js（本文件不得自建品牌回退或符号表）
  expect(saas).toContain('money().formatTokens(')
  expect(saas).toContain('money().formatPoints(')
})

// —— 7. 组合支付分腿「数量输入」口径（与后台 gv_saas_admin payment-methods 对齐） ——
// 现金 / 线上腿填**金额**（主单位），储值币 / 积分腿填**数量**（个数）；
// 提交给服务端的 `payments[].amount` 恒为最小货币单位整数（收款 wire contract 不变）。

test('数量输入 -> 提交金额 == round(数量 ÷ ratio × 100)（ratio=100 与 ratio=50 两组）', () => {
  // ratio = 100（默认语义「1 主单位 = 100 代币」）：1000 个 = 10.00 => 1000 分
  expect(legInputToMinor('WALLET', 1000, 100)).toBe(1000)
  expect(legInputToMinor('WALLET', '1000', 100)).toBe(1000)
  expect(legInputToMinor('WALLET', 1000)).toBe(1000) // ratio 缺失按默认 100
  // ratio = 50（1 主单位 = 50 代币）：1000 个 = 20.00 => 2000 分
  expect(legInputToMinor('WALLET', 1000, 50)).toBe(2000)
  expect(legInputToMinor('WALLET', 500, 50)).toBe(1000)
  expect(legInputToMinor('WALLET', 1, 50)).toBe(2)
  // 与题面公式同源：round(数量 ÷ ratio × 100)（含除不尽时的四舍五入）
  for (const [qty, ratio] of [[1000, 100], [1000, 50], [333, 3], [7, 7], [1, 3], [999, 7]]) {
    expect(legInputToMinor('WALLET', qty, ratio), `${qty}/${ratio}`).toBe(Math.round(qty / ratio * 100))
  }
  // 积分是 1:1 的个数：提交金额就等于个数，**不乘比例**
  expect(legInputToMinor('POINT', 300, 100)).toBe(300)
  expect(legInputToMinor('POINT', 300, 50)).toBe(300)
  expect(legInputToMinor('POINT', '300', 3)).toBe(300)
  // 现金 / 线上腿仍是主单位金额 -> 最小货币单位
  expect(legInputToMinor('CASH', '12.34', 50)).toBe(1234)
  expect(legInputToMinor('ALIPAY', 100, 50)).toBe(10000)
  // 数量腿折回金额走同一个 tokensToMinor 入口（不新增第二套换算）
  for (const [qty, ratio] of [[1000, 100], [1000, 50], [500, 50], [1, 3]]) {
    expect(legInputToMinor('WALLET', qty, ratio), `${qty}/${ratio}`).toBe(tokensToMinor(qty, ratio))
  }

  // 自动抵扣回填：可用金额 -> 输入数量
  expect(legMinorToInput('WALLET', 2000, 50)).toBe(1000)
  expect(legMinorToInput('WALLET', 1000, 100)).toBe(1000)
  expect(legMinorToInput('POINT', 300, 50)).toBe(300)
  expect(legMinorToInput('CASH', 1234, 50)).toBe(12.34)
  // 往返稳定：数量 -> 金额 -> 数量不失真
  for (const [qty, ratio] of [[1000, 100], [1000, 50], [250, 50], [3, 3]]) {
    expect(legMinorToInput('WALLET', legInputToMinor('WALLET', qty, ratio), ratio), `${qty}/${ratio}`).toBe(qty)
  }
})

test('数量超过可用时被拒（ratio=100 与 ratio=50 两组，空输入不算超用）', () => {
  // 储值余额 8,880.00 => 888000 分；ratio=100 时可用数量 888000 个
  expect(legInputExceedsAvailable('WALLET', 888000, 888000, 100)).toBe(false)
  expect(legInputExceedsAvailable('WALLET', 888001, 888000, 100)).toBe(true)
  // ratio=50：可用 888000 分 => 数量上限 444000 个
  expect(legInputExceedsAvailable('WALLET', 444000, 888000, 50)).toBe(false)
  expect(legInputExceedsAvailable('WALLET', 444001, 888000, 50)).toBe(true)
  // 积分可用 300 个（1:1，与比例无关）
  expect(legInputExceedsAvailable('POINT', 300, 300, 100)).toBe(false)
  expect(legInputExceedsAvailable('POINT', 301, 300, 100)).toBe(true)
  expect(legInputExceedsAvailable('POINT', 301, 300, 50)).toBe(true)
  // 空输入 / 0 不算超用；无可用（0 / 缺失 / 非法）时任何正数都被拒
  expect(legInputExceedsAvailable('WALLET', 0, 888000, 100)).toBe(false)
  expect(legInputExceedsAvailable('WALLET', '', 888000, 100)).toBe(false)
  expect(legInputExceedsAvailable('WALLET', null, 888000, 100)).toBe(false)
  expect(legInputExceedsAvailable('WALLET', 1, 0, 100)).toBe(true)
  expect(legInputExceedsAvailable('WALLET', 1, null, 100)).toBe(true)
  expect(legInputExceedsAvailable('WALLET', 1, 'abc', 100)).toBe(true)
})

test('数量腿按数量输入（precision 0 / 整数步进），金额腿仍是金额（precision 2）', () => {
  expect(legInputPrecision('WALLET')).toBe(0)
  expect(legInputPrecision('POINT')).toBe(0)
  expect(legInputPrecision('CASH')).toBe(2)
  expect(legInputPrecision('ALIPAY')).toBe(2)
  expect(legInputStep('WALLET')).toBe(1)
  expect(legInputStep('POINT')).toBe(1)
  expect(legInputStep('CASH')).toBe(0.01)
  // 小数个数会被折成整数（避免输入框里留下「1.5 个」）
  expect(legInputToMinor('WALLET', 1.5, 100)).toBe(2)
  expect(legInputToMinor('POINT', 1.5, 100)).toBe(2)
  expect(legMinorToInput('POINT', 2.4, 100)).toBe(2)
})

test('组合支付按数量输入后：paymentTotals 的金额合计仍不含代币 / 积分数量', () => {
  // 与收银台一致的构造：数量腿的 amount = 折算后的金额，tokenAmount = 输入的数量
  const legs = [
    { method: 'CASH', amount: legInputToMinor('CASH', 30, 50) },
    { method: 'WALLET', amount: legInputToMinor('WALLET', 1000, 50), tokenAmount: 1000 },
    { method: 'POINT', amount: legInputToMinor('POINT', 300, 50), tokenAmount: 300 },
  ]
  const totals = paymentTotals(legs)

  expect(totals.moneyMinor).toBe(3000) // 只有现金类分腿
  expect(totals.moneyMinor).not.toBe(3000 + 2000 + 300)
  expect(totals.tokenCount).toBe(1000)
  expect(totals.pointCount).toBe(300)

  // 「合计 = 应收」仍是金额口径：所有分腿折算后的金额之和
  const filledMinor = legs.reduce((sum, leg) => sum + leg.amount, 0)
  expect(filledMinor).toBe(3000 + 2000 + 300)
  expect(filledMinor).toBe(totals.moneyMinor + legInputToMinor('WALLET', totals.tokenCount, 50) + totals.pointCount)
})

test('源码守卫：两端收银台代币腿输入框按数量（（个）、整数步进、无货币符号）且超用被拒', async () => {
  const app = stripComments(await readRepo('c-end/app.js'))
  const orders = stripComments(await readRepo('src/b-end/views/Orders.vue'))

  // C 端：数量腿用「（个）」+ numeric + 整数步进，占位符是 '0'（不是 '0.00'）
  // 数量腿不挂任何单位（既没有「（个）」，也没有品牌名）
  expect(app).not.toContain("（个）")
  expect(app).toContain('按数量填写，不带货币符号与单位')
  expect(app).toContain('SAAS.legInputStep(m.method)')
  expect(app).toContain("(isToken ? 'numeric' : 'decimal')")
  expect(app).toContain("(isToken ? '0' : '0.00')")
  // 提交折算与超用判定都走 money.js 的唯一入口
  expect(app).toContain('SAAS.legInputToMinor(method, value, walletRatio)')
  expect(app).toContain('SAAS.legInputExceedsAvailable(leg.method, leg.input,')
  expect(app).toContain('payLegAvailableInput(')

  // B 端：数量腿同样不挂单位 + 整数步进 + 同一换算入口与超用判定
  expect(orders).not.toContain('（个）')
  expect(orders).toContain('按数量填写，不带货币符号与单位')
  expect(orders).toContain(':step="legInputStep(method.method)"')
  expect(orders).toContain('legInputToMinor(method.method, payByLeg.value[method.method], walletRatio.value)')
  expect(orders).toContain("legInputExceedsAvailable('WALLET', payByLeg.value.WALLET, memberWalletMinor.value, walletRatio.value)")
  expect(orders).toContain("legInputExceedsAvailable('POINT', payByLeg.value.POINT, memberPoints.value, walletRatio.value)")
  // 提交给服务端的 payments 仍是最小货币单位金额（wire contract 未改）
  expect(orders).toContain('currencyCode: getCurrency(),')

  // 所有「按代币腿分支」的源码行都不得出现货币符号 / 币种码 / 「元」
  for (const [name, source] of [['c-end/app.js', app], ['src/b-end/views/Orders.vue', orders]]) {
    const tokenLegLines = source.split('\n').filter((line) => line.includes('isToken') || line.includes('isTokenMethod'))
    expect(tokenLegLines.length, name).toBeGreaterThan(0)
    for (const line of tokenLegLines) expect(line, `${name}: ${line.trim()}`).not.toMatch(CURRENCY_TRACE)
  }
})
