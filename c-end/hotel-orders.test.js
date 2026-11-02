import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

/**
 * 酒店预订卡片的复用与取消口径（已并入「我的预约」统一列表，不再有独立「我的酒店订单」页）。
 *  - 卡片样式独立于 venue-card；
 *  - 状态闭集中文化 / 取消按钮按服务端判据；
 *  - 旧深链 `#/my-hotel-orders` 重定向到 `#/my-reservations`。
 */

test('酒店订单使用独立卡片，取消按钮不落入 venue-card 网格', async () => {
  const source = await readFile(new URL('./hotel-real.js', import.meta.url), 'utf8')
  const orders = source.slice(source.indexOf('var HOTEL_ORDER_STATUS'), source.indexOf('document.addEventListener'))
  expect(orders).toContain('hotel-order-card')
  expect(orders).toContain('hotel-order-cancel')
  expect(orders).not.toContain('class="venue-card"')
  expect(orders).not.toContain('ghost-button')
})

test('酒店卡片由「我的预约」复用：无独立页面、取消条件与服务端一致、超时只套读请求', async () => {
  const source = await readFile(new URL('./hotel-real.js', import.meta.url), 'utf8')
  expect(source).toContain('function hotelOrderCard(order)')
  expect(source).not.toContain('function renderRealHotelOrders')
  expect(source).not.toContain('function paintHotelOrderList')
  expect(source).not.toContain('window.SaasHotelBookings')
  expect(source).toContain("method === 'GET'")
  expect(source).toContain('canCancelHotelOrder(order.status)')
  expect(source).toContain("status !== 'CANCELLED' && status !== 'CHECKED_OUT' && status !== 'COMPLETED'")

  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  expect(app).toContain('hotelOrderCard(row.hotel)')
  expect(app).toContain("if (route === 'my-hotel-orders') { go('my-reservations'); return; }")
})

test('酒店卡在统一预约列表里不重复画底部横线（避免两横中间空白带）', async () => {
  const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8')
  // .item-list footer 的通用边框/内边距会覆盖 .hotel-order-foot；必须有更高优先级的归零规则。
  expect(css).toMatch(/\.item-list \.hotel-order-foot \{[^}]*border-top:\s*0/)
  expect(css).toMatch(/\.item-list \.hotel-order-foot \{[^}]*margin-top:\s*0/)
  expect(css).toMatch(/\.item-list \.hotel-order-foot \{[^}]*padding-top:\s*0/)
})

test('酒店列表返回时优先显示缓存并带重试入口', async () => {
  const source = await readFile(new URL('./hotel-real.js', import.meta.url), 'utf8')
  expect(source).toContain('hotelListCache')
  expect(source).toContain('data-route="my-reservations"')
  expect(source).toContain('data-retry="service/hotel"')
  expect(source).toContain('已显示上次结果')
})
