import { expect, test } from 'vitest'
import {
  CURRENCY_DEFINITIONS,
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  applyResponseCurrency,
  currencyLabel,
  formatMajor,
  formatMoney,
  formatYuan,
  getCurrency,
  isSupported,
  minorToYuan,
  minorToText,
  normalize,
  resolveCurrency,
  setCurrency,
  symbolOf,
  yuanToFen,
} from './money'
import { formatMoney as formatMoneyFromAmount, fenToYuan, minorToYuan as minorToYuanFromAmount } from './amount'
import { codeOf, resolveApiErrorMessage } from './api-errors'

/**
 * B 端币种契约（16_CURRENCY_CONVENTIONS §3/§4）：
 *  - 金额展示唯一入口 = src/shared/utils/money.js 的 formatMoney（amount.js 只转发）；
 *  - 币种唯一来源 = context select 响应 currencyCode（缺省 USD），X-Currency 只在字段缺失时兜底；
 *  - 切换币种后所有金额展示响应式变化（数字不变、只改符号），已结算单据以记录快照为准。
 */

test('formatMoney：CNY/USD、0、负数、大额千分位与无效值', () => {
  expect(formatMoney(12345, 'CNY')).toBe('¥123.45')
  expect(formatMoney(12345, 'USD')).toBe('$123.45')
  expect(formatMoney(0, 'CNY')).toBe('¥0.00')
  expect(formatMoney(-500, 'USD')).toBe('-$5.00')
  expect(formatMoney(123456789, 'CNY')).toBe('¥1,234,567.89')
  expect(formatMoney('888000', 'USD')).toBe('$8,880.00')
  expect(formatMoney(null, 'CNY')).toBe('—')
  expect(formatMoney('abc', 'CNY')).toBe('—')
  // 币种名称来自 label，不向用户展示裸币种码
  expect(currencyLabel('CNY')).toBe('人民币')
  expect(currencyLabel('USD')).toBe('美元')
  // 主单位入参（演示数据）与最小单位入参同一格式
  expect(formatYuan(368, 'CNY')).toBe('¥368.00')
  expect(formatMajor(-5, 'CNY')).toBe('-¥5.00')
})

test('币种字典单一来源：只支持 CNY/USD，默认 USD', () => {
  expect(DEFAULT_CURRENCY).toBe('USD')
  expect(SUPPORTED_CURRENCIES).toEqual(['CNY', 'USD'])
  expect(Object.keys(CURRENCY_DEFINITIONS)).toEqual(['CNY', 'USD'])
  expect(CURRENCY_DEFINITIONS.CNY).toEqual({ symbol: '¥', digits: 2, label: '人民币' })
  expect(CURRENCY_DEFINITIONS.USD).toEqual({ symbol: '$', digits: 2, label: '美元' })
  expect(symbolOf('CNY')).toBe('¥')
  expect(normalize('usd')).toBe('USD')
  expect(isSupported('HKD')).toBe(false)
})

test('未知币种回退当前币种并 warn（不得整页报错）', () => {
  const warnings = []
  const original = console.warn
  console.warn = (message) => warnings.push(String(message))
  try {
    setCurrency('CNY')
    expect(formatMoney(12345, 'HKD')).toBe('¥123.45')
    expect(currencyLabel('RMB')).toBe('人民币')
    expect(resolveCurrency('EUR')).toBe('CNY')
    expect(warnings.length).toBeGreaterThanOrEqual(3)
    expect(warnings.join('\n')).toContain('HKD')

    setCurrency('JPY') // 非法值不得改币种
    expect(getCurrency()).toBe('CNY')
  } finally {
    console.warn = original
    setCurrency('USD')
  }
})

test('币种来源：响应体 currencyCode 优先，X-Currency 只在缺失时兜底，都没有则保持当前', () => {
  const header = (value) => ({ headers: { get: (name) => (name.toLowerCase() === 'x-currency' ? value : null) } })

  expect(applyResponseCurrency({ currencyCode: 'CNY' }, header('USD'))).toBe('CNY')
  expect(getCurrency()).toBe('CNY')
  expect(applyResponseCurrency({ contextId: 7 }, header('USD'))).toBe('USD')
  expect(applyResponseCurrency({ data: { currencyCode: 'CNY' } }, null)).toBe('CNY')
  // 都没有 → 不覆盖已选币种（老接口不得把币种打回默认）
  expect(applyResponseCurrency({ contextId: 7 }, null)).toBe('CNY')
  expect(applyResponseCurrency({}, { headers: { 'x-currency': 'USD' } })).toBe('USD')
  expect(getCurrency()).toBe('USD')
})

test('切币种后订单/库存等金额展示同步变化（响应式 store + 快照优先）', () => {
  const order = { totalAmount: 23800, roomEstimatedFee: 71400, currencyCode: 'CNY' }

  setCurrency('CNY')
  expect(formatMoney(order.roomEstimatedFee)).toBe('¥714.00')
  expect(formatMoney(order.totalAmount, order.currencyCode)).toBe('¥238.00')

  setCurrency('USD')
  // 无快照的实时金额（订单列表预估、库存成本等）跟随全站币种
  expect(formatMoney(order.roomEstimatedFee)).toBe('$714.00')
  // 已结算单据自带快照：不因切设置改变显示
  expect(formatMoney(order.totalAmount, order.currencyCode)).toBe('¥238.00')

  setCurrency('USD')
})

test('amount.js 只转发 money.js（不再留第二套换算与符号表）', () => {
  expect(formatMoneyFromAmount).toBe(formatMoney)
  expect(minorToYuanFromAmount).toBe(minorToYuan)
  expect(fenToYuan(12345)).toBe('123.45')
  expect(fenToYuan(null)).toBe('—')
  expect(minorToText(12345, 'CNY')).toBe('123.45')
  setCurrency('CNY')
  expect(yuanToFen('12.34')).toBe(1234)
  setCurrency('USD')
})

test('币种/渠道错误码翻成中文可执行提示（不外泄错误码与英文原文）', () => {
  const axiosLike = (code, status = 422, message = '') => ({ response: { status, data: { code, message } } })

  const mismatch = resolveApiErrorMessage(axiosLike('CURRENCY_MISMATCH'))
  expect(mismatch).toContain('订单币种')
  expect(mismatch).not.toContain('CURRENCY_MISMATCH')

  const method = resolveApiErrorMessage(axiosLike('PAYMENT_METHOD_UNSUPPORTED'))
  expect(method).toContain('支付方式')
  expect(method).toMatch(/人民币/)

  // 变体错误码同样识别
  expect(resolveApiErrorMessage(axiosLike('PAY_METHOD_CURRENCY_UNSUPPORTED'))).toContain('支付方式')
  expect(resolveApiErrorMessage(axiosLike('ORDER_CURRENCY_MISMATCH'))).toContain('订单币种')
  expect(resolveApiErrorMessage(axiosLike('CURRENCY_CORRIDOR_DISABLED'))).toContain('跨币种')
  expect(codeOf(axiosLike('CURRENCY_MISMATCH'))).toBe('CURRENCY_MISMATCH')

  // 服务端已给中文 message：直接展示
  expect(resolveApiErrorMessage(axiosLike('SOMETHING_NEW', 422, '该订单已收款'))).toBe('该订单已收款')
  // 英文/框架原文：走状态码兜底中文
  const fallback = resolveApiErrorMessage({ response: { status: 503, data: { message: 'Service Unavailable' } } })
  expect(fallback).toBe('服务暂时不可用（503），请稍后重试。')
  const network = resolveApiErrorMessage({ message: 'Network Error' }, '收款失败')
  expect(network).toBe('收款失败')
})
