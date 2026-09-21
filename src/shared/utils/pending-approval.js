import { formatMoney } from './amount'

/**
 * 「客户待确认加项」聚合视图的纯函数（提醒链路与集中处理面板共用的唯一口径）。
 *
 * C 端客户在小程序 / H5 自助加项后落 `ord_order_item.status = 'PENDING_APPROVAL'`，门店确认后才计入应收。
 * 服务端 `GET /business/orders/pending-approval` 一次给出**当前门店**的待确认总数 / 总额与按单分组明细：
 *  - `pendingCount` / `pendingAmount` 是当前门店口径，前端不传参；
 *  - `currencyCode` 只在命中行币种一致时给出；混币种时为空且 `mixedCurrency = true`，
 *    此时**禁止**把 `pendingAmount` 当某个币种的金额展示（本文件返回「多币种」）；
 *  - `revision` 是命中行最大 id，调用方据此跳过无变化的重渲染；
 *  - 金额一律最小货币单位整数，展示只走 money.js 的 `formatMoney`（本文件不做 /100、不拼符号）。
 */

function countOf(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, number) : 0
}

function amountOf(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

/** 聚合视图里的订单分组（服务端缺省 / 脏数据一律按空处理）。 */
export function pendingGroups(view) {
  if (!Array.isArray(view?.orders)) return []
  return view.orders.filter((group) => group && group.orderId !== null && group.orderId !== undefined)
}

/** 指定订单的分组；未知订单返回 null。 */
export function pendingGroupOf(view, orderId) {
  if (orderId === null || orderId === undefined) return null
  return pendingGroups(view).find((group) => String(group.orderId) === String(orderId)) || null
}

/** 指定订单的待确认条数（列表卡片角标用；未知订单 0）。 */
export function countOfPendingOrder(view, orderId) {
  const group = pendingGroupOf(view, orderId)
  if (!group) return 0
  const items = Array.isArray(group.items) ? group.items.length : 0
  return Math.max(countOf(group.pendingCount), items)
}

/** 指定订单的待确认明细（详情「待确认加项」区的数据源：与卡片角标同一份聚合视图）。 */
export function itemsOfPendingOrder(view, orderId) {
  const group = pendingGroupOf(view, orderId)
  return group && Array.isArray(group.items) ? group.items : []
}

/** 本门店待确认总额文案：混币种（currencyCode 为空）时不得冒充某个币种的金额。 */
export function pendingAmountText(view) {
  if (!view) return ''
  if (view.mixedCurrency === true || !view.currencyCode) return '多币种'
  return formatMoney(view.pendingAmount || 0, view.currencyCode)
}

/**
 * 乐观移除一条待确认加项（确认 / 拒绝发出请求前先本地收敛）：
 * 同步减该单与门店的条数、金额，分组空了就摘掉整组；返回新的视图对象，不改原对象。
 */
export function removePendingItem(view, orderId, itemId) {
  if (!view) return view
  const group = pendingGroupOf(view, orderId)
  if (!group) return view
  const items = Array.isArray(group.items) ? group.items : []
  const removed = items.find((item) => String(item.id) === String(itemId))
  if (!removed) return view
  const removedAmount = amountOf(removed.amount)
  const orders = pendingGroups(view)
    .map((entry) => (entry === group
      ? {
        ...entry,
        items: items.filter((item) => String(item.id) !== String(itemId)),
        pendingCount: Math.max(0, countOf(entry.pendingCount) - 1),
        pendingAmount: Math.max(0, amountOf(entry.pendingAmount) - removedAmount),
      }
      : entry))
    .filter((entry) => (Array.isArray(entry.items) ? entry.items.length : countOf(entry.pendingCount)) > 0)
  return {
    ...view,
    orders,
    pendingCount: Math.max(0, countOf(view.pendingCount) - 1),
    pendingAmount: Math.max(0, amountOf(view.pendingAmount) - removedAmount),
  }
}

/**
 * 包厢展示标签：门店处理客户自助加项时，第一件事是「哪间包厢点的」。
 *
 * 服务端 `roomName` 已是**可直接展示**的包厢名（会话名称快照 → 编码快照 → 按资源 ID 回源资源服务），
 * `roomCode` 是会话编码快照。两者都缺失只可能是「订单没有包厢会话」或「资源服务不可达」，
 * 此时明确给出「未关联包厢」，绝不留空白（空白会被当成加载失败）。
 */
export function pendingRoomLabel(group) {
  const name = typeof group?.roomName === 'string' ? group.roomName.trim() : ''
  if (name) return name
  const code = typeof group?.roomCode === 'string' ? group.roomCode.trim() : ''
  return code || '未关联包厢'
}

/**
 * 是否属于「已被处理」的并发 / 幂等结果：
 * 服务端确认 / 拒绝是原子条件更新，并发下输的一方返回 409（已是目标状态时幂等 200）。
 * 这类结果必须静默收敛（重拉聚合视图 + 轻提示），不能当成红色失败，也不能本地盲目累加。
 */
export function isAlreadyProcessed(error) {
  const status = Number(error?.response?.status ?? error?.status)
  if (status === 409) return true
  const payload = error?.response?.data
  const code = String((payload && payload.code) || error?.code || '').toUpperCase()
  return /ALREADY|CONFLICT|PROCESSED|DUPLICATE/.test(code)
}
