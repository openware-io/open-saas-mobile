import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * C 端「消费账单」可解释性守卫（只改展示，不改金额）。
 *
 * 背景（真实缺陷，线上订单 72）：订单已作废、会话已取消且没有结台时刻，但订单上仍留着 ROOM_FEE 明细，
 * 账单只回 `{durationSeconds: 0, amount: 4000}`——顾客看到「包厢计时费 0 分钟却收 40」，没法解释。
 *
 * 口径：服务端账单把「怎么算出来的」一并下发（计价方案 / 计费时长与已扣暂停 / 每递增粒度单价 × 块数 /
 * 超时部分与倍率 / 是否已含 1 名服务人员 / 金额固化时刻 / 金额来源）。C 端只做展示：
 * 不得自己算块数、不得自己加总金额；没有结台时刻的历史单必须说「时长未记录」，不能用 0 分钟冒充。
 */
describe('C 端账单展示包厢费的计算口径', () => {
  it('账单绘制接上了解释行，且解释来自后端账单字段', async () => {
    const source = await readFile(resolve('c-end/app.js'), 'utf8')
    expect(source).toContain('function roomFeeExplainHtml(roomFee)')
    expect(source).toContain('roomFeeExplainHtml(bill.roomFee)')
    for (const field of [
      'roomFee.planName',
      'roomFee.durationSeconds',
      'roomFee.pausedSeconds',
      'roomFee.unitPrice',
      'roomFee.quantity',
      'roomFee.incrementMinutes',
      'roomFee.overSeconds',
      'roomFee.standardSeconds',
      'roomFee.overtimeRate',
      'roomFee.snapshotAt',
      'roomFee.roomFeeIncludesServer',
    ]) {
      expect(source).toContain(field)
    }
  })

  it('没有结台时刻的历史房费：明说「时长未记录」，不用 0 分钟冒充', async () => {
    const source = await readFile(resolve('c-end/app.js'), 'utf8')
    expect(source).toContain("roomFee.durationKnown === false")
    expect(source).toContain('时长未记录')
    expect(source).toContain("roomFee.source === 'HISTORICAL'")
  })

  it('块数只读后端 quantity，不在 C 端按递增粒度取整算一遍', async () => {
    const source = await readFile(resolve('c-end/app.js'), 'utf8')
    expect(source).toContain("escapeHtml(String(roomFee.quantity))")
    expect(source).not.toMatch(/Math\.ceil\([^\n]*increment/i)
  })
})
