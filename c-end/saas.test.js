import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, test, vi } from 'vitest'

async function loadSaas(fetch, refreshContext) {
  const moneySource = await readFile(new URL('./money.js', import.meta.url), 'utf8')
  const source = await readFile(new URL('./saas.js', import.meta.url), 'utf8')
  const window = {
    location: { origin: 'https://admin.dev.example.com', hostname: 'admin.dev.example.com' },
    A380OAuth: { refreshContext },
  }
  const context = { window, fetch, console, crypto: { randomUUID: () => 'request-id' } }
  vm.runInNewContext(moneySource, context)
  vm.runInNewContext(source, context)
  window.SAAS.activate()
  return window.SAAS
}

test('retries a KTV room request once after refreshing an expired context', async () => {
  const refreshContext = vi.fn().mockResolvedValue(undefined)
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 401, text: async () => '{"code":"INVALID_TENANT_CONTEXT"}' })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 1001, name: '小包 K01' }] })
  const saas = await loadSaas(fetch, refreshContext)

  await expect(saas.listKtvRooms()).resolves.toEqual([
    expect.objectContaining({ id: 1001, name: '小包 K01', resourceType: 'KTV_ROOM' }),
  ])
  expect(refreshContext).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledTimes(2)
})

/** C 端点单目录要带主图：服务端返回的网关同源相对路径必须原样透传给点单页（前端不拼域名）。 */
test('listCatalog passes catalog images through to the C-end ordering page', async () => {
  const thumb = '/api/v1/media-public/gv-media-public/saas/1001/202609/a.png'
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ([
      { id: 401, name: '缤纷果盘', unitPrice: 12800, unit: '份', imageUrls: [thumb], mainImageUrl: thumb },
      { id: 403, name: '气泡水', unitPrice: 1800, unit: '瓶', imageUrls: [], mainImageUrl: null },
    ]),
  })
  const saas = await loadSaas(fetch, vi.fn())

  const items = await saas.listCatalog({ storeId: 100 })

  // 同源请求（相对路径转发），图片地址同样不拼域名；统一前缀走网关 /api 命名空间
  expect(fetch.mock.calls[0][0]).toBe('https://admin.dev.example.com/api/v1/business/catalog/items?storeId=100')
  expect(items[0].mainImageUrl.startsWith('/api/v1/media-public/')).toBe(true)
  expect(items[0].mainImageUrl).toBe(thumb)
  expect(items[0].imageUrls).toEqual([thumb])
  // 无图目录项保持 null / 空数组，前端走占位图分支
  expect(items[1].mainImageUrl).toBeNull()
  expect(items[1].imageUrls).toEqual([])
})

/** C 端选包厢/预约列表要带包厢主图与描述：网关同源相对路径原样透传，无图包厢退化为空数组 + null。 */
test('listKtvRooms passes room images and description through to the C-end booking page', async () => {
  const thumb = '/api/v1/media-public/gv-media-public/saas/1001/202609/room.png'
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ([
      { id: 1001, name: '仙域', capacity: 4, areaName: '三楼ktv101', available: true, state: 'IDLE',
        imageUrls: [thumb], mainImageUrl: thumb, description: '星空顶小包' },
      { id: 102, name: '小包 K02', capacity: 4, available: false, state: 'CLEANING',
        unavailableReason: '清洁中', imageUrls: null, mainImageUrl: null, description: null },
    ]),
  })
  const saas = await loadSaas(fetch, vi.fn())

  const rooms = await saas.listKtvRooms()

  expect(fetch.mock.calls[0][0]).toBe('https://admin.dev.example.com/api/v1/business/resources?resourceType=KTV_ROOM')
  expect(rooms[0].mainImageUrl).toBe(thumb)
  expect(rooms[0].imageUrls).toEqual([thumb])
  expect(rooms[0].description).toBe('星空顶小包')
  expect(rooms[0].areaName).toBe('三楼ktv101')
  // 历史无图包厢：空数组 + null，前端走占位块；房态原因保留
  expect(rooms[1].imageUrls).toEqual([])
  expect(rooms[1].mainImageUrl).toBeNull()
  expect(rooms[1].description).toBe('')
  expect(rooms[1].areaName).toBe('')
  expect(rooms[1].available).toBe(false)
  expect(rooms[1].unavailableReason).toBe('清洁中')
})
