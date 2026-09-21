import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'
import { expect, test, vi } from 'vitest'
import { CODE_MESSAGES, codeOf, resolveApiErrorMessage } from '../src/shared/utils/api-errors.js'

/**
 * KTV 预约按「包厢类型（房型）」的契约守卫：
 *
 * 一个门店的包厢可能几十上百个、房型只有几个，且**具体包厢号要到店后才分配**，因此：
 *  1) C 端选包厢页只列房型，文案为「选择包厢类型」，不得再出现「选择包厢」单文案与包厢号选择控件；
 *  2) 预约确认页 / 我的预约展示房型名（回退房型编码），历史行（只有 resourceId）显示旧包厢名并标注「历史预约」；
 *  3) 创建预约请求体走 roomTypeId，**不含 resourceId**（服务端会以 RESOURCE_ID_NOT_ALLOWED 拒收）；
 *  4) 房型卡片价格用后端 combinedUnitPrice（房型 + 服务合计），不是房型单价；
 *  5) 房型相关错误码一律中文化，不弹裸码 / 英文。
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const readRepo = (relative) => readFile(path.join(repoRoot, relative), 'utf8')

/** 去掉注释后再做文案守卫（注释里允许说明「历史上是选择包厢」）。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data }
}

/** 加载 money.js + saas.js（live 模式，fetch 可控）。 */
async function loadSaas(fetch) {
  const moneySource = await readFile(new URL('./money.js', import.meta.url), 'utf8')
  const source = await readFile(new URL('./saas.js', import.meta.url), 'utf8')
  const warnings = []
  const fakeConsole = { warn: (message) => warnings.push(String(message)), log: () => {}, error: () => {} }
  const window = {
    location: { origin: 'https://admin.dev.example.com', hostname: 'admin.dev.example.com' },
    A380OAuth: { refreshContext: vi.fn() },
  }
  const context = { window, fetch, console: fakeConsole, crypto: { randomUUID: () => 'request-id' } }
  vm.runInNewContext(moneySource, context)
  vm.runInNewContext(source, context)
  window.SAAS.activate()
  // 本文件断言的是「数字与口径」，符号统一按 CNY 记录（切币种只改符号，见 currency.test.js）
  window.SAAS.setCurrency('CNY')
  return { saas: window.SAAS, warnings }
}

// —— 1. 选包厢页文案与控件守卫 ——

test('C 端选包厢页只列包厢类型：不再出现「选择包厢」单文案与包厢号选择控件', async () => {
  const source = await readRepo('c-end/app.js')
  const code = stripComments(source)

  expect(code).toContain('选择包厢类型')
  expect(code).toContain('具体包厢到店后由门店分配')
  // 「选择包厢」必须带「类型」后缀，且不再有「任选包厢」这类按包厢号选择的文案
  expect(code).not.toMatch(/选择包厢(?!类型)/)
  expect(code).not.toContain('任选包厢')
  // 选包厢页列的是房型（listKtvRoomTypes），卡片标题取房型名，不取包厢名/包厢号
  const page = code.slice(code.indexOf('async function renderKtvBooking'), code.indexOf('function renderKtvBookFormFromRoom'))
  expect(page).toContain('SAAS.listKtvRoomTypes()')
  expect(page).toContain('escapeHtml(roomType.name)')
  expect(page).not.toContain('.resourceCode')
  expect(page).not.toContain('room.name')
  // 房型卡片按房型 id 进预约页，不得再按包厢 id 进预约页
  expect(page).toContain('book-ktv/type/${roomType.roomTypeId}')
  expect(code).not.toContain('book-ktv/${room.id}')
  expect(code).not.toContain('data-room-id')
})

// —— 2. 请求体守卫：roomTypeId 必填、不含 resourceId ——

test('创建预约走 roomTypeId 且请求体不含 resourceId，未选房型不提交', async () => {
  const code = stripComments(await readRepo('c-end/app.js'))
  const start = code.indexOf("if (form.id === 'ktv-order-form')")
  const end = code.indexOf("if (form.id === 'travel-search-form')")
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const block = code.slice(start, end)

  expect(block).toContain('const roomTypeId = Number(form.dataset.roomTypeId)')
  expect(block).toContain('roomTypeId: roomTypeId')
  expect(block).not.toContain('resourceId')
  // 未选房型必须给中文提示并中止提交
  expect(block).toContain('请先选择包厢类型')
  expect(block).toContain('return;')

  // 接口层原样透传：POST body 只有 roomTypeId，没有 resourceId
  const fetch = vi.fn().mockImplementation(async (url) => {
    if (String(url).includes('/auth/csrf')) return jsonResponse({ csrfToken: 'csrf-token' })
    return jsonResponse({ id: 1, reservationNo: 'R1', status: 'PENDING' })
  })
  const { saas } = await loadSaas(fetch)
  await saas.createReservation({
    businessType: 'KTV', roomTypeId: 7,
    startAt: '2026-09-20T19:30:00+08:00', endAt: '2026-09-20T22:30:00+08:00',
    partySize: 2, contact: '张三 13800000000',
  })

  const call = fetch.mock.calls.find(([url, options]) => options && options.method === 'POST' && String(url).includes('/business/reservations'))
  expect(call, '未发出创建预约请求').toBeTruthy()
  expect(String(call[0])).toBe('https://admin.dev.example.com/api/v1/business/reservations')
  const body = JSON.parse(call[1].body)
  expect(body.roomTypeId).toBe(7)
  expect(body).not.toHaveProperty('resourceId')
})

// —— 3. 房型报价：按 roomTypeId 取价，展示 combinedUnitPrice 合计 ——

test('房型报价按 roomTypeId 取价，卡片展示 combinedUnitPrice 合计（不是房型单价）', async () => {
  const pricingFetch = vi.fn().mockImplementation(async (url) => {
    const query = new URL(String(url)).searchParams
    if (query.get('roomTypeId') === '7') {
      return jsonResponse({
        billingUnit: 'HOUR', roomUnitPrice: 5000, serverUnitPrice: 2000, combinedUnitPrice: 7000,
        appliedRoomTypeId: 7, appliedRoomTypeCode: '001', appliedRoomTypeName: '小包',
        roomTypePriceApplied: true, displayText: '小包 ¥70.00/小时',
      })
    }
    return jsonResponse({
      billingUnit: 'HOUR', roomUnitPrice: 10000, serverUnitPrice: 2500, combinedUnitPrice: 12500,
      roomTypePriceApplied: false,
    })
  })
  const { saas } = await loadSaas(pricingFetch)

  await saas.resolveKtvRoomPricing([{ roomTypeId: 7, roomTypeCode: '001' }])

  // 取价请求按房型 id（新契约），不是资源 id
  expect(String(pricingFetch.mock.calls[0][0])).toBe('https://admin.dev.example.com/api/v1/business/ktv/pricing?roomTypeId=7')
  // 展示的是「房型 50 + 服务 20 = 合计 70」，拿房型单价会显示成 ¥50.00/小时
  const pricing = saas.ktvPricingFor({ roomTypeId: 7 })
  expect(pricing.combinedUnitPrice).toBe(7000)
  expect(saas.ktvCombinedUnitPrice(pricing)).toBe(7000)
  expect(saas.formatKtvRoomPrice(pricing)).toBe('¥70.00/小时')
  expect(saas.formatKtvRoomPrice(pricing)).not.toBe('¥50.00/小时')
  expect(saas.formatKtvRoomPriceLabel(pricing)).toBe('¥70.00/小时')
  // 按房型（roomTypeId / roomTypeCode）查缓存都能命中同一份价
  expect(saas.ktvPricingFor({ roomTypeCode: '001' })).toBe(pricing)

  // 历史行（只有 resourceId、没设房型）仍按包厢取价、回退门店统一价（不动既有口径）
  await saas.resolveKtvRoomPricing([{ roomTypeCode: '', id: 1001 }])
  expect(saas.formatKtvRoomPriceLabel(saas.ktvPricingFor({ id: 1001 }))).toBe('¥125.00/小时 · 门店统一价')

  // 页面侧：房型卡片价格统一走合计口径，源码里不得直接使用房型单价字段
  const pageCode = stripComments(await readRepo('c-end/app.js'))
  expect(pageCode).toContain('ktvRoomTypePriceShort(roomType)')
  expect(pageCode).toContain("return text ? '合计 ' + text : ''")
  expect(pageCode).not.toContain('roomUnitPrice')
})

// —— 4. 房型列表来源：直接读后台房型字典，读不到时按资源归并降级 ——

test('房型列表读 /admin/resources/types；读不到时按资源列表归并（包厢号不得冒充房型）', async () => {
  const types = [{ id: 7, code: '001', name: '小包', capacity: 4, status: 'ACTIVE', storeId: 100 }]
  const directFetch = vi.fn().mockResolvedValue(jsonResponse(types))
  const { saas } = await loadSaas(directFetch)

  const roomTypes = await saas.listKtvRoomTypes()

  expect(String(directFetch.mock.calls[0][0])).toBe('https://admin.dev.example.com/api/v1/admin/resources/types')
  expect(roomTypes).toEqual([
    // imageUrl / imageUrls：房型图片（后台「房型管理」上传），字典路径没配图时由包厢归并补齐 /
    // 保持空数组；此处无包厢数据故为空
    // areaName：位置同样按包厢归并补齐（字典不带），无包厢数据时为空串，页面据此整行不渲染
    { roomTypeId: 7, roomTypeCode: '001', name: '小包', capacity: 4, status: 'ACTIVE', storeId: 100, imageUrl: '', imageUrls: [], areaName: '', available: true },
  ])
  expect(saas.isKtvRoomTypeBookable(roomTypes[0])).toBe(true)
  // 不可预约原因是中文（不得把 status 枚举直出页面）
  expect(saas.ktvRoomTypeUnavailableReason({ roomTypeId: 9, status: 'DISABLED', available: false })).toBe('该包厢类型已停用')
  expect(saas.ktvRoomTypeUnavailableReason({ roomTypeId: 9, status: '', available: false })).toBe('暂无可分配包厢')

  // 房型字典不可读（403 / 后台路径被收紧）→ 既有降级：按 /business/resources 归并房型
  const degradedFetch = vi.fn().mockImplementation(async (url) => {
    if (String(url).includes('/admin/resources/types')) {
      return { ok: false, status: 403, text: async () => '{"code":"FORBIDDEN"}' }
    }
    return jsonResponse([
      { id: 1001, name: '仙域', capacity: 4, available: true, roomTypeId: 7, roomTypeCode: '001', roomTypeName: '小包' },
      { id: 1013, name: '超大包 K16', capacity: 16, available: false, roomTypeId: 7, roomTypeCode: '001', roomTypeName: '小包' },
      { id: 1002, name: '小包 K02', capacity: 4, available: true },
    ])
  })
  const degraded = await loadSaas(degradedFetch)

  const fallbackTypes = await degraded.saas.listKtvRoomTypes()

  expect(fallbackTypes).toHaveLength(1)
  expect(fallbackTypes[0]).toMatchObject({ roomTypeId: 7, roomTypeCode: '001', name: '小包', available: true })
  // 未设房型的包厢不参与归并：否则「小包 K02」这样的包厢名会被当成房型
  expect(fallbackTypes[0].name).not.toContain('K02')
  expect(degraded.warnings.join('\n')).toContain('房型字典不可读')
})

// —— 5. 错误码中文化（C 端 + B 端）——

const ROOM_TYPE_CODES = [
  'ROOM_TYPE_REQUIRED',
  'ROOM_TYPE_INVALID',
  'ROOM_TYPE_DISABLED',
  'RESOURCE_ID_NOT_ALLOWED',
  'ROOM_TYPE_NO_ROOM_AVAILABLE',
  'ROOM_TYPE_FULL',
]

test('C 端房型错误码全部中文化：不弹裸码 / 英文原文', async () => {
  const source = await readRepo('c-end/api-errors.js')
  const window = {}
  vm.runInNewContext(source, { window })
  const describe = window.A380ApiErrors.describe

  for (const code of ROOM_TYPE_CODES) {
    const text = describe({ status: 400, payload: { code, message: 'Room type not available' } })
    expect(text, code).toMatch(/[\u4e00-\u9fff]/)
    expect(text, code).not.toContain(code)
    expect(text, code).not.toMatch(/[A-Za-z]{4,}/)
  }
  // 房型已满 / 无可用包厢 → 引导改选其它房型或时段
  expect(describe({ code: 'ROOM_TYPE_FULL' })).toContain('改选')
  expect(describe({ code: 'ROOM_TYPE_NO_ROOM_AVAILABLE' })).toContain('改选')
  expect(describe({ code: 'ROOM_TYPE_NO_ROOM_AVAILABLE' })).toContain('包厢类型')
  // 不可传包厢号
  expect(describe({ code: 'RESOURCE_ID_NOT_ALLOWED' })).toContain('具体包厢')
  expect(describe({ code: 'ROOM_TYPE_REQUIRED' })).toContain('包厢类型')
  expect(describe({ code: 'ROOM_TYPE_DISABLED' })).toContain('停用')
  // 服务端把错误码当 message 回传时也不得直出
  expect(describe({ code: 'ROOM_TYPE_FULL', payload: { code: 'ROOM_TYPE_FULL', message: 'ROOM_TYPE_FULL' } }))
    .not.toContain('ROOM_TYPE_FULL')
})

test('B 端房型错误码全部中文化（axios 错误体），与 C 端同一组码', () => {
  for (const code of ROOM_TYPE_CODES) {
    expect(CODE_MESSAGES[code], code).toBeTruthy()
    const error = { response: { status: 400, data: { code, message: 'Room type error' } } }
    expect(codeOf(error)).toBe(code)
    const text = resolveApiErrorMessage(error)
    expect(text, code).toMatch(/[\u4e00-\u9fff]/)
    expect(text, code).not.toContain(code)
    expect(text, code).not.toMatch(/[A-Za-z]{4,}/)
  }
  expect(CODE_MESSAGES.ROOM_TYPE_FULL).toContain('改选')
  expect(CODE_MESSAGES.RESOURCE_ID_NOT_ALLOWED).toContain('具体包厢')
})

// —— 6. 历史行（只有 resourceId 无房型）渲染回退 ——

test('历史预约行（只有 resourceId 无房型）回退旧包厢名并标注「历史预约」', async () => {
  const source = await readRepo('c-end/reservation-room.js')
  const window = {}
  vm.runInNewContext(source, { window })
  const api = window.A380ReservationRoom

  // 历史行：迁移前只有 resourceId / resourceName（预约的就是具体包厢）
  const historical = { id: 9, resourceId: 1001, resourceName: '仙域', roomTypeId: null, roomTypeCode: null, roomTypeName: null }
  expect(api.roomTypeLabel(historical)).toEqual({ text: '仙域', historical: true })
  expect(api.isHistorical(historical)).toBe(true)
  expect(api.allocationText(historical)).toBe('已分配：仙域')
  // 历史行连 resourceName 都没有时退回包厢号，并保留历史标注
  expect(api.roomTypeLabel({ id: 9, resourceId: 1005 })).toEqual({ text: '包厢 #1005', historical: true })

  // 新预约：只有房型、没有具体包厢，提示到店后由门店分配
  const current = { id: 12, roomTypeId: 7, roomTypeName: '小包', roomTypeCode: '001', resourceId: null }
  expect(api.roomTypeLabel(current)).toEqual({ text: '小包', historical: false })
  expect(api.roomTypeLabel(current).historical).toBe(false)
  expect(api.allocationText(current)).toBe('到店后由门店分配包厢')
  // 房型名回退房型编码；到店分配后（resourceId 有值）才算已分配，且仍是房型单
  expect(api.roomTypeLabel({ roomTypeId: 8, roomTypeCode: 'BIG' })).toEqual({ text: 'BIG', historical: false })
  expect(api.allocationText({ roomTypeId: 8, roomTypeName: '大包', resourceId: 1005 }, { name: '大包 K12' }))
    .toBe('已分配：大包 K12')

  // 页面把回退口径接上：房型名 + 历史标注 + 包厢分配提示
  const appCode = stripComments(await readRepo('c-end/app.js'))
  expect(appCode).toContain('A380ReservationRoom.roomTypeLabel(r, room)')
  expect(appCode).toContain('A380ReservationRoom.allocationText(r, room)')
  expect(appCode).toContain('A380ReservationRoom.HISTORICAL_TEXT')
  // 预约列表按房型取价（历史行才按旧包厢取价）
  expect(appCode).toContain('items.map(reservationPricingRef)')
  // 历史行能从房态反查到房型时，取价也走房型（与房型列表/确认页同口径）
  expect(appCode).toContain('var room = ktvRoomCache[r.resourceId]')
  expect(appCode).toContain('room && room.roomTypeId != null ? room.roomTypeId : null')
})

// —— 7. 三端口径一致 + C 端入口加载新模块 ——

test('C/B 端「房型 + 到店分配」口径一致，C 端入口加载房型展示模块', async () => {
  const [cEnd, bEnd, html] = await Promise.all([
    readRepo('c-end/reservation-room.js'),
    readRepo('src/b-end/views/Reservations.vue'),
    readRepo('c-end/index.html'),
  ])

  for (const [name, source] of [['C 端', cEnd], ['B 端', bEnd]]) {
    expect(source, name).toContain('历史预约')
  }
  expect(cEnd).toContain('到店后由门店分配包厢')
  expect(bEnd).toContain('到店后分配')
  expect(bEnd).toContain('reservation.roomTypeName || reservation.roomTypeCode')
  // B 端不再把预约当成「预订资源（具体包厢）」
  expect(bEnd).not.toContain('预订资源')
  // 预约状态机对齐后端：已确认 + 已分配包厢可直接开台（后端隐含登记到店时间），超时未到可标记「未到店」
  expect(bEnd).toContain('canOpenTable')
  expect(bEnd).toContain('noShowReservation')
  expect(bEnd).toContain('canMarkNoShow')
  // C 端入口必须加载房型/包厢展示模块（且在 app.js 之前）
  expect(html).toContain('./reservation-room.js')
  expect(html.indexOf('reservation-room.js')).toBeLessThan(html.indexOf('app.js'))
})

// —— 8. 选择包厢类型：房型卡片必须带配图（样板包厢照片，无图退门店占位图） ——

test('房型展示图取该房型首个「带图」包厢的主图；多房型不串图；无图退占位图（不出现空 src）', async () => {
  const smallThumb = '/api/v1/media-public/gv-media-public/saas/1001/202609/small.png'
  const bigThumb = '/api/v1/media-public/gv-media-public/saas/1001/202609/big.png'
  const fetch = vi.fn().mockImplementation(async (url) => {
    const target = String(url)
    if (target.includes('/admin/resources/types')) {
      // 房型字典本身不带图 → 只能靠包厢归并补图（老数据路径）
      return jsonResponse([
        { id: 7, code: '001', name: '小包', capacity: 4, status: 'ACTIVE' },
        { id: 8, code: '002', name: '大包', capacity: 15, status: 'ACTIVE' },
        { id: 9, code: '003', name: '无图包', capacity: 6, status: 'ACTIVE' },
      ])
    }
    // /business/resources：同房型的包厢（无图包厢排在最前，验证取「首个**带图**包厢」而不是「第一个包厢」）
    return jsonResponse([
      { id: 1001, name: '仙域', capacity: 4, available: true, roomTypeId: 7, roomTypeCode: '001', roomTypeName: '小包', imageUrls: [], mainImageUrl: null },
      { id: 1002, name: '玲珑', capacity: 4, available: true, roomTypeId: 7, roomTypeCode: '001', roomTypeName: '小包', imageUrls: [smallThumb], mainImageUrl: smallThumb },
      { id: 1012, name: '超大包', capacity: 15, available: true, roomTypeId: 8, roomTypeCode: '002', roomTypeName: '大包', mainImageUrl: bigThumb, imageUrls: [bigThumb] },
      { id: 1021, name: '普通包', capacity: 6, available: true, roomTypeId: 9, roomTypeCode: '003', roomTypeName: '无图包', imageUrls: [], mainImageUrl: null },
    ])
  })
  const { saas } = await loadSaas(fetch)

  const roomTypes = await saas.listKtvRoomTypes()

  // 每个房型各自取自己的样板图，无图房型保持空串（由页面退门店占位图）
  expect(roomTypes.map((type) => type.imageUrl)).toEqual([smallThumb, bigThumb, ''])
  expect(roomTypes[1].imageUrl).not.toBe(roomTypes[0].imageUrl)

  // 卡片取图口径：有样板图用样板图；没有或没有占位图时返回空串（页面再兜底），绝不抛错
  const fallback = './assets/images/ktv-1.png'
  expect(saas.ktvRoomTypeImageUrl({ imageUrl: smallThumb, roomTypeId: 7 }, fallback)).toBe(smallThumb)
  expect(saas.ktvRoomTypeImageUrl({ imageUrl: '', imageUrls: [] }, fallback)).toBe(fallback)
  expect(saas.ktvRoomTypeImageUrl({}, fallback)).toBe(fallback)
  expect(saas.ktvRoomTypeImageUrl(null, fallback)).toBe(fallback)
  expect(saas.ktvRoomTypeImageUrl({}, '')).toBe('')
  // 主图缺失时退回图片列表第一张（与后端「mainImageUrl 必属于 imageUrls」同规则）
  expect(saas.ktvRoomTypeImageUrl({ imageUrls: [smallThumb] }, fallback)).toBe(smallThumb)

  // 资源列表读不到时不得整页失败：房型仍在，只是没有样板图
  const brokenResources = vi.fn().mockImplementation(async (url) => {
    const target = String(url)
    if (target.includes('/admin/resources/types')) return jsonResponse([{ id: 7, code: '001', name: '小包', capacity: 4, status: 'ACTIVE' }])
    return { ok: false, status: 500, text: async () => '{"code":"BOOM"}' }
  })
  const degraded = await loadSaas(brokenResources)
  const degradedTypes = await degraded.saas.listKtvRoomTypes()
  expect(degradedTypes.map((type) => type.roomTypeId)).toEqual([7])
  expect(degradedTypes[0].imageUrl).toBe('')
  expect(degraded.warnings.join('\n')).toContain('房型展示图退回门店占位图')
})

test('源码守卫：包厢类型卡片必须渲染图片（alt=房型名、懒加载、失败退占位图、cover 不拉伸）', async () => {
  const page = stripComments(await readRepo('c-end/app.js'))
  const card = page.slice(page.indexOf('async function renderKtvBooking'), page.indexOf('function renderKtvBookFormFromRoom'))

  // 卡片必须包含图片元素（防止后续被删）
  expect(card).toContain('${roomTypeThumb(roomType)}')
  expect(card).toContain('SAAS.ktvRoomTypeImageUrl(')
  expect(card).toContain('class="package-thumb"')
  expect(card).toContain('data-room-type-image')
  // 无障碍与懒加载
  expect(card).toContain('loading="lazy"')
  expect(card).toMatch(/alt="'\s*\+\s*escapeHtml\(roomType\.name\)/)
  // 加载失败兜底：退回门店占位图，绝不出现破图
  expect(card).toContain('data-room-fallback')
  expect(card).toContain('bindRoomImageFallback(app)')
  // 房型展示图是样板图，文案不得暗示已锁定某个包厢号
  expect(card).not.toContain('包厢号')
  expect(card).not.toContain('已锁定')

  // 固定尺寸 + object-fit: cover（不拉伸变形）
  const css = await readRepo('c-end/styles.css')
  expect(css).toMatch(/\.package-card \.package-thumb \{[^}]*width: \d+px/)
  expect(css).toMatch(/\.package-card \.package-thumb \{[^}]*height: \d+px/)
  expect(css).toMatch(/\.package-card \.package-thumb \{[^}]*object-fit: cover/)
})

// —— 9. 房型自带多图（后台「房型管理」上传，V8__res_room_type_media.sql）——

test('房型自带图优先：多图全集主图在前、去重去空，且不被包厢样板图覆盖', async () => {
  const typeMain = '/api/v1/media-public/gv-media-public/saas/1001/202609/type-main.png'
  const typeSecond = '/api/v1/media-public/gv-media-public/saas/1001/202609/type-2.png'
  const roomThumb = '/api/v1/media-public/gv-media-public/saas/1001/202609/room.png'
  const fetch = vi.fn().mockImplementation(async (url) => {
    const target = String(url)
    if (target.includes('/admin/resources/types')) {
      // 后台已给房型配图：mainImageUrl 是主图，imageUrls 是多图（列表没按主图排在最前，页面要自己归位）
      return jsonResponse([
        { id: 7, code: '001', name: '小包', capacity: 4, status: 'ACTIVE', imageUrls: [typeSecond, typeMain, typeSecond, '  '], mainImageUrl: typeMain },
        { id: 8, code: '002', name: '大包', capacity: 15, status: 'ACTIVE', imageUrls: [], mainImageUrl: null },
      ])
    }
    // 包厢也有图：不得覆盖房型自己的图，只用于「未配图房型」的兜底
    return jsonResponse([
      { id: 1002, name: '玲珑', capacity: 4, available: true, roomTypeId: 7, roomTypeCode: '001', roomTypeName: '小包', imageUrls: [roomThumb], mainImageUrl: roomThumb },
      { id: 1012, name: '超大包', capacity: 15, available: true, roomTypeId: 8, roomTypeCode: '002', roomTypeName: '大包', imageUrls: [roomThumb], mainImageUrl: roomThumb },
    ])
  })
  const { saas } = await loadSaas(fetch)

  const roomTypes = await saas.listKtvRoomTypes()
  const [small, big] = roomTypes

  // 主图 = 房型 mainImageUrl；全集 = 主图在前 + 其余去重去空
  expect(small.imageUrl).toBe(typeMain)
  expect(small.imageUrls).toEqual([typeMain, typeSecond])
  // 未配图房型仍走包厢样板图兜底（老数据不被这次改动弄丢图）
  expect(big.imageUrl).toBe(roomThumb)

  // 纯函数口径：主图缺失时按「主图必须属于列表」取第一张；无图返回空数组，绝不抛错
  expect(saas.ktvRoomTypeImageUrls({ imageUrl: typeMain, imageUrls: [typeSecond, typeMain] })).toEqual([typeMain, typeSecond])
  expect(saas.ktvRoomTypeImageUrls({ imageUrls: [typeSecond] })).toEqual([typeSecond])
  expect(saas.ktvRoomTypeImageUrls({})).toEqual([])
  expect(saas.ktvRoomTypeImageUrls(null)).toEqual([])
  // 卡片主图取值仍走唯一入口（房型图 > 列表首图 > 门店占位图）
  const fallback = './assets/images/ktv-1.png'
  expect(saas.ktvRoomTypeImageUrl({ imageUrl: typeMain, imageUrls: [typeSecond] }, fallback)).toBe(typeMain)
  expect(saas.ktvRoomTypeImageUrl({ imageUrls: [typeSecond] }, fallback)).toBe(typeSecond)
  expect(saas.ktvRoomTypeImageUrl({}, fallback)).toBe(fallback)
})

test('源码守卫：预约确认页用「房型图片全集」，多图出画廊、点击切主图、失败退占位图', async () => {
  const page = stripComments(await readRepo('c-end/app.js'))
  const form = page.slice(page.indexOf('async function renderKtvBookForm('), page.indexOf('function renderVenueReservationSuccess'))

  // 主图与画廊都取房型图片唯一入口，不再无条件用门店图占位
  expect(form).toContain('SAAS.ktvRoomTypeImageUrls(roomType)')
  expect(form).toContain("const roomTypePhoto = roomTypePhotos[0] || roomTypeFallback")
  expect(form).toContain('data-room-gallery')
  expect(form).toContain('data-room-photo=')
  // 图片是房型样板图：不得在文案里点名包厢号
  expect(form).not.toContain('包厢号')
  // 点击缩略图切主图 + 失败退占位图（不出现破图）
  expect(page).toContain('function bindRoomTypeGallery(')
  expect(page).toContain("scope.querySelector('.booking-summary img')")
  expect(form).toContain('bindRoomTypeGallery(app)')
  expect(form).toContain('data-room-fallback')

  // 画廊样式存在且缩略图不拉伸
  const css = await readRepo('c-end/styles.css')
  expect(css).toMatch(/\.booking-gallery \{/)
  expect(css).toMatch(/\.booking-gallery__item img \{[^}]*object-fit: cover/)
})

// —— 10. 我的预约卡片展示「下单时间」（预约单创建时间，与到店时间分开）——

test('源码守卫：我的预约卡片展示下单时间（createdAt）与到店时间（startAt）分开', async () => {
  const page = stripComments(await readRepo('c-end/app.js'))
  const card = page.slice(page.indexOf('function reservationCard'), page.indexOf('function orderCard'))

  // 下单时间：预约单创建时间（用户提交时间），字段缺失（老接口）时不渲染空行
  expect(card).toContain("'<p>下单：'")
  expect(card).toContain('r.createdAt')
  expect(card).toContain('r.createdAt ?')
  // 到店时间仍是预约开始时间，两者不得混用
  expect(card).toContain("'<p>到店：'")
  expect(card).toContain('r.startAt')
  expect(card).not.toContain('formatDateTime(r.createdAt) + \' · \'')

  // 列表接口返回的 PO 带 createdAt（/me/reservations → ReservationPo）
  const saas = stripComments(await readRepo('c-end/saas.js'))
  expect(saas).toContain("request('GET', '/api/v1/me/reservations')")
})
