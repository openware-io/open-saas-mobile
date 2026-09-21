import { expect, test } from 'vitest'
import { fenToYuan, minorToYuan, yuanToFen, formatMoney, fmtTime } from './amount'
import { getCurrency, setCurrency, currencyLabel, DEFAULT_CURRENCY } from './money'

/**
 * B 端金额尺度：分↔元换算与展示统一走 ./money.js（唯一实现），amount.js 只做转发。
 * 币种缺省 = store 当前币种（规范默认 USD）；单据快照可显式传 currencyCode。
 */
test('金额尺度：分↔元换算与展示统一走 money.js', () => {
  // 分 -> 元
  expect(fenToYuan(12345)).toBe('123.45')
  expect(fenToYuan(0)).toBe('0.00')
  expect(fenToYuan(null)).toBe('—')
  expect(fenToYuan('abc')).toBe('—')
  expect(minorToYuan(12345)).toBe(123.45)
  expect(minorToYuan('2500')).toBe(25)
  expect(minorToYuan(null)).toBe(0)
  // 元 -> 分
  expect(yuanToFen('12.34')).toBe(1234)
  expect(yuanToFen(0.1)).toBe(10)
  expect(yuanToFen('')).toBe(0)
  // 展示：货币符号紧跟金额、不插入空格（大额千分位）
  expect(formatMoney(12345, 'CNY')).toBe('¥123.45')
  expect(formatMoney(0, 'CNY')).toBe('¥0.00')
  expect(formatMoney(888000, 'CNY')).toBe('¥8,880.00')
  expect(formatMoney(-500, 'CNY')).toBe('-¥5.00')
  expect(formatMoney(123456789, 'CNY')).toBe('¥1,234,567.89')
  expect(formatMoney(null)).toBe('—')
})

test('默认币种为 USD（规范 §1）：不传币种时跟随 store 当前币种', () => {
  expect(DEFAULT_CURRENCY).toBe('USD')
  setCurrency('USD')
  expect(getCurrency()).toBe('USD')
  expect(formatMoney(12345)).toBe('$123.45')
  expect(currencyLabel()).toBe('美元')

  setCurrency('CNY')
  expect(getCurrency()).toBe('CNY')
  expect(formatMoney(12345)).toBe('¥123.45')
  expect(currencyLabel()).toBe('人民币')

  // 单据/流水自带币种快照时以记录为准：切设置不改历史单据显示
  setCurrency('USD')
  expect(formatMoney(12345, 'CNY')).toBe('¥123.45')
  expect(formatMoney(12345, 'USD')).toBe('$123.45')

  setCurrency('USD')
})

test('未知币种回退当前币种并 warn（不得整页报错）', () => {
  const warnings = []
  const original = console.warn
  console.warn = (message) => warnings.push(String(message))
  try {
    setCurrency('CNY')
    expect(formatMoney(12345, 'HKD')).toBe('¥123.45')
    expect(formatMoney(12345, 'RMB')).toBe('¥123.45')
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.join('\n')).toContain('HKD')
  } finally {
    console.warn = original
    setCurrency('USD')
  }
})

test('切币种后订单/预估金额同步变化（金额数字不变，只改符号）', () => {
  const order = { totalAmount: 23800, roomEstimatedFee: 71400, currencyCode: 'CNY' }
  setCurrency('CNY')
  expect(formatMoney(order.roomEstimatedFee)).toBe('¥714.00')
  expect(formatMoney(order.totalAmount, order.currencyCode)).toBe('¥238.00')

  setCurrency('USD')
  // 无快照的实时预估跟随全站币种
  expect(formatMoney(order.roomEstimatedFee)).toBe('$714.00')
  // 已结算单据（自带快照）不因切设置而改变
  expect(formatMoney(order.totalAmount, order.currencyCode)).toBe('¥238.00')
})

test('时间展示统一走 fmtTime（后端 LocalDateTime 无时区，按字面量截取到分钟）', () => {
  expect(fmtTime('2026-09-18T19:30:00')).toBe('2026-09-18 19:30')
  expect(fmtTime('2026-09-18T19:30')).toBe('2026-09-18 19:30')
  expect(fmtTime(null)).toBe('—')
})
