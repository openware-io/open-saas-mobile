import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, test, vi } from 'vitest'

/**
 * 在 5175 本地预览地址带 preview=1 加载 money.js + saas.js：走 demo 数据分支，不需要真实后端。
 * money.js 必须**先于** saas.js 加载（index.html 同一顺序），saas.js 只做转发。
 */
async function loadSaasInDemoMode() {
  const moneySource = await readFile(new URL('./money.js', import.meta.url), 'utf8')
  const source = await readFile(new URL('./saas.js', import.meta.url), 'utf8')
  const window = {
    location: {
      origin: 'http://localhost:5175',
      hostname: 'localhost',
      port: '5175',
      search: '?preview=1',
    },
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

test('金额尺度：最小货币单位↔主单位只走 money.js，展示统一为「符号紧跟金额」（无空格，与后台 / App 一致）', async () => {
  const saas = await loadSaasInDemoMode()
  saas.setCurrency('CNY')

  // 最小单位 -> 主单位（数值）：888000 = 8880
  expect(saas.fenToYuan('888000')).toBe(8880)
  expect(saas.fenToYuan(12800)).toBe(128)
  expect(saas.fenToYuan(null)).toBe(0)
  // 主单位 -> 最小单位（数值，四舍五入）
  expect(saas.yuanToFen('12.34')).toBe(1234)
  expect(saas.yuanToFen('0.1')).toBe(10)
  // 展示：符号紧跟金额，不插入空格（与后台 / App 三端口径一致）
  expect(saas.formatFen(12345)).toBe('¥123.45')
  expect(saas.formatFen('888000')).toBe('¥8,880.00')
  expect(saas.formatFen(0)).toBe('¥0.00')
  expect(saas.formatFen(-500)).toBe('-¥5.00')
  // 主单位入参的同一格式（仅演示数据使用）
  expect(saas.formatYuan(368)).toBe('¥368.00')
  // 储值品牌名默认值只在 saas.js 一处定义；它是代币名，与币种符号解耦
  expect(saas.DEFAULT_WALLET_BRAND).toBe('A380币')
})

/** mock 必须与真实契约同口径（最小货币单位）：否则「钱包余额忘了除 100」会再次被演示数据掩盖。 */
test('demo 钱包/账本 mock 与后端同口径（最小货币单位，币种不写死）', async () => {
  const saas = await loadSaasInDemoMode()
  saas.setCurrency('CNY')

  const wallet = await saas.getWallet()
  expect(wallet.availableAmount).toBe('888000')
  expect(wallet.currencyCode).toBeNull()
  // availableAmount 是「这笔钱」的最小货币单位（对账口径），因此仍走 formatFen；
  // 页面展示的是代币**数量**（formatTokens），禁止对代币调用 formatFen —— 见 token-display-contract.test.js
  expect(saas.formatFen(wallet.availableAmount)).toBe('¥8,880.00')
  // 8880 是演示值；若 mock 写成主单位形状（8880），金额换算会变成 ¥88.80，正是被掩盖的 100 倍错误
  expect(saas.fenToYuan(wallet.availableAmount)).toBe(8880)
  // 钱包的**展示**口径是代币数量：数量 = 余额 ÷ 100 × 租户比例（默认 100），
  // 只出数字（不带货币符号，也不拼品牌名 / 「积分」这类单位）
  expect(saas.formatTokens(wallet.tokenAmount)).toBe('888,000')

  saas.setCurrency('USD')
  expect(saas.formatFen(wallet.availableAmount)).toBe('$8,880.00')
  // 代币数量与币种解耦：切币种不影响数量展示
  expect(saas.formatTokens(wallet.tokenAmount)).toBe('888,000')
})

test('app.js 对后端最小单位金额只用 minorMoney，且不再散落 /100、*100 与 UTC 日期', async () => {
  const source = await readFile(new URL('./app.js', import.meta.url), 'utf8')

  // 同一 DTO 的金额字段（订单/加项/账单）必须是分→元
  expect(source).toContain('minorMoney(it.totalAmount')
  expect(source).toContain('minorMoney(estimate)')
  expect(source).not.toContain('mockMoney(it.totalAmount')
  expect(source).not.toContain('mockMoney(o.totalAmount')
  expect(source).not.toContain('mockMoney(bill.')
  expect(source).not.toContain('mockMoney(estimate)')
  // 散落的换算已全部收敛到 money.js 的 fenToYuan/yuanToFen
  expect(source).not.toMatch(/\/\s*100|\*\s*100/)
  // 日期不再用 UTC 的 toISOString
  expect(source).not.toMatch(/\.toISOString\(/)
})

test('index.html 在 app.js 之前加载 money.js、datetime.js 与 saas.js（app.js 依赖它们的全局）', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  const order = [...html.matchAll(/src="\.\/([\w.-]+)\.js(?:\?[^"]*)?"/g)].map((match) => match[1])

  expect(order).toContain('money')
  expect(order).toContain('datetime')
  expect(order).toContain('saas')
  expect(order.indexOf('money')).toBeLessThan(order.indexOf('saas'))
  expect(order.indexOf('datetime')).toBeLessThan(order.indexOf('app'))
  expect(order.indexOf('saas')).toBeLessThan(order.indexOf('app'))
})
