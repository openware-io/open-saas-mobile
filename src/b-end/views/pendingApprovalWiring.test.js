import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'

/**
 * 「客户待确认加项」聚合提醒 + 集中处理的接线守卫（B 端 A380 商户端 H5）。
 *
 * 口径：C 端客户自助加项落 `PENDING_APPROVAL`，确认后才计入应收。提醒必须**主动可见且能直达处理**，
 * 而不是只有打开某张订单详情才看得到。数据源只有一个：服务端聚合接口
 * `GET /business/orders/pending-approval`（挂在既有 `/business/orders/**` 网关白名单下，
 * 前缀写错就会整条链路 404，所以这里把路径钉死）；禁止回到「为列表每张卡片各拉一次 order-items」的 N+1 口径。
 */
vi.mock('../../shared/api/request', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))

import request from '../../shared/api/request'
import { getPendingApproval } from '../../shared/api/saas'
import {
  countOfPendingOrder,
  isAlreadyProcessed,
  itemsOfPendingOrder,
  pendingAmountText,
  pendingRoomLabel,
  removePendingItem,
} from '../../shared/utils/pending-approval'

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8')
const readOrders = () => read('./Orders.vue')

/** 服务端契约样例：混币种（currencyCode 为空 + mixedCurrency=true），revision = 命中行最大 id。 */
function mixedView() {
  return {
    pendingCount: 5,
    pendingAmount: 3900,
    currencyCode: '',
    mixedCurrency: true,
    revision: 77,
    serverTimeMillis: 1789823610400,
    orders: [
      {
        orderId: 69,
        orderNo: 'O1789808533711',
        roomName: '小包 S03',
        roomCode: 'S03',
        sessionStatus: 'OPEN',
        pendingCount: 4,
        pendingAmount: 2400,
        items: [
          { id: 74, name: '可乐300', quantity: 1, unitPrice: 200, amount: 200, currencyCode: 'USD' },
          { id: 75, name: '果盘', quantity: 1, unitPrice: 1280, amount: 1280, currencyCode: 'USD' },
          { id: 76, name: '精酿啤酒', quantity: 6, unitPrice: 100, amount: 600, currencyCode: 'USD' },
          { id: 77, name: '气泡水', quantity: 2, unitPrice: 160, amount: 320, currencyCode: 'USD' },
        ],
      },
      {
        orderId: 70,
        orderNo: 'O1789808533712',
        pendingCount: 1,
        pendingAmount: 1500,
        items: [{ id: 80, name: '包厢加时', quantity: 1, amount: 1500, currencyCode: 'USD' }],
      },
    ],
  }
}

describe('待确认加项聚合接口契约', () => {
  it('聚合读路径就是 /business/orders/pending-approval（不改回不存在的前缀）', async () => {
    request.get.mockResolvedValue({ pendingCount: 0, orders: [] })

    await getPendingApproval()

    expect(request.get).toHaveBeenCalledWith('/api/v1/business/orders/pending-approval')

    const saas = await read('../../shared/api/saas.js')
    expect(saas).toContain("'/api/v1/business/orders/pending-approval'")
    // 曾经散落在别处的 /order-items/** 前缀不再出现（网关是显式白名单）
    expect(saas).not.toContain("'/api/v1/business/order-items")
  })
})

describe('Orders.vue 接线守卫', () => {
  it('接了聚合接口、15s 轮询、document.hidden 暂停与 visibilitychange 立即恢复', async () => {
    const source = await readOrders()

    expect(source).toContain('getPendingApproval')
    expect(source).toContain('PENDING_APPROVAL_POLL_MS = 15000')
    expect(source).toContain('window.setInterval(')
    expect(source).toContain('document.hidden')
    expect(source).toContain("document.addEventListener('visibilitychange'")
    expect(source).toContain('onPendingVisibilityChange')
  })

  it('卸载清理轮询定时器与 visibilitychange 监听（不泄漏）', async () => {
    const source = await readOrders()

    expect(source).toContain('stopPendingApprovalPolling')
    expect(source).toContain('window.clearInterval(pendingTimer)')
    expect(source).toContain("document.removeEventListener('visibilitychange'")
    expect(source).toMatch(/onBeforeUnmount\(\(\) => \{[^}]*stopPendingApprovalPolling\(\)/)
  })

  it('409 / 并发失败按「已被处理」静默收敛 + 轻提示，不报红色失败', async () => {
    const source = await readOrders()

    expect(source).toContain('isAlreadyProcessed(actionError)')
    expect(source).toContain('该加项已被处理，已为你刷新最新数据')
    // 详情里的确认 / 拒绝也走同一收敛口径，不再把并发失败弹成硬失败
    const confirmLine = source.split('\n').find((line) => line.startsWith('async function confirmPending'))
    const rejectLine = source.split('\n').find((line) => line.startsWith('async function rejectPending'))
    expect(confirmLine).toContain('decidePendingItem')
    expect(confirmLine).not.toContain('alert(')
    expect(rejectLine).toContain('decidePendingItem')
    expect(rejectLine).not.toContain('alert(')
    // 乐观移除 + 写后强制重拉聚合视图（以服务端返回为准回滚）
    expect(source).toContain('applyPendingRemoval')
    expect(source).toContain('removePendingItem')
    expect(source).toContain('await refreshPendingView(true)')
  })

  it('卡片角标 + 顶部集中处理入口 + 逐条/本单全部确认，且不再逐单拉明细（无 N+1）', async () => {
    const source = await readOrders()

    expect(source).toContain('pendingView')
    expect(source).toContain('pendingCountOf(order.id)')
    expect(source).toContain('待确认加项 ×')
    expect(source).toContain('集中处理')
    expect(source).toContain('本单全部确认')
    expect(source).toContain('scrollIntoView')
    expect(source).toContain("ref=\"pendingPanelTarget\"")
    // 逐单 order-items 只允许出现在详情兜底那一处
    expect(source.match(/listOrderItems\(/g)).toHaveLength(1)
  })

  it('集中处理面板与详情待确认区都把包厢作为第一识别信息（缺失给「未关联包厢」）', async () => {
    const source = await readOrders()

    expect(source).toContain('pendingRoomLabel')
    expect(source).toContain('包厢 {{ pendingRoomLabel(group) }}')
    expect(source).toContain('detailRoomLabel')
    expect(source).toContain('待确认加项 · 包厢 {{ detailRoomLabel }}')
    // 用到了就必须真的 import（该工具不是自动导入的）
    expect(source).toMatch(/import \{[^}]*pendingRoomLabel[^}]*\} from '@\/shared\/utils\/pending-approval'/)
  })
})

describe('聚合视图派生与收敛（纯函数）', () => {
  it('pendingCountOf：按订单分组取条数，未知订单为 0，id 类型不敏感', () => {
    const view = mixedView()

    expect(countOfPendingOrder(view, 69)).toBe(4)
    expect(countOfPendingOrder(view, '69')).toBe(4)
    expect(countOfPendingOrder(view, 70)).toBe(1)
    expect(countOfPendingOrder(view, 999)).toBe(0)
    expect(countOfPendingOrder(view, null)).toBe(0)
    expect(countOfPendingOrder(null, 69)).toBe(0)
    // 服务端 pendingCount 缺失时用明细条数兜底
    expect(countOfPendingOrder({ orders: [{ orderId: 1, items: [{ id: 1 }, { id: 2 }] }] }, 1)).toBe(2)
  })

  it('pendingItemsOf：详情待确认区与卡片角标读同一份聚合视图', () => {
    const view = mixedView()

    expect(itemsOfPendingOrder(view, 69).map((item) => item.id)).toEqual([74, 75, 76, 77])
    expect(itemsOfPendingOrder(view, '70')).toHaveLength(1)
    expect(itemsOfPendingOrder(view, 999)).toEqual([])
    expect(itemsOfPendingOrder(null, 69)).toEqual([])
  })

  it('removePendingItem：乐观移除同步减条数/金额，分组空了摘掉整组，不改原对象', () => {
    const view = mixedView()
    const afterRemove = removePendingItem(view, 69, 74)
    const group = afterRemove.orders.find((entry) => entry.orderId === 69)

    expect(group.items.map((item) => item.id)).toEqual([75, 76, 77])
    expect(group.pendingCount).toBe(3)
    expect(group.pendingAmount).toBe(2200)
    expect(afterRemove.pendingCount).toBe(4)
    expect(afterRemove.pendingAmount).toBe(3700)
    // 原视图不被就地修改
    expect(view.orders[0].items).toHaveLength(4)
    expect(view.pendingCount).toBe(5)

    // 摘掉最后一组：分组连同整组一起消失
    const single = removePendingItem({ pendingCount: 1, pendingAmount: 1500, orders: [{ orderId: 70, pendingCount: 1, pendingAmount: 1500, items: [{ id: 80, amount: 1500 }] }] }, 70, 80)
    expect(single.orders).toEqual([])
    expect(single.pendingCount).toBe(0)
    expect(single.pendingAmount).toBe(0)

    // 未知明细：原样返回
    expect(removePendingItem(view, 69, 12345)).toBe(view)
    expect(removePendingItem(view, 999, 74)).toBe(view)
    expect(removePendingItem(null, 69, 74)).toBeNull()
  })

  it('混币种禁止把 pendingAmount 当某个币种的金额展示', () => {
    expect(pendingAmountText(mixedView())).toBe('多币种')
    // currencyCode 缺失同样按混币种处理（不当成某个币种）
    expect(pendingAmountText({ pendingAmount: 3900, currencyCode: '' })).toBe('多币种')
    // 命中行币种一致时才给金额（最小货币单位 -> formatMoney）
    expect(pendingAmountText({ pendingAmount: 3900, currencyCode: 'USD', mixedCurrency: false })).toBe('$39.00')
    expect(pendingAmountText({ pendingAmount: 100, currencyCode: 'CNY', mixedCurrency: false })).toBe('¥1.00')
    expect(pendingAmountText(null)).toBe('')
  })

  it('pendingRoomLabel：包厢名 → 编码 → 「未关联包厢」，绝不留空白', () => {
    // 服务端 roomName 已按「会话名称 → 编码 → 资源回源」给全，直接用
    expect(pendingRoomLabel({ roomName: '小包 S03', roomCode: 'S03' })).toBe('小包 S03')
    // 只有编码（名称快照为空）
    expect(pendingRoomLabel({ roomName: '', roomCode: 'S03' })).toBe('S03')
    // 只有空白（快照存了空串）：按缺失处理
    expect(pendingRoomLabel({ roomName: '   ', roomCode: 'S03' })).toBe('S03')
    expect(pendingRoomLabel({ roomName: null, roomCode: null })).toBe('未关联包厢')
    expect(pendingRoomLabel({})).toBe('未关联包厢')
    expect(pendingRoomLabel(null)).toBe('未关联包厢')
    // 非字符串（历史脏数据）不能当包厢名渲染
    expect(pendingRoomLabel({ roomName: 123 })).toBe('未关联包厢')
  })

  it('isAlreadyProcessed：409 与「已处理」类业务码算已被处理，其余不算', () => {    expect(isAlreadyProcessed({ response: { status: 409 } })).toBe(true)
    expect(isAlreadyProcessed({ status: 409 })).toBe(true)
    expect(isAlreadyProcessed({ response: { data: { code: 'ORDER_ITEM_ALREADY_PROCESSED' } } })).toBe(true)
    expect(isAlreadyProcessed({ code: 'ORDER_ITEM_CONFLICT' })).toBe(true)

    expect(isAlreadyProcessed({ response: { status: 500 } })).toBe(false)
    expect(isAlreadyProcessed({ response: { status: 403 } })).toBe(false)
    // 网络错误（axios code 是 ERR_NETWORK）不能被当成「已被处理」
    expect(isAlreadyProcessed({ code: 'ERR_NETWORK' })).toBe(false)
    expect(isAlreadyProcessed({ code: 'ERR_BAD_REQUEST' })).toBe(false)
    expect(isAlreadyProcessed(null)).toBe(false)
  })
})
