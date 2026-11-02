import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('酒店订单使用独立卡片，取消按钮不落入 venue-card 网格', async () => {
  const source = await readFile(new URL('./hotel-real.js', import.meta.url), 'utf8')
  const orders = source.slice(source.indexOf('var HOTEL_ORDER_STATUS'), source.indexOf('document.addEventListener'))
  expect(orders).toContain('hotel-order-card')
  expect(orders).toContain('hotel-order-cancel')
  expect(orders).not.toContain('class="venue-card"')
  expect(orders).not.toContain('ghost-button')
})

test('酒店订单页走 SaasPageLoad（超时 + 可重试），取消条件与服务端一致', async () => {
  const source = await readFile(new URL('./hotel-real.js', import.meta.url), 'utf8')
  const render = source.slice(source.indexOf('async function renderRealHotelOrders'), source.indexOf('document.addEventListener'))
  expect(render).toContain('SaasPageLoad.renderPage')
  expect(render).toContain("retryRoute: route")
  expect(render).toContain("errorTitle: '酒店订单加载失败'")
  expect(render).toContain('isCurrent')
  // 接口超时兜底（与其他页面同一份 SaasPageLoad.withTimeout）
  expect(source).toContain('SaasPageLoad.withTimeout')
  // 取消按钮：未取消 / 未退房即可取消（不再是只有 PENDING_PAYMENT 才显示）
  expect(source).toContain('canCancelHotelOrder(order.status)')
  expect(source).toContain("status !== 'CANCELLED' && status !== 'CHECKED_OUT' && status !== 'COMPLETED'")
})

test('酒店列表返回时优先显示缓存并带重试入口', async () => {
  const source = await readFile(new URL('./hotel-real.js', import.meta.url), 'utf8')
  expect(source).toContain('hotelListCache')
  expect(source).toContain('data-route="my-hotel-orders"')
  expect(source).toContain('data-retry="service/hotel"')
  expect(source).toContain('已显示上次结果')
})
