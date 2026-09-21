import request from './request'

// —— KTV 包厢资源 ——
export function listKtvRooms() {
  return request.get('/api/v1/business/resources', { params: { resourceType: 'KTV_ROOM' } })
}
/** 置包厢清洁状态：清洁中的包厢不可开台、不可预约（结台后自动进入，清洁完成后置回空闲）。 */
export function setRoomCleaningStatus(resourceId, cleaning) {
  return request.put('/api/v1/business/resources/' + resourceId + '/cleaning-status', { cleaning })
}
// —— 门店（B 端，tenant-service）——
export function listStores() {
  return request.get('/api/v1/admin/tenant/stores')
}
// —— 预约 ——
export function listReservations() {
  return request.get('/api/v1/business/reservations')
}
export function createReservation(data) {
  return request.post('/api/v1/business/reservations', data, { headers: { 'Idempotency-Key': reservationKeys.get(data) || remember(reservationKeys, data) } })
}
export function confirmReservation(id, expectedVersion) {
  return request.post('/api/v1/business/reservations/' + id + '/confirm', { expectedVersion })
}
export function arrivalReservation(id, operatorNote) {
  return request.post('/api/v1/business/reservations/' + id + '/arrival', { operatorNote })
}
export function cancelReservation(id, reason) {
  return request.post('/api/v1/business/reservations/' + id + '/cancel', { reason })
}
/**
 * 标记「未到店」（到店前且已过预约开始时间 → NO_SHOW）：释放超时未到预约占的包厢预约位。
 * 未到预约开始时间后端 409 RESERVATION_NOT_STARTED。
 */
export function noShowReservation(id) {
  return request.post('/api/v1/business/reservations/' + id + '/no-show')
}
export function openTable(reservationId, freeWaitMinutes) {
  return request.post('/api/v1/business/reservations/' + reservationId + '/open-table', { freeWaitMinutes })
}
// —— 订单 / KTV 会话 ——
export function listOrders() {
  return request.get('/api/v1/business/orders')
}
/** 客户自助加项的待确认聚合视图（当前门店上下文一次拿全：总数/总额 + 按单分组明细）。 */
export function getPendingApproval() {
  return request.get('/api/v1/business/orders/pending-approval')
}
export function createOrder(data) {
  return request.post('/api/v1/business/orders', data)
}
export function confirmOrder(id) {
  return request.post('/api/v1/business/orders/' + id + '/confirm')
}
export function openSession(sessionId, freeWaitMinutes) {
  return request.post('/api/v1/business/ktv/sessions/' + sessionId + '/open', { freeWaitMinutes })
}
export function closeSession(sessionId) {
  return request.post('/api/v1/business/ktv/sessions/' + sessionId + '/close')
}
export function getOrderSession(orderId) {
  return request.get('/api/v1/business/orders/' + orderId + '/session')
}
export function listCatalogItems(storeId) {
  return request.get('/api/v1/business/catalog/items', { params: { storeId } })
}
export function addOrderItem(orderId, data) {
  return request.post('/api/v1/business/orders/' + orderId + '/items', data)
}
export function listOrderItems(orderId) {
  return request.get('/api/v1/business/orders/' + orderId + '/items')
}
export function confirmOrderItem(orderId, itemId) {
  return request.post('/api/v1/business/orders/' + orderId + '/items/' + itemId + '/confirm')
}
export function rejectOrderItem(orderId, itemId) {
  return request.post('/api/v1/business/orders/' + orderId + '/items/' + itemId + '/reject')
}
export function settleOrder(orderId, expectedVersion) {
  return request.post('/api/v1/business/orders/' + orderId + '/settle', { expectedVersion })
}
export function collect(orderId, data) {
  const key = data?.idempotencyKey || collectKeys.get(orderId) || uuid()
  collectKeys.set(orderId, key)
  return request.post('/api/v1/business/orders/' + orderId + '/collect', data, { headers: { 'Idempotency-Key': key } })
}

const reservationKeys = new WeakMap()
const collectKeys = new Map()
function remember(map, value) {
  const key = uuid()
  map.set(value, key)
  return key
}
export function getBill(orderId) {
  return request.get('/api/v1/business/orders/' + orderId + '/bill')
}
// —— 会员钱包 ——
export function getWallet(memberId) {
  return request.get('/api/v1/business/members/' + memberId + '/wallet')
}
export function getMemberPoints(memberId) {
  return request.get('/api/v1/business/members/' + memberId + '/points')
}
/** 会员检索（储值/积分收款需指定会员）。 */
export function listMembers(keyword, pageSize = 10) {
  return request.get('/api/v1/business/members', { params: { page: 1, pageSize, keyword } })
}
/**
 * 支付方式可用性（与后台授权口径一致）：
 * view=admin 为租户授权视角（B 端收银），view=user 为用户可见视角（C 端支付）。
 * 返回 [{ method, tenantAllowed, userVisible }]，未授权的方式不能出现在收银台。
 */
export function listPaymentMethods(view = 'admin') {
  return request.get('/api/v1/business/payment-methods', { params: { view } })
}
/**
 * 租户储值配置（品牌展示名 wallet_brand_name + 主单位↔代币比例 wallet_ratio），
 * 按规范账单/支付/充值各端统一展示该值，不硬编码「A380币」。
 */
export function getWalletTokenConfig(tenantId) {
  return request.get('/api/v1/admin/tenant/config', { params: { tenantId } })
}
/**
 * KTV 计价方案（包厢价格：最小货币单位整数 + 计费单位/递增粒度/展示文案）。
 * 与后台「计价方案」同源，预约/开台页用它展示包厢价格。
 */
export function getKtvPricing(storeId) {
  return request.get('/api/v1/business/ktv/pricing', { params: { storeId } })
}

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
