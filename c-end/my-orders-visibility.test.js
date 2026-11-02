import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

/**
 * 「我的」信息架构：共享订单/预约不再按业态拆菜单。
 *  - 菜单只有「我的预约 / 我的订单」；酒店预订并入这两个统一列表；
 *  - `#/my-hotel-orders` 旧深链重定向到 `#/my-reservations`（保留可用，不再有独立页面）；
 *  - 订单行保留 displayStatus/bookingStatus/status 兜底投影。
 */

test('菜单只保留「我的预约 / 我的订单」；#/my-hotel-orders 旧深链重定向到我的预约', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  expect(app).toContain("myMenuItem('my-reservations'")
  expect(app).toContain("myMenuItem('my-orders'")
  expect(app).not.toContain("myMenuItem('my-hotel-orders'")
  expect(app).toContain("if (route === 'my-hotel-orders') { go('my-reservations'); return; }")
  // 订单行保留 displayStatus/bookingStatus/status 兜底（旧数据/旧会话投影字段兼容）
  expect(app).toContain('o.displayStatus || o.bookingStatus || o.status')
})

test('「我的订单」不再请求酒店预订接口：全部业态统一由 /me/orders 提供', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  const loadOrders = app.slice(app.indexOf('async function loadMyOrders'), app.indexOf('async function renderMyOrders'))
  expect(loadOrders).not.toContain('SaasHotelBookings')
  expect(loadOrders).not.toContain('loadHotelBookingsSafe')
  expect(loadOrders).not.toContain('bookingStatusByOrderId')
  // 不再按业态过滤（HOTEL 行也要展示）
  expect(loadOrders).not.toContain("!== 'HOTEL'")
  expect(app).not.toContain('function loadHotelBookingsSafe(')
})

test('「我的预约」统一列表：新 wrapper 归一 + 旧格式按 KTV 兼容，KTV/酒店卡片混排', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  const normalize = app.slice(app.indexOf('function normalizeReservationItems'), app.indexOf('async function loadMyReservations'))
  expect(normalize).toContain('item.type')
  expect(normalize).toContain("type === 'HOTEL'")
  expect(normalize).toContain("type === 'KTV'")
  expect(normalize).toContain('旧格式')

  const load = app.slice(app.indexOf('async function loadMyReservations'), app.indexOf('async function renderMyReservations'))
  expect(load).toContain('normalizeReservationItems(items)')
  expect(load).toContain('reservationPricingRef')

  const paint = app.slice(app.indexOf('function paintMyReservations'), app.indexOf('async function renderMyReservations'))
  expect(paint).toContain('reservationCard')
  expect(paint).toContain('hotelOrderCard(row.hotel)')
})

test('酒店预订状态按服务端闭集中文化，取消按钮不再依赖永不出现的 PENDING_PAYMENT', async () => {
  const hotel = await readFile(new URL('./hotel-real.js', import.meta.url), 'utf8')
  for (const status of [
    'PENDING_CONFIRM', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'DUE_OUT', 'CANCELLED', 'NO_SHOW',
  ]) {
    expect(hotel, status + ' 未在状态字典中').toContain(status + ': [')
  }
  // 历史数据兼容：COMPLETED 仍映射中文（只读展示，取消按钮由 canCancelHotelOrder 排除）
  expect(hotel).toContain("COMPLETED: ['已完成'")
  expect(hotel).not.toContain('PENDING_PAYMENT')
  expect(hotel).not.toContain('PENDING_DEPOSIT')
  expect(hotel).toContain('function canCancelHotelOrder(status)')
  expect(hotel).toContain("status !== 'CANCELLED' && status !== 'CHECKED_OUT' && status !== 'COMPLETED'")
})

test('酒店订单卡片日期统一走 SaasDateTime 的日期出口（不再直接输出 YYYY-MM-DD）', async () => {
  const hotel = await readFile(new URL('./hotel-real.js', import.meta.url), 'utf8')
  const card = hotel.slice(hotel.indexOf('function hotelOrderCard(order)'), hotel.indexOf('document.addEventListener'))
  expect(card).toContain('SaasDateTime.formatStoreDate(order.checkInDate)')
  expect(card).toContain('SaasDateTime.formatStoreDate(order.checkOutDate)')
})
