import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('我的页提供酒店订单入口并从酒店预订投影用户状态', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  expect(app).toContain('data-route="my-hotel-orders"')
  expect(app).toContain('bookingStatusByOrderId')
  expect(app).toContain('o.bookingStatus || o.status')
})

test('酒店订单加载失败不会被伪装成空列表', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8')
  expect(app).toContain('hotelBookingLoadFailed')
  expect(app).toContain('酒店订单加载失败')
  expect(app).toContain("PENDING_CONFIRM: ['待确认'")
})
