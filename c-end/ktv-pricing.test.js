import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { expect, test, vi } from 'vitest'

/**
 * C 端「任选包厢」价格契约：必须展示**该包厢（其房型）的生效价**，不能所有包厢共用一个门店价。
 * 取值顺序与后端一致：res_room_type.unit_price（房型字典价）> 计价方案按房型价 > 门店级 roomUnitPrice。
 */

/** 后端 /business/resources 只回房型编码（不回单价），房型单价要按包厢带 resourceId 取。 */
const ROOM_TYPE_OF_RESOURCE = {
  1004: 'MID', 1104: 'MID', 1204: 'MID',
  1005: 'BIG', 1105: 'BIG',
}
const ROOM_TYPE_PRICE = { MID: 18800, BIG: 28800 }
const ROOM_TYPE_NAME = { MID: '中包', BIG: '大包' }
/** 门店级计价方案：¥100.00/小时（线上缺陷里所有包厢都显示的那一个价）。 */
const STORE_LEVEL = {
  billingUnit: 'HOUR', roomUnitPrice: 10000, incrementMinutes: 30, roundingDirection: 'CONSUMER_FAVOR',
  defaultSessionMinutes: 120, overtimeRate: 1.5, serverPricePerInc: 5000, fromTenantPlan: true,
  unitPriceByRoomType: {}, appliedRoomTypeCode: null, appliedRoomTypeName: null, roomTypePriceApplied: false,
  displayText: '¥100.00/小时 · 30 分钟递增 · 每 30 分钟 ¥50.00 · 标准 2.0 小时',
}

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data }
}

/** 按 resourceId 返回该包厢的生效价；不带 resourceId 即门店级方案。 */
function pricingFetch() {
  return vi.fn().mockImplementation(async (url) => {
    const resourceId = new URL(String(url)).searchParams.get('resourceId')
    if (resourceId == null) return jsonResponse(STORE_LEVEL)
    const code = ROOM_TYPE_OF_RESOURCE[resourceId]
    if (!code) return jsonResponse(STORE_LEVEL)
    const price = ROOM_TYPE_PRICE[code]
    return jsonResponse({
      billingUnit: 'HOUR', roomUnitPrice: price, appliedRoomTypeCode: code,
      appliedRoomTypeName: ROOM_TYPE_NAME[code], roomTypePriceApplied: true,
      displayText: `¥${(price / 100).toFixed(2)}/小时 · 房型「${ROOM_TYPE_NAME[code]}」生效单价`,
    })
  })
}

/** 后端按新口径返回：房型单价 + 服务单价 + 合计（每计费单位）。 */
function pricingFetchWithServerPrice() {
  return vi.fn().mockImplementation(async (url) => {
    const resourceId = new URL(String(url)).searchParams.get('resourceId')
    if (resourceId == null) return jsonResponse(STORE_LEVEL)
    return jsonResponse({
      billingUnit: 'HOUR', roomUnitPrice: 18800, serverUnitPrice: 5000, combinedUnitPrice: 23800,
      appliedRoomTypeCode: 'MID', appliedRoomTypeName: '中包', roomTypePriceApplied: true,
      displayText: '¥238.00/小时（房型 ¥188.00 + 服务 ¥50.00）· 30 分钟递增 · 标准 2.0 小时',
    })
  })
}

async function loadSaas(fetch) {
  const moneySource = await readFile(new URL('./money.js', import.meta.url), 'utf8')
  const source = await readFile(new URL('./saas.js', import.meta.url), 'utf8')
  const window = {
    location: { origin: 'https://admin.dev.example.com', hostname: 'admin.dev.example.com' },
    A380OAuth: { refreshContext: vi.fn() },
  }
  const context = { window, fetch, console, crypto: { randomUUID: () => 'request-id' } }
  vm.runInNewContext(moneySource, context)
  vm.runInNewContext(source, context)
  window.SAAS.activate()
  // 本文件断言的是「数字与口径」，符号统一按 CNY 记录（切币种只改符号，见 currency.test.js）
  window.SAAS.setCurrency('CNY')
  return window.SAAS
}

/** 房型价命中 → 用该房型价；未设房型 → 回退门店统一价（并标注）。 */
test('包厢取价：命中房型价用该房型价，未设房型回退门店统一价', async () => {
  const fetch = pricingFetch()
  const saas = await loadSaas(fetch)

  const pricing = await saas.resolveKtvRoomPricing([
    { id: 1004, roomTypeCode: 'MID' },
    { id: 1005, roomTypeCode: 'BIG' },
    { id: 1003 },
  ])

  // 两个不同房型的包厢显示不同价，不再是同一个门店价
  expect(saas.formatKtvRoomPriceLabel(pricing[1004])).toBe('¥188.00/小时')
  expect(saas.formatKtvRoomPriceLabel(pricing[1005])).toBe('¥288.00/小时')
  // 未设房型的包厢才回退门店统一价，文案与后端「未定价，回退门店单价」同口径
  expect(saas.formatKtvRoomPriceLabel(pricing[1003])).toBe('¥100.00/小时 · 门店统一价')
  expect(pricing[1004].roomTypePriceApplied).toBe(true)
  expect(pricing[1003].roomTypePriceApplied).toBe(false)
})

/** 同房型只请求一次：按 roomTypeCode 归并（代表包厢带 resourceId）+ resourceId/roomTypeCode 双键缓存。 */
test('同房型包厢只请求一次，且不带 roomTypeCode 单独取价（会漏掉房型字典价）', async () => {
  const fetch = pricingFetch()
  const saas = await loadSaas(fetch)

  const pricing = await saas.resolveKtvRoomPricing([
    { id: 1004, roomTypeCode: 'MID' },
    { id: 1104, roomTypeCode: 'MID' },
    { id: 1005, roomTypeCode: 'BIG' },
    { id: 1105, roomTypeCode: 'BIG' },
  ])

  // 4 个包厢 2 个房型 → 只有 2 次请求（每次都用代表包厢的 resourceId）
  const urls = fetch.mock.calls.map((call) => String(call[0])).sort()
  expect(urls).toEqual([
    'https://admin.dev.example.com/api/v1/business/ktv/pricing?resourceId=1004',
    'https://admin.dev.example.com/api/v1/business/ktv/pricing?resourceId=1005',
  ])
  // 同房型的第二个包厢直接复用房型价
  expect(pricing[1104]).toBe(pricing[1004])
  expect(saas.formatKtvRoomPrice(pricing[1104])).toBe('¥188.00/小时')
  expect(saas.formatKtvRoomPrice(pricing[1105])).toBe('¥288.00/小时')

  // 再次渲染（同房型的其他包厢）命中缓存，不再发请求
  const again = await saas.resolveKtvRoomPricing([{ id: 1204, roomTypeCode: 'MID' }])
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(saas.formatKtvRoomPrice(again[1204])).toBe('¥188.00/小时')
})

/** 列表已带房型字典单价（未来后端在 /business/resources 回传）时零额外房型请求。 */
test('/business/resources 已回传 roomTypeUnitPrice 时按该单价展示，不再逐房型取价', async () => {
  const fetch = pricingFetch()
  const saas = await loadSaas(fetch)

  const pricing = await saas.resolveKtvRoomPricing([
    { id: 2001, roomTypeCode: 'MID', roomTypeUnitPrice: 18800 },
    { id: 2002, roomTypeCode: 'BIG', roomTypeUnitPrice: 28800 },
  ])

  // 只取一次门店级方案拿计价单位（房型单价直接用列表自带值）
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(String(fetch.mock.calls[0][0])).toBe('https://admin.dev.example.com/api/v1/business/ktv/pricing')
  expect(saas.formatKtvRoomPrice(pricing[2001])).toBe('¥188.00/小时')
  expect(saas.formatKtvRoomPrice(pricing[2002])).toBe('¥288.00/小时')
})

/** 金额口径：后端「分」→「¥ X/小时」，单位按 billingUnit；无有效单价返回空串（页面退回「免支付」）。 */
test('金额分→元格式：「¥ X/小时」，单位按 billingUnit', async () => {
  const saas = await loadSaas(vi.fn())

  expect(saas.formatKtvRoomPrice({ roomUnitPrice: 12800, billingUnit: 'HOUR' })).toBe('¥128.00/小时')
  expect(saas.formatKtvRoomPrice({ roomUnitPrice: 18800, billingUnit: 'HOUR' })).toBe('¥188.00/小时')
  expect(saas.formatKtvRoomPrice({ roomUnitPrice: 12800, billingUnit: 'HALF_HOUR' })).toBe('¥128.00/半小时')
  expect(saas.formatKtvRoomPrice({ roomUnitPrice: 128000, billingUnit: 'PACKAGE' })).toBe('¥1,280.00/套餐')
  expect(saas.formatKtvRoomPrice({ roomUnitPrice: 0, billingUnit: 'HOUR' })).toBe('')
  expect(saas.formatKtvRoomPrice(null)).toBe('')

  // 回退门店价的标注与后端 displayText 的「未定价，回退门店单价」同一判断依据
  expect(saas.formatKtvRoomPriceLabel({ roomUnitPrice: 10000, billingUnit: 'HOUR', roomTypePriceApplied: false }))
    .toBe('¥100.00/小时 · 门店统一价')
  expect(saas.formatKtvRoomPriceLabel({ roomUnitPrice: 18800, billingUnit: 'HOUR', roomTypePriceApplied: true }))
    .toBe('¥188.00/小时')
})

/** 服务单价为 0（未配置服务人员价）：合计等于房型价，展示端不得出现「+ ¥0.00」。 */
test('服务单价为 0：不出现「+ ¥0.00」，合计就是房型单价', async () => {
  const saas = await loadSaas(vi.fn())

  const zeroServer = {
    billingUnit: 'HOUR', roomUnitPrice: 18800, serverUnitPrice: 0, combinedUnitPrice: 18800,
    roomTypePriceApplied: true,
  }
  expect(saas.formatKtvRoomPrice(zeroServer)).toBe('¥188.00/小时')
  expect(saas.formatKtvRoomPriceBreakdown(zeroServer)).toBe('')
  expect(saas.formatKtvRoomPriceLabel(zeroServer)).not.toContain('+')
})

/** 结算单价（分）统一口径：优先后端 combinedUnitPrice = 房型 + 服务，缺失/为 0 时退回房型单价。 */
test('合计单价取 combinedUnitPrice，缺失时退回 roomUnitPrice', async () => {
  const saas = await loadSaas(vi.fn())

  expect(saas.ktvCombinedUnitPrice({ roomUnitPrice: 18800, serverUnitPrice: 5000, combinedUnitPrice: 23800 })).toBe(23800)
  expect(saas.ktvCombinedUnitPrice({ roomUnitPrice: 18800, combinedUnitPrice: 0 })).toBe(18800)
  expect(saas.ktvCombinedUnitPrice({ roomUnitPrice: 18800 })).toBe(18800)
  expect(saas.ktvCombinedUnitPrice(null)).toBe(0)
})

/** 选包厢列表 / 我的预约卡片：展示「房型 + 服务」的合计价。 */
test('列表卡片展示合计价：房型 188 + 服务 50 = 238', async () => {
  const fetch = pricingFetchWithServerPrice()
  const saas = await loadSaas(fetch)

  const pricing = await saas.resolveKtvRoomPricing([{ id: 3004, roomTypeCode: 'MID' }])

  expect(saas.formatKtvRoomPrice(pricing[3004])).toBe('¥238.00/小时')
  expect(saas.formatKtvRoomPriceLabel(pricing[3004])).toBe('¥238.00/小时')
  expect(pricing[3004].serverUnitPrice).toBe(5000)
  expect(pricing[3004].combinedUnitPrice).toBe(23800)
})

/** 预约确认页：分项 + 合计文案（含 1 名服务人员），金额一律「元」两位小数、单位随 billingUnit。 */
test('预约确认页分项 + 合计：「房型 ¥188.00/小时 + 服务 ¥50.00/小时 = ¥238.00/小时（含 1 名服务人员）」', async () => {
  const saas = await loadSaas(vi.fn())

  expect(saas.formatKtvRoomPriceBreakdown({
    billingUnit: 'HOUR', roomUnitPrice: 18800, serverUnitPrice: 5000, combinedUnitPrice: 23800,
  })).toBe('房型 ¥188.00/小时 + 服务 ¥50.00/小时 = ¥238.00/小时（含 1 名服务人员）')
  expect(saas.formatKtvRoomPriceBreakdown({
    billingUnit: 'HALF_HOUR', roomUnitPrice: 10000, serverUnitPrice: 2500, combinedUnitPrice: 12500,
  })).toBe('房型 ¥100.00/半小时 + 服务 ¥25.00/半小时 = ¥125.00/半小时（含 1 名服务人员）')
  // 后端未返回分项（旧响应）时不臆造分项
  expect(saas.formatKtvRoomPriceBreakdown({ billingUnit: 'HOUR', roomUnitPrice: 18800 })).toBe('')
  expect(saas.formatKtvRoomPriceBreakdown(null)).toBe('')
})

/** 「含 1 名服务人员」与结台口径一致：包厢费基数已含 1 名标准服务人员，第 2 名起另计。 */
test('分项文案写明「含 1 名服务人员」', async () => {
  const saas = await loadSaas(vi.fn())

  const text = saas.formatKtvRoomPriceBreakdown({
    billingUnit: 'HOUR', roomUnitPrice: 3000, serverUnitPrice: 5000, combinedUnitPrice: 8000,
  })
  expect(text).toBe('房型 ¥30.00/小时 + 服务 ¥50.00/小时 = ¥80.00/小时（含 1 名服务人员）')
})

/** 预估费用必须按合计单价算（用 roomUnitPrice 会少算服务单价那一段）。 */
test('预估金额按合计单价计算', async () => {
  const saas = await loadSaas(vi.fn())

  const pricing = { billingUnit: 'HOUR', roomUnitPrice: 18800, serverUnitPrice: 5000, combinedUnitPrice: 23800 }
  expect(saas.estimateKtvRoomFee(pricing, 3)).toBe(71400)          // 23800 × 3
  expect(saas.estimateKtvRoomFee(pricing, 1.5)).toBe(35700)        // 半小时一档
  // 服务单价为 0 时与房型价预估一致（不因合计缺字段而算成 0）
  expect(saas.estimateKtvRoomFee({ roomUnitPrice: 18800, combinedUnitPrice: 18800 }, 2)).toBe(37600)
  expect(saas.estimateKtvRoomFee(null, 3)).toBe(0)
  expect(saas.estimateKtvRoomFee(pricing, 0)).toBe(0)
})

/** C 端三处展示 + 预估都必须走同一份合计口径（列表卡片 / 预约确认页 / 我的预约）。 */
test('app.js 三处展示与预估都走合计口径', async () => {
  const source = await readFile(new URL('./app.js', import.meta.url), 'utf8')

  // 列表卡片与「我的预约」卡片共用 ktvRoomPriceShort（内部走 formatKtvRoomPriceLabel → 合计）
  expect(source).toContain('function ktvRoomPriceShort(room)')
  expect(source).toContain('SAAS.formatKtvRoomPriceLabel(ktvRoomPricing(room))')
  // 预约确认页展示分项 + 合计
  expect(source).toContain('SAAS.formatKtvRoomPriceBreakdown(ktvRoomPricing(room))')
  // 预估费用走合计单价，不得再直接用 roomUnitPrice 相乘
  expect(source).toContain('SAAS.estimateKtvRoomFee(pricing, hours)')
  expect(source).not.toContain('Math.round(unitPrice * hours)')
})

/** 资源视图已回传房型服务单价时，列表直接按「房型 + 服务」合计展示（零额外请求）。 */
test('/business/resources 回传 roomTypeServerUnitPrice 时合计 = 房型 + 服务', async () => {
  const fetch = pricingFetch()
  const saas = await loadSaas(fetch)

  const pricing = await saas.resolveKtvRoomPricing([
    { id: 4001, roomTypeCode: 'MID', roomTypeUnitPrice: 18800, roomTypeServerUnitPrice: 5000 },
  ])

  expect(saas.formatKtvRoomPrice(pricing[4001])).toBe('¥238.00/小时')
  expect(saas.formatKtvRoomPriceBreakdown(pricing[4001]))
    .toBe('房型 ¥188.00/小时 + 服务 ¥50.00/小时 = ¥238.00/小时（含 1 名服务人员）')
})

/** 取价失败只让包厢不展示价格，不阻断整张列表（原来的门店级兜底价不再兜底，避免又显示成统一价）。 */
test('取价失败不阻断列表，仅该包厢无价格文案', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'pricing down' })
  const saas = await loadSaas(fetch)

  const pricing = await saas.resolveKtvRoomPricing([{ id: 1004, roomTypeCode: 'MID' }, { id: 1005, roomTypeCode: 'BIG' }])

  expect(pricing[1004]).toBeUndefined()
  expect(saas.formatKtvRoomPriceLabel(pricing[1004])).toBe('')
})

/** 选包厢列表必须拿到房型：丢掉 roomTypeCode 会让所有包厢一起退回门店统一价（本次缺陷的第二个根因）。 */
test('listKtvRooms 透传房型字段，未设房型的包厢回退为空值', async () => {
  const fetch = vi.fn().mockResolvedValue(jsonResponse([
    { id: 1004, name: '中包 K09', resourceType: 'KTV_ROOM', roomTypeId: 5, roomTypeCode: 'MID', roomTypeName: '中包', roomTypeUnitPrice: 18800 },
    { id: 1003, name: '中包 K08', resourceType: 'KTV_ROOM' },
  ]))
  const saas = await loadSaas(fetch)

  const rooms = await saas.listKtvRooms()

  expect(rooms[0]).toMatchObject({ id: 1004, roomTypeId: 5, roomTypeCode: 'MID', roomTypeName: '中包', roomTypeUnitPrice: 18800 })
  expect(rooms[1]).toMatchObject({ roomTypeId: null, roomTypeCode: '', roomTypeName: '', roomTypeUnitPrice: null })

  // 列表已带房型单价时直接生效（只额外取一次门店方案拿计价单位）
  fetch.mockClear()
  const pricing = await saas.resolveKtvRoomPricing(rooms)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(saas.formatKtvRoomPrice(pricing[1004])).toBe('¥188.00/小时')
})
