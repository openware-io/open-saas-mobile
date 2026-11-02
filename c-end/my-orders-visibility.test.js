import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('我的页提供酒店订单入口；订单行保留 status 兜底投影', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  // 菜单项由 myMenuItem 渲染 data-route（「我的酒店订单」入口保留）
  expect(app).toContain("myMenuItem('my-hotel-orders'")
  expect(app).toContain("data-route=\"' + route + '\"")
  // 订单行保留 displayStatus/bookingStatus/status 兜底（旧数据/旧会话投影字段兼容）
  expect(app).toContain('o.displayStatus || o.bookingStatus || o.status')
})

test('「我的订单」不再请求酒店预订接口（酒店行被过滤，避免接口挂住拖慢整页）', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  const loadOrders = app.slice(app.indexOf('async function loadMyOrders'), app.indexOf('async function renderMyOrders'))
  expect(loadOrders).not.toContain('SaasHotelBookings')
  expect(loadOrders).not.toContain('loadHotelBookingsSafe')
  expect(loadOrders).not.toContain('bookingStatusByOrderId')
  expect(app).not.toContain('function loadHotelBookingsSafe(')
})

test('酒店订单加载失败不会被伪装成空列表（我的酒店订单页走可重试错误态）', async () => {
  const hotel = await readFile(new URL('./hotel-real.js', import.meta.url), 'utf8')
  expect(hotel).toContain("errorTitle: '酒店订单加载失败'")
  expect(hotel).toContain('retryRoute: route')
  expect(hotel).toContain("PENDING_CONFIRM: ['待确认'")
  expect(hotel).not.toContain('订单加载中…')
})

test('我的预约不再混入酒店预订，也不再暴露酒店失败告警', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  const loadReservations = app.slice(
    app.indexOf('async function loadMyReservations'),
    app.indexOf('async function renderMyReservations'),
  )
  expect(loadReservations).not.toContain('loadHotelBookingsSafe')
  expect(app).not.toContain('hotelBookingCard')
  expect(app).not.toContain('hotelBookingLoadFailed')
  expect(app).not.toContain('酒店订单加载失败，KTV 预约仍可正常查看')
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
  const card = hotel.slice(hotel.indexOf('function hotelOrderCard(order)'), hotel.indexOf('function paintHotelOrderList'))
  expect(card).toContain('SaasDateTime.formatStoreDate(order.checkInDate)')
  expect(card).toContain('SaasDateTime.formatStoreDate(order.checkOutDate)')
})
