import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('酒店订单使用独立卡片，取消按钮不落入 venue-card 网格', async () => {
  const source = await readFile(new URL('./hotel-real.js', import.meta.url), 'utf8')
  const orders = source.slice(source.indexOf('async function renderRealHotelOrders'), source.indexOf('document.addEventListener'))
  expect(orders).toContain('hotel-order-card')
  expect(orders).toContain('hotel-order-cancel')
  expect(orders).not.toContain('class="venue-card"')
  expect(orders).not.toContain('ghost-button')
})

test('酒店列表返回时优先显示缓存并带重试入口', async () => {
  const source = await readFile(new URL('./hotel-real.js', import.meta.url), 'utf8')
  expect(source).toContain('hotelListCache')
  expect(source).toContain('data-route="my-hotel-orders"')
  expect(source).toContain('data-retry="service/hotel"')
  expect(source).toContain('已显示上次结果')
})
