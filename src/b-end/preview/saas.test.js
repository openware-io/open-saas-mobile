import { expect, test } from 'vitest'
import {
  confirmOrderItem,
  confirmReservation,
  getPendingApproval,
  listCatalogItems,
  listOrders,
  listReservations,
  noShowReservation,
  openTable,
  settleOrder,
} from './saas'

test('preview data covers common reservation states and supports actions', async () => {
  const before = await listReservations()
  expect(before.map((item) => item.status)).toEqual(expect.arrayContaining(['PENDING', 'CONFIRMED', 'ARRIVED', 'CANCELLED']))

  await confirmReservation(1001)
  const after = await listReservations()
  expect(after.find((item) => item.id === 1001)?.status).toBe('CONFIRMED')
})

/**
 * 未到店（NO_SHOW）与开台（CONVERTED）是预约状态机里此前没有入口/写错的两个分支：
 * preview 必须与后端同口径，否则本地预览会掩盖真实行为。
 */
test('preview 支持「未到店」与「开台 → CONVERTED」', async () => {
  await noShowReservation(1002)
  const afterNoShow = await listReservations()
  expect(afterNoShow.find((item) => item.id === 1002)?.status).toBe('NO_SHOW')

  await openTable(1003)
  const afterOpen = await listReservations()
  const opened = afterOpen.find((item) => item.id === 1003)
  expect(opened?.status).toBe('CONVERTED')
  expect(opened?.orderId).toBeTruthy()
})

test('preview data covers common order states and supports settlement', async () => {
  const before = await listOrders()
  expect(before.map((item) => item.status)).toEqual(expect.arrayContaining(['DRAFT', 'SERVING', 'WAITING_SETTLEMENT', 'WAITING_PAYMENT', 'COMPLETED']))

  await settleOrder(2003)
  const after = await listOrders()
  expect(after.find((item) => item.id === 2003)?.status).toBe('WAITING_PAYMENT')
})

/** 点单加项列表要能拿到图片：契约是 imageUrls + mainImageUrl，且地址必须是同源/内联，不能拼域名。 */
test('preview catalog items carry main image for the add-item picker', async () => {
  const items = await listCatalogItems()

  const thumbs = items.map((item) => item.mainImageUrl || (item.imageUrls || [])[0] || '')
  expect(thumbs.filter(Boolean).length).toBeGreaterThan(0)
  // 同时覆盖「无图 → 前端占位」分支
  expect(thumbs.some((thumb) => thumb === '')).toBe(true)
  // 后端媒体统一前缀为 /api/v1/media-public/（网关同源相对路径），preview 用内联 data URI；两者都不拼域名
  expect(thumbs.filter(Boolean).every((thumb) => thumb.startsWith('data:image/') || thumb.startsWith('/api/v1/media-public/'))).toBe(true)
  for (const item of items) {
    expect(Array.isArray(item.imageUrls)).toBe(true)
    if (item.mainImageUrl) expect(item.imageUrls).toContain(item.mainImageUrl)
  }
})

/** 待确认加项聚合视图：与真实契约同字段，确认后立刻从聚合视图消失（提醒链路的唯一数据源）。 */
test('preview 待确认加项聚合视图与真实契约同字段，确认后条数下降', async () => {
  const before = await getPendingApproval()
  expect(before.pendingCount).toBeGreaterThan(0)
  expect(before.revision).toBeGreaterThan(0)

  const group = before.orders[0]
  expect(group.orderId).toBeTruthy()
  expect(group.pendingCount).toBe(group.items.length)
  expect(group.items[0].name).toBeTruthy()
  expect(group.items[0].amount).toBeGreaterThan(0)

  await confirmOrderItem(group.orderId, group.items[0].id)

  const after = await getPendingApproval()
  expect(after.pendingCount).toBe(before.pendingCount - 1)
})
