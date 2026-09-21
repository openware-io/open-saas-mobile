export const RESERVATION_STATUS = {
  PENDING: { text: '待确认', type: 'warning' },
  CONFIRMED: { text: '已确认', type: 'primary' },
  ARRIVED: { text: '已到店', type: 'success' },
  CONVERTED: { text: '已开台', type: 'success' },
  NO_SHOW: { text: '未到店', type: 'info' },
  CANCELLED: { text: '已取消', type: 'info' },
}
export const ORDER_STATUS = {
  DRAFT: { text: '进行中', type: 'warning' },
  SERVING: { text: '服务中', type: 'primary' },
  WAITING_SETTLEMENT: { text: '待结算', type: 'warning' },
  WAITING_PAYMENT: { text: '待支付', type: 'warning' },
  COMPLETED: { text: '已完成', type: 'success' },
  VOIDED: { text: '已作废', type: 'info' },
  CANCELLED: { text: '已取消', type: 'info' },
}
export function statusText(map, s) { return (map[s] || {}).text || s || '—' }
export function statusType(map, s) { return (map[s] || {}).type || 'info' }
