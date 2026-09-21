import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * C 端展示金额的口径守卫。
 *
 * 背景（真实缺陷）：后台收银台卡片把 `totalAmount + roomEstimatedFee` 相加，而 `totalAmount` 里
 * 已经含了刷新写进的 ROOM_FEE 明细 → 包厢费算两遍（ACK 实测账单 6150 / 卡片 10150），
 * 于是「C 端看到的金额」与「后台显示的金额」对不上。
 *
 * 唯一口径：服务端给的实时合计 `liveTotalAmount`（与账单同一套差额法），
 * 结台后即最终值；缺该字段的旧后端退回 `totalAmount`。客户端绝不自行相加。
 */
describe('C 端订单展示金额取服务端口径', () => {
  it('有 orderLiveAmount 且优先 liveTotalAmount、退回 totalAmount', async () => {
    const source = await readFile(resolve('c-end/app.js'), 'utf8')
    expect(source).toContain('function orderLiveAmount(o)')
    expect(source).toContain('o.liveTotalAmount !== undefined')
    expect(source).toContain('return o.totalAmount || 0')
  })

  it('订单卡片走 orderLiveAmount，不再直接读 totalAmount', async () => {
    const source = await readFile(resolve('c-end/app.js'), 'utf8')
    expect(source).toContain('minorMoney(orderLiveAmount(o), o.currencyCode)')
    expect(source).not.toContain('minorMoney(o.totalAmount || 0, o.currencyCode)')
  })

  it('不得把房费估算自行加到合计上（那是后台踩过的重复计算坑）', async () => {
    const source = await readFile(resolve('c-end/app.js'), 'utf8')
    expect(source).not.toContain('totalAmount + roomEstimatedFee')
    expect(source).not.toContain('roomEstimatedFee +')
  })
})
