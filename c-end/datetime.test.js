import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, test } from 'vitest'

// 固定在东八区（UTC+8）：本地 00:00–07:59 的 UTC 日期是前一天，用来锁住「禁止用 toISOString 取日期」。
// vitest 默认按文件隔离进程，这里的 TZ 不会影响其它测试文件。
process.env.TZ = 'Asia/Shanghai'

async function loadDateTime() {
  const source = await readFile(new URL('./datetime.js', import.meta.url), 'utf8')
  const window = {}
  // 显式把宿主 Date 传进 vm，保证被测代码与被测断言看到同一个时区
  vm.runInNewContext(source, { window, Date })
  return window.A380DateTime
}

test('本地日期按设备时区取：本地 00:30 与 23:30 都不越界', async () => {
  const { localDateString } = await loadDateTime()
  const earlyMorning = new Date(2026, 8, 18, 0, 30)
  const lateNight = new Date(2026, 8, 18, 23, 30)

  // 前置断言：确认运行在东八区，否则「UTC 会早一天」这个对照不成立
  expect(earlyMorning.getTimezoneOffset()).toBe(-480)
  // 旧实现（toISOString().slice(0,10)）在东八区会把本地 00:30 写成前一天
  expect(earlyMorning.toISOString().slice(0, 10)).toBe('2026-09-17')
  expect(localDateString(earlyMorning)).toBe('2026-09-18')
  expect(localDateString(lateNight)).toBe('2026-09-18')
})

test('dateOffset 的「今天+N」按本地日期整日推进', async () => {
  const { dateOffset } = await loadDateTime()
  expect(dateOffset(0, new Date(2026, 8, 18, 0, 30))).toBe('2026-09-18')
  expect(dateOffset(1, new Date(2026, 8, 18, 23, 30))).toBe('2026-09-19')
  expect(dateOffset(2, new Date(2026, 8, 18, 0, 30))).toBe('2026-09-20')
})

test('预约时间按门店营业本地时间带 +08:00 偏移序列化，不是 UTC 的 Z 串', async () => {
  const { storeOffsetDateTime } = await loadDateTime()

  expect(storeOffsetDateTime('2026-09-18', '19:30', 0)).toBe('2026-09-18T19:30:00+08:00')
  expect(storeOffsetDateTime('2026-09-18', '19:30', 3)).toBe('2026-09-18T22:30:00+08:00')
  // 跨天：22:30 + 3 小时
  expect(storeOffsetDateTime('2026-09-18', '22:30', 3)).toBe('2026-09-19T01:30:00+08:00')
  // 与设备时区无关，且绝不出现 UTC 的 Z 结尾
  expect(storeOffsetDateTime('2026-09-18', '19:30', 0).endsWith('Z')).toBe(false)
})

test('后端 LocalDateTime 按字面量展示，带时区串换算到门店时区', async () => {
  const { formatStoreDateTime } = await loadDateTime()

  // 后端出参是 LocalDateTime（无时区）= 门店营业本地时间
  expect(formatStoreDateTime('2026-09-18T19:30:00')).toBe('9月18日 19:30')
  expect(formatStoreDateTime('2026-09-18T19:30')).toBe('9月18日 19:30')
  // 带时区串先换算到 +08:00（11:30Z = 19:30 北京时间）
  expect(formatStoreDateTime('2026-09-18T11:30:00Z')).toBe('9月18日 19:30')
  expect(formatStoreDateTime('2026-09-18T19:30:00+08:00')).toBe('9月18日 19:30')
  expect(formatStoreDateTime('')).toBe('—')
  expect(formatStoreDateTime(null)).toBe('—')
})

test('A380DateTime 对外暴露的日期时间 API 固定', async () => {
  const api = await loadDateTime()
  expect(Object.keys(api).sort()).toEqual(
    ['STORE_OFFSET_MINUTES', 'dateOffset', 'formatStoreDateTime', 'localDateString', 'storeOffsetDateTime'],
  )
})
