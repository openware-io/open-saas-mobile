import { expect, test } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { formatMoney, setCurrency } from './src/shared/utils/money'

/**
 * 币种契约守卫（16_CURRENCY_CONVENTIONS §2/§4/§7，KNOWN_DEBT 必须为空）。
 *
 * 1) 币种字典**只允许**出现在 C 端 `c-end/money.js` 与 B 端 `src/shared/utils/money.js`，
 *    且两侧必须逐字一致（同一份字典，改一处必须同改）；
 * 2) `c-end/**` 与 `src/**` 不得出现硬编码货币符号、展示用「元」单位、手写 /100、*100 换算、
 *    裸币种码字面量（测试文件除外）；
 * 3) 写请求体的币种必须取全局当前币种；
 * 4) 后端 `displayText`（按当时币种拼好的成串文案）不得直出页面，否则同页会出现两种符号；
 * 5) 展示格式三端（`gv_saas_admin` / `gv_chat_app` / 本仓库）逐字一致：**符号紧跟数字、无空格**。
 */

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

/** 唯一来源：这两份文件里的币种字典是允许出现符号 / 币种码的地方。 */
const MONEY_MODULES = ['c-end/money.js', 'src/shared/utils/money.js']
/** 展示层（含接口层）不得出现 displayText：结构化字段才是唯一数据源。 */
const DISPLAY_TEXT_FREE = ['c-end/app.js', 'c-end/saas.js', 'src/b-end/views/Reservations.vue']

function stripComments(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

async function collectFiles(dir, extensions) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      files.push(...await collectFiles(full, extensions))
    } else if (extensions.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith('.test.js')) {
      files.push(full)
    }
  }
  return files
}

function relative(full) {
  return path.relative(repoRoot, full).split(path.sep).join('/')
}

const FORBIDDEN_PATTERNS = [
  { label: '硬编码货币符号', pattern: /[¥￥€]/ },
  { label: '硬编码 $ 金额', pattern: /\$\s?\d/ },
  { label: '硬编码 RMB 字样', pattern: /\bRMB\b/i },
  { label: '手写最小货币单位换算', pattern: /\/\s*100\b|\*\s*100\b/ },
  { label: '展示用「元」单位', pattern: /[（(]元[）)]|元\s*\/\s*(小时|半小时|套餐|天|次)|元起|低至\s*元/ },
  { label: '硬编码币种码', pattern: /\b(CNY|USD)\b/ },
]

test('币种字典只在两处定义，且 C 端与 B 端逐字一致（默认 USD）', async () => {
  const [cEnd, bEnd] = await Promise.all(MONEY_MODULES.map((file) => readFile(path.join(repoRoot, file), 'utf8')))

  const dictionaryOf = (source) => ['CNY', 'USD'].map((code) => {
    const hit = source.match(new RegExp(code + ":\\s*\\{[^}]*\\}"))
    expect(hit, `${code} 字典缺失`).not.toBeNull()
    return hit[0].replace(/\s+/g, ' ').replace(/,\s*}/g, ' }').trim()
  })

  expect(dictionaryOf(cEnd)).toEqual([
    "CNY: { symbol: '¥', digits: 2, label: '人民币' }",
    "USD: { symbol: '$', digits: 2, label: '美元' }",
  ])
  expect(dictionaryOf(bEnd)).toEqual(dictionaryOf(cEnd))
  expect(cEnd).toContain("DEFAULT_CURRENCY = 'USD'")
  expect(bEnd).toContain("DEFAULT_CURRENCY = 'USD'")
})

// 全仓文件扫描守卫：并行跑 17 个测试文件时 Windows 文件系统偶发超过默认 5s（与断言无关），显式放宽超时。
test('c-end/** 与 src/** 不得出现硬编码符号、展示用「元」、手写 /100 与裸币种码', async () => {
  const offenders = []
  const files = [
    ...await collectFiles(path.join(repoRoot, 'c-end'), ['.js', '.vue', '.html', '.css']),
    ...await collectFiles(path.join(repoRoot, 'src'), ['.js', '.vue', '.html', '.css']),
  ].filter((file) => !MONEY_MODULES.includes(relative(file)))

  for (const file of files) {
    const source = stripComments(await readFile(file, 'utf8'))
    for (const { label, pattern } of FORBIDDEN_PATTERNS) {
      source.split('\n').forEach((line, index) => {
        if (pattern.test(line)) offenders.push(`${relative(file)}:${index + 1} ${label} → ${line.trim()}`)
      })
    }
  }

  expect(offenders).toEqual([])
}, 30000)

/**
 * 三端展示格式逐字一致（16_CURRENCY_CONVENTIONS §4）：
 * `gv_saas_admin` `src/utils/format.js` 与 `gv_chat_app` `lib/core/currency.dart` 都是
 * **符号紧跟数字、无空格**（`¥100.00` / `$100.00`），本仓库两侧必须是同一格式。
 */
test('金额展示格式三端一致：符号紧跟数字（无空格），千分位保留、负数符号在最前', async () => {
  setCurrency('USD')
  // 行为锁死：无空格 + 千分位 + 负数符号在最前
  expect(formatMoney(123456, 'CNY')).toBe('¥1,234.56')
  expect(formatMoney(888000, 'USD')).toBe('$8,880.00')
  expect(formatMoney(-500, 'CNY')).toBe('-¥5.00')
  expect(formatMoney(-500, 'USD')).toBe('-$5.00')
  expect(formatMoney(100, 'CNY')).toBe('¥1.00')
  expect(formatMoney(123456, 'CNY')).not.toMatch(/\s/)
  expect(formatMoney(123456, 'USD')).not.toMatch(/\s/)

  // 源码锁死：两侧都不得出现「符号 + ' ' + 金额」式拼接，必须 symbol 紧跟 body
  for (const file of MONEY_MODULES) {
    const source = await readFile(path.join(repoRoot, file), 'utf8')
    expect(source, `${file} 仍在符号与金额之间拼空格`).not.toMatch(/\+\s*'\s'\s*\+/)
    expect(source, `${file} 未按「符号紧跟金额」拼接`).toMatch(/\.symbol \+ body/)
  }
})

test('写请求体的币种取全局当前币种，不写死币种码', async () => {
  const orders = await readFile(path.join(repoRoot, 'src/b-end/views/Orders.vue'), 'utf8')
  const saas = await readFile(path.join(repoRoot, 'c-end/saas.js'), 'utf8')

  // B 端：开台落单 + 收款
  expect(orders).toContain('currencyCode: getCurrency(), resourceId: createForm.value.resourceId')
  expect(orders).toContain('currencyCode: getCurrency(),')
  expect(orders).toContain("import { formatMoney, minorToYuan, yuanToFen, getCurrency, currencyLabel } from '@/shared/utils/amount'")
  // C 端：组合支付（收款币种 = 订单币种，服务端会校验）
  expect(saas).toContain('currencyCode: currencyCode || getCurrency()')
})

test('后端 displayText 不得直出页面（同页只允许一种符号）', async () => {
  for (const file of DISPLAY_TEXT_FREE) {
    const source = stripComments(await readFile(path.join(repoRoot, file), 'utf8'))
    expect(source, `${file} 直接使用了 displayText`).not.toContain('displayText')
  }
  // C 端取价结果也不保留该字段
  const saas = stripComments(await readFile(path.join(repoRoot, 'c-end/saas.js'), 'utf8'))
  expect(saas).not.toMatch(/displayText\s*:/)
})

test('结算展示取单据快照、缺省才回退全局币种（C 端账单/订单）', async () => {
  const app = await readFile(path.join(repoRoot, 'c-end/app.js'), 'utf8')
  expect(app).toContain('bill.currencyCode || bill.currency || null')
  // 订单金额走服务端实时合计（orderLiveAmount：优先 liveTotalAmount、退回 totalAmount），
  // 但**币种快照口径不变**：仍取单据上的 currencyCode，缺省才回退全局币种。
  expect(app).toContain('minorMoney(orderLiveAmount(o), o.currencyCode)')
  expect(app).toContain('minorMoney(it.totalAmount || 0, it.currencyCode)')
})
