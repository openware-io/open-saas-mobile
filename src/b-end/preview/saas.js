import { getCurrency } from '../../shared/utils/money'

const reservations = [
  {
    id: 1001,
    reservationNo: 'A38020260914001',
    status: 'PENDING',
    resourceId: 101,
    startAt: '2026-09-14T19:30:00',
    partySize: 6,
    contact: '陈女士 138****6688',
    version: 1,
  },
  {
    id: 1002,
    reservationNo: 'A38020260914002',
    status: 'CONFIRMED',
    resourceId: 108,
    startAt: '2026-09-14T20:00:00',
    partySize: 10,
    contact: '林先生 186****3800',
    version: 2,
  },
  {
    id: 1003,
    reservationNo: 'A38020260914003',
    status: 'ARRIVED',
    resourceId: 112,
    startAt: '2026-09-14T18:30:00',
    partySize: 12,
    contact: '周女士 139****1024',
    version: 3,
  },
  {
    id: 1004,
    reservationNo: 'A38020260913008',
    status: 'CANCELLED',
    resourceId: 103,
    startAt: '2026-09-13T21:00:00',
    partySize: 4,
    contact: '王先生 137****5210',
    version: 2,
  },
]

// 房态看板缩略图：preview 模式没有后端媒体，用内联 SVG 让「有图」分支可见；
// 「派对大包」故意无图，覆盖占位块分支。
const PREVIEW_ROOM_THUMB = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="12" fill="#eef1ff"/><text x="48" y="62" font-size="40" text-anchor="middle">🎤</text></svg>')

const rooms = [
  { id: 101, resourceCode: 'K01', name: '星空小包', capacity: 6, available: true, state: 'IDLE',
    imageUrls: [PREVIEW_ROOM_THUMB], mainImageUrl: PREVIEW_ROOM_THUMB, description: '星空顶小包，适合 6 人以内聚会' },
  { id: 108, resourceCode: 'K08', name: '鎏金中包', capacity: 10, available: true, state: 'IDLE',
    imageUrls: [PREVIEW_ROOM_THUMB], mainImageUrl: PREVIEW_ROOM_THUMB, description: '带独立吧台中包' },
  { id: 112, resourceCode: 'K12', name: '派对大包', capacity: 16, available: false, state: 'CLEANING',
    imageUrls: [], mainImageUrl: null, description: null },
]

const orders = [
  { id: 2001, orderNo: 'ORD20260914001', storeId: 1, businessType: 'KTV', status: 'DRAFT', totalAmount: 12800, version: 1, sessionId: 3001 },
  { id: 2002, orderNo: 'ORD20260914002', storeId: 1, businessType: 'KTV', status: 'SERVING', totalAmount: 56800, version: 3, sessionId: 3002 },
  { id: 2003, orderNo: 'ORD20260914003', storeId: 1, businessType: 'KTV', status: 'WAITING_SETTLEMENT', totalAmount: 88600, version: 5, sessionId: 3003 },
  { id: 2004, orderNo: 'ORD20260914004', storeId: 1, businessType: 'KTV', status: 'WAITING_PAYMENT', totalAmount: 42800, version: 6, sessionId: 3004 },
  { id: 2005, orderNo: 'ORD20260913012', storeId: 1, businessType: 'KTV', status: 'COMPLETED', totalAmount: 108800, version: 8, sessionId: 3005 },
]

const sessions = new Map([
  [2001, { id: 3001, orderId: 2001, status: 'PENDING' }],
  [2002, { id: 3002, orderId: 2002, status: 'OPEN' }],
  [2003, { id: 3003, orderId: 2003, status: 'CLOSED' }],
  [2004, { id: 3004, orderId: 2004, status: 'CLOSED' }],
  [2005, { id: 3005, orderId: 2005, status: 'CLOSED' }],
])

const bills = new Map([
  [2002, { roomFee: { amount: 36800 }, items: [{ name: '果盘', quantity: 1, amount: 12800 }, { name: '气泡水', quantity: 4, amount: 7200 }], totalAmount: 56800 }],
  [2003, { roomFee: { amount: 56800 }, items: [{ name: '派对套餐', quantity: 1, amount: 31800 }], totalAmount: 88600 }],
])

const orderItems = new Map([
  [2002, [{ id: 5001, status: 'PENDING_APPROVAL', nameSnapshot: '精酿啤酒', quantity: 6, totalAmount: 10800 }]],
])

// 点单目录缩略图：与后端同契约（网关同源相对路径 /api/v1/media-public/... 或内联 data URI，绝不拼域名）。
// preview 模式下没有后端媒体，用内联 SVG 让「有图」分支可见；「气泡水」故意无图，覆盖占位分支。
const PREVIEW_THUMB = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="12" fill="#fff1ea"/><text x="48" y="60" font-size="38" text-anchor="middle">🍹</text></svg>')

const catalogItems = [
  { id: 401, name: '缤纷果盘', unitPrice: 12800, unit: '份', imageUrls: [PREVIEW_THUMB], mainImageUrl: PREVIEW_THUMB },
  { id: 402, name: '精酿啤酒', unitPrice: 1800, unit: '瓶', imageUrls: [PREVIEW_THUMB], mainImageUrl: PREVIEW_THUMB },
  { id: 403, name: '气泡水', unitPrice: 1800, unit: '瓶', imageUrls: [], mainImageUrl: null },
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function findOrder(id) {
  return orders.find((item) => item.id === Number(id))
}

function findReservation(id) {
  return reservations.find((item) => item.id === Number(id))
}

export async function listKtvRooms() {
  return clone(rooms)
}

export async function listStores() {
  // 门店币种由租户币种写穿（tnt_store.default_currency）：预览态取全局当前币种，不写死币种码
  const currencyCode = getCurrency()
  return [
    { id: 1, code: 'A380-SH-001', name: 'A380 上海旗舰店', businessType: 'KTV', defaultCurrency: currencyCode, status: 'ENABLED' },
    { id: 2, code: 'A380-HZ-001', name: 'A380 杭州湖滨店', businessType: 'KTV', defaultCurrency: currencyCode, status: 'ENABLED' },
  ]
}

export async function listReservations() {
  return clone(reservations)
}

export async function createReservation(data) {
  const reservation = { id: Date.now(), reservationNo: 'PREVIEW-' + Date.now(), status: 'PENDING', version: 1, ...data }
  reservations.unshift(reservation)
  return clone(reservation)
}

export async function confirmReservation(id) {
  const reservation = findReservation(id)
  if (reservation) reservation.status = 'CONFIRMED'
  return clone(reservation)
}

export async function arrivalReservation(id) {
  const reservation = findReservation(id)
  if (reservation) reservation.status = 'ARRIVED'
  return clone(reservation)
}

export async function cancelReservation(id) {
  const reservation = findReservation(id)
  if (reservation) reservation.status = 'CANCELLED'
  return clone(reservation)
}

/** 标记未到店：与真实后端一致（到店前且已过预约开始时间 → NO_SHOW）。 */
export async function noShowReservation(id) {
  const reservation = findReservation(id)
  if (reservation) reservation.status = 'NO_SHOW'
  return clone(reservation)
}

export async function openTable(id) {
  const reservation = findReservation(id)
  // 与真实后端同口径：开台后预约进入 CONVERTED（历史 preview 写成 COMPLETED，与枚举不符已纠正）。
  if (reservation) {
    reservation.status = 'CONVERTED'
    reservation.orderId = reservation.orderId || Date.now()
  }
  return clone(reservation)
}

export async function listOrders() {
  return clone(orders)
}

export async function createOrder(data) {
  const id = Date.now()
  const order = {
    id,
    orderNo: 'PREVIEW-' + id,
    storeId: 1,
    businessType: data.businessType || 'KTV',
    status: 'DRAFT',
    totalAmount: 0,
    version: 1,
    sessionId: id + 1,
  }
  orders.unshift(order)
  sessions.set(id, { id: order.sessionId, orderId: id, status: 'PENDING' })
  return clone(order)
}

export async function confirmOrder(id) {
  const order = findOrder(id)
  if (order) order.status = 'SERVING'
  return clone(order)
}

export async function openSession(sessionId) {
  const session = [...sessions.values()].find((item) => item.id === Number(sessionId))
  if (session) {
    session.status = 'OPEN'
    const order = findOrder(session.orderId)
    if (order) order.status = 'SERVING'
  }
  return clone(session)
}

export async function closeSession(sessionId) {
  const session = [...sessions.values()].find((item) => item.id === Number(sessionId))
  if (session) {
    session.status = 'CLOSED'
    const order = findOrder(session.orderId)
    if (order) order.status = 'WAITING_SETTLEMENT'
  }
  return clone(session)
}

export async function getOrderSession(orderId) {
  return clone(sessions.get(Number(orderId)) || null)
}

export async function listCatalogItems() {
  return clone(catalogItems)
}

export async function addOrderItem(orderId, data) {
  const item = catalogItems.find((entry) => entry.id === Number(data.catalogItemId))
  if (!item) return null
  const bill = bills.get(Number(orderId)) || { roomFee: { amount: 0 }, items: [], totalAmount: 0 }
  const amount = Math.round(item.unitPrice * Number(data.quantity))
  bill.items.push({ name: item.name, quantity: Number(data.quantity), amount })
  bill.totalAmount += amount
  bills.set(Number(orderId), bill)
  const order = findOrder(orderId)
  if (order) order.totalAmount = bill.totalAmount
  return clone(bill)
}

export async function listOrderItems(orderId) {
  return clone(orderItems.get(Number(orderId)) || [])
}

export async function confirmOrderItem(orderId, itemId) {
  const items = orderItems.get(Number(orderId)) || []
  const item = items.find((entry) => entry.id === Number(itemId))
  if (item) item.status = 'CONFIRMED'
  return clone(item)
}

export async function rejectOrderItem(orderId, itemId) {
  const items = orderItems.get(Number(orderId)) || []
  const item = items.find((entry) => entry.id === Number(itemId))
  if (item) item.status = 'REJECTED'
  return clone(item)
}

/** 待确认加项聚合视图：与真实契约同字段（preview 由同一份 orderItems 聚合而来）。 */
export async function getPendingApproval() {
  const groups = []
  let pendingCount = 0
  let pendingAmount = 0
  let revision = 0
  for (const [orderId, items] of orderItems) {
    const pending = items.filter((item) => item.status === 'PENDING_APPROVAL')
    if (!pending.length) continue
    const order = findOrder(orderId) || {}
    const room = rooms.find((entry) => entry.id === order.resourceId) || {}
    const amount = pending.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0)
    groups.push({
      orderId,
      orderNo: order.orderNo || '#' + orderId,
      storeId: order.storeId,
      roomName: room.name || '',
      roomCode: room.resourceCode || '',
      sessionStatus: (sessions.get(Number(orderId)) || {}).status || '',
      orderElapsedSeconds: 0,
      pendingCount: pending.length,
      pendingAmount: amount,
      items: clone(pending).map((item) => ({
        id: item.id,
        name: item.nameSnapshot,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.totalAmount,
        currencyCode: getCurrency(),
        createdAt: null,
      })),
    })
    pendingCount += pending.length
    pendingAmount += amount
    for (const item of pending) revision = Math.max(revision, Number(item.id) || 0)
  }
  return { pendingCount, pendingAmount, currencyCode: getCurrency(), mixedCurrency: false, revision, serverTimeMillis: Date.now(), orders: groups }
}

export async function settleOrder(id) {
  const order = findOrder(id)
  if (order) order.status = 'WAITING_PAYMENT'
  return clone(order)
}

export async function collect(id) {
  const order = findOrder(id)
  if (order) order.status = 'COMPLETED'
  return clone(order)
}

export async function getBill(orderId) {
  return clone(bills.get(Number(orderId)) || { roomFee: { amount: 0 }, items: [], totalAmount: 0 })
}

export async function getWallet() {
  // 钱包账户币种不写死：与全站当前币种同源
  return { availableAmount: 888800, frozenAmount: 0, currencyCode: getCurrency() }
}

export async function getMemberPoints() {
  return { customerId: 9001, availablePoints: 26800, frozenPoints: 0 }
}

export async function listMembers(keyword) {
  const members = [
    { id: 9001, memberNo: 'M9001', name: '预览会员', phone: '13800138000' },
    { id: 9002, memberNo: 'M9002', name: '预览会员二', phone: '13900139000' },
  ]
  if (!keyword) return members
  return members.filter((member) => member.phone.includes(keyword) || member.memberNo.includes(keyword))
}

export async function listPaymentMethods() {
  return [
    { method: 'CASH', tenantAllowed: true, userVisible: true },
    { method: 'WALLET', tenantAllowed: true, userVisible: true },
    { method: 'POINT', tenantAllowed: true, userVisible: true },
    { method: 'ALIPAY', tenantAllowed: false, userVisible: false },
    { method: 'WECHAT', tenantAllowed: false, userVisible: false },
    { method: 'STRIPE', tenantAllowed: false, userVisible: false },
  ]
}

export async function getWalletTokenConfig() {
  return { brandName: 'A380币', ratio: 100 }
}
